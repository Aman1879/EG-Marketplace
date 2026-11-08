const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const router = express.Router();

const Order = require('../models/Order');
const Product = require('../models/Product');
const Vendor = require('../models/Vendor');
const Commission = require('../models/Commission');
const InventoryOperation = require('../models/InventoryOperation');
const Address = require('../models/Address');
const { authenticate, authorize } = require('../middleware/auth');
const { razorpay, razorpayKeyId, razorpayKeySecret, hasRazorpayCredentials } = require('../config/razorpay');
const { recordAuditLog, notificationDeduplicator } = require('../utils/auditLogger');

const COMMISSION_RATE = Number(process.env.ADMIN_COMMISSION_RATE || 0.10);

function roundCurrency(value) {
  return Number((value || 0).toFixed(2));
}

function toPaise(value) {
  return Math.round(Number(value || 0) * 100);
}

async function markOrderStaleAfterSimulatedCrash(orderId) {
  try {
    const expiredTime = new Date(Date.now() - 35000);
    await Order.updateOne(
      { _id: orderId },
      { $set: { inventoryClaimedAt: expiredTime, inventoryHeartbeatAt: expiredTime } }
    );
  } catch (e) { }
}

/**
 * Helper to ensure worker still owns the active claim.
 * Updates the worker's heartbeat and fences out stale workers.
 */
async function assertWorkerActive(orderId, claimId, fencingToken, expectedStatus) {
  const query = {
    _id: orderId,
    inventoryClaimId: claimId,
    claimVersion: fencingToken
  };
  if (expectedStatus) {
    query.inventoryStatus = expectedStatus;
  }

  const order = await Order.findOneAndUpdate(
    query,
    {
      $set: { inventoryHeartbeatAt: new Date() }
    },
    { new: true }
  );

  if (!order) {
    const current = await Order.findById(orderId);
    throw new Error(
      `WorkerFencedOutError: Worker lost claim ownership (token: ${fencingToken}, current: ${current?.claimVersion})`
    );
  }
  return order;
}

/**
 * Atomically deduct inventory for all products in an order.
 * - Enforces an atomic transition from 'not_deducted' to 'deducting' with an incrementing fencingToken.
 * - Distinguishes dead workers from slow workers using active heartbeats.
 * - Uses MongoDB transaction if a replica set is active. Aborts completely on any failure.
 * - In Standalone mode: enforces durable idempotency via InventoryOperation unique index
 *   and coupled stock decrement on Product document.
 * - Supports options.pauseBeforeProductUpdate for deterministic worker race verification.
 */
async function deductOrderInventory(orderInput, options = {}) {
  const orderId = (orderInput && orderInput._id) ? orderInput._id.toString() : String(orderInput);

  const existing = await Order.findById(orderId);
  if (!existing) {
    return { success: false, reason: 'Order not found' };
  }

  if (existing.inventoryStatus === 'deducted') {
    return { success: true, alreadyDeducted: true, order: existing };
  }

  const claimId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const staleThreshold = new Date(Date.now() - 30000); // 30s claim timeout

  const claimedOrder = await Order.findOneAndUpdate(
    {
      _id: orderId,
      $or: [
        { inventoryStatus: 'not_deducted' },
        {
          inventoryStatus: 'deducting',
          $or: [
            { inventoryHeartbeatAt: { $lt: staleThreshold } },
            { inventoryHeartbeatAt: null, inventoryClaimedAt: { $lt: staleThreshold } }
          ]
        }
      ]
    },
    {
      $set: {
        inventoryStatus: 'deducting',
        inventoryClaimId: claimId,
        inventoryClaimedAt: new Date(),
        inventoryHeartbeatAt: new Date()
      },
      $inc: { claimVersion: 1 },
      $push: {
        inventoryLogs: {
          action: 'claim_deduction',
          timestamp: new Date(),
          status: 'in_progress',
          message: `Deduction claimed with token ${claimId}`
        }
      }
    },
    { new: true }
  );

  if (!claimedOrder) {
    const pollAttempts = options.pollAttempts !== undefined ? options.pollAttempts : 30;
    const pollIntervalMs = options.pollIntervalMs !== undefined ? options.pollIntervalMs : 100;

    for (let i = 0; i < pollAttempts; i++) {
      await new Promise(res => setTimeout(res, pollIntervalMs));
      const polled = await Order.findById(orderId);
      if (!polled) break;
      if (polled.inventoryStatus === 'deducted') {
        return { success: true, alreadyDeducted: true, order: polled };
      }
      if (polled.inventoryStatus === 'deduction_failed' || polled.inventoryStatus === 'recovery_required') {
        return {
          success: false,
          reason: polled.failureReason || 'Inventory deduction failed by concurrent handler',
          order: polled
        };
      }
    }
    return { success: false, reason: 'Concurrent inventory deduction in progress. Please retry.' };
  }

  const fencingToken = claimedOrder.claimVersion;

  const isConnected = mongoose.connection?.readyState === 1;
  const topologyType = mongoose.connection?.client?.topology?.description?.type;
  const isReplicaSet = topologyType === 'ReplicaSetWithPrimary' || topologyType === 'Sharded';
  const hasSimulatedCrash = options.simulateCrashBoundary !== undefined ||
                            options.simulateCrashBeforeOpInsert !== undefined ||
                            options.simulateCrashAfterOpPendingBeforeStock !== undefined ||
                            options.simulateCrashAfterStockBeforeOpCompleted !== undefined ||
                            options.simulateCrashAfterItemIndex !== undefined ||
                            options.simulateCrashAfterOpCompletedBeforeOrderSave !== undefined ||
                            options.simulateCrashAfterRestoreIndex !== undefined ||
                            options.simulateFailureDuringRestore !== undefined;
  const useTransaction = isReplicaSet && options.forceCompensation !== true && !hasSimulatedCrash;

  if (options.simulateNoTransactions === true || (isConnected && !isReplicaSet && options.forceCompensation !== true)) {
    await Order.findOneAndUpdate(
      { _id: orderId, inventoryClaimId: claimId, claimVersion: fencingToken },
      {
        $set: { inventoryStatus: 'not_deducted', inventoryClaimId: null },
        $push: {
          inventoryLogs: {
            action: 'deduction_aborted_no_transactions',
            timestamp: new Date(),
            status: 'failed',
            message: 'TransactionUnavailableError: MongoDB replica set transactions are required for inventory operations'
          }
        }
      }
    );
    return {
      success: false,
      transactionUnavailable: true,
      reason: 'TransactionUnavailableError: MongoDB replica set transactions are required for inventory operations. Standalone non-transactional stock mutations are not permitted.'
    };
  }

  if (useTransaction) {
    const maxTxRetries = 5;
    for (let attempt = 0; attempt < maxTxRetries; attempt++) {
      const session = await mongoose.startSession();
      try {
        session.startTransaction();

        const freshOrder = await Order.findOne({
          _id: orderId,
          inventoryClaimId: claimId,
          claimVersion: fencingToken
        }).session(session);

        if (!freshOrder) {
          throw new Error('WorkerFencedOutError: Lost claim ownership before transaction execution');
        }

        for (let i = 0; i < claimedOrder.products.length; i++) {
          const item = claimedOrder.products[i];
          const qty = Number(item.quantity);
          if (!Number.isInteger(qty) || qty <= 0) {
            throw new Error(`Invalid quantity for product ${item.productId}`);
          }

          const deductOpId = `order_${orderId}_prod_${item.productId}_deduct`;

          // Check if operation was already completed (authoritative durable ledger check, independent of marker eviction)
          const existingOp = await InventoryOperation.findOne({ operationId: deductOpId }).session(session);
          if (existingOp && ['completed', 'archived', 'active'].includes(existingOp.status)) {
            item.inventoryState = 'deducted';
            continue;
          }

          // Test hook: pause worker before writing stock inside transaction
          if (typeof options.pauseInTransactionBeforeStockWrite === 'function') {
            await options.pauseInTransactionBeforeStockWrite({ orderId, claimId, fencingToken, session, itemIndex: i });
          }

          await InventoryOperation.findOneAndUpdate(
            { operationId: deductOpId },
            {
              $set: {
                orderId,
                productId: item.productId,
                action: 'deduct',
                quantity: qty,
                claimId,
                fencingToken,
                status: 'completed',
                completedAt: new Date()
              }
            },
            { session, upsert: true }
          );

          const deductQuery = item.variantId
            ? {
                _id: item.productId,
                stock: { $gte: qty },
                variants: {
                  $elemMatch: {
                    _id: item.variantId,
                    stock: { $gte: qty }
                  }
                }
              }
            : {
                _id: item.productId,
                stock: { $gte: qty }
              };

          const deductInc = item.variantId
            ? { 'variants.$.stock': -qty, stock: -qty }
            : { stock: -qty };

          const updated = await Product.findOneAndUpdate(
            deductQuery,
            {
              $inc: deductInc,
              $push: {
                inventoryOperations: {
                  $each: [{
                    operationId: deductOpId,
                    orderId,
                    action: 'deduct',
                    quantity: qty,
                    variantId: item.variantId || null,
                    claimId,
                    fencingToken,
                    createdAt: new Date()
                  }],
                  $slice: -200
                }
              }
            },
            { session, new: true }
          );

          if (!updated) {
            const product = await Product.findById(item.productId).session(session);
            const title = product?.title || 'Unknown Product';
            let available = 0;
            if (product) {
              if (item.variantId && Array.isArray(product.variants)) {
                const v = product.variants.find(varItem => String(varItem._id) === String(item.variantId));
                available = v ? (v.stock || 0) : 0;
              } else {
                available = product.stock || 0;
              }
            }
            throw new Error(`Insufficient stock for "${title}" (${available} available)`);
          }

          item.inventoryState = 'deducted';
        }

        claimedOrder.inventoryStatus = 'deducted';
        claimedOrder.inventoryLogs.push({
          action: 'deduction_completed_transactional',
          timestamp: new Date(),
          status: 'success',
          message: 'All products deducted via replica set transaction'
        });
        await claimedOrder.save({ session });
        await session.commitTransaction();
        await recordAuditLog({
          action: 'inventory.deduct',
          resourceType: 'Order',
          resourceId: claimedOrder._id.toString(),
          metadata: { itemsCount: claimedOrder.products?.length || 0, mode: 'transactional' }
        });
        return { success: true, order: claimedOrder };
      } catch (txErr) {
        await session.abortTransaction();

        const isTransient = txErr.hasErrorLabel && txErr.hasErrorLabel('TransientTransactionError');
        const isWriteConflict = txErr.code === 112 || (txErr.message && txErr.message.includes('WriteConflict'));
        if ((isTransient || isWriteConflict) && attempt < maxTxRetries - 1) {
          await new Promise(r => setTimeout(r, 25 + Math.random() * 50));
          continue;
        }

        const failReason = txErr.message || 'Transaction aborted';
        const updatedOrder = await Order.findOneAndUpdate(
          { _id: orderId, inventoryClaimId: claimId, claimVersion: fencingToken },
          {
            $set: {
              inventoryStatus: 'deduction_failed',
              failureReason: failReason
            },
            $push: {
              inventoryLogs: {
                action: 'deduction_failed_transactional',
                timestamp: new Date(),
                status: 'failed',
                message: failReason
              }
            }
          },
          { new: true }
        );
        return { success: false, reason: failReason, order: updatedOrder };
      } finally {
        await session.endSession();
      }
    }
  }

  // Standalone mode: Idempotent compensation with coupled stock-update + operation marker
  const deductedItems = [];
  for (let i = 0; i < claimedOrder.products.length; i++) {
    try {
      await assertWorkerActive(orderId, claimId, fencingToken, 'deducting');
    } catch (fenceErr) {
      return { success: false, reason: fenceErr.message, fencedOut: true };
    }

    // Deterministic test hook: pause worker before pre-write checks
    if (typeof options.pauseBeforeProductUpdate === 'function') {
      await options.pauseBeforeProductUpdate({ orderId, claimId, fencingToken, itemIndex: i });
    }

    // Guard against order having been cancelled or reclaimed while in progress
    const orderCancelled = await InventoryOperation.findOne({
      orderId,
      action: { $in: ['rollback', 'restore'] },
      status: { $in: ['completed', 'pending', 'active'] }
    });
    if (orderCancelled) {
      return { success: false, reason: 'Order was cancelled or reclaimed', fencedOut: true };
    }

    // Check if worker is still active immediately at the point of write
    const activeCheck = await Order.findOne({
      _id: orderId,
      inventoryClaimId: claimId,
      claimVersion: fencingToken
    });
    if (!activeCheck) {
      return { success: false, reason: 'Worker lost claim before stock update', fencedOut: true };
    }

    // Deterministic test hook: pause worker immediately AFTER ownership & cancellation checks,
    // but BEFORE the Product stock update (the hardest race):
    if (typeof options.pauseAfterChecksBeforeStockWrite === 'function') {
      await options.pauseAfterChecksBeforeStockWrite({ orderId, claimId, fencingToken, itemIndex: i });
    }

    const item = claimedOrder.products[i];
    const qty = Number(item.quantity);

    if (!Number.isInteger(qty) || qty <= 0) {
      const errReason = `Invalid quantity for product ${item.productId}`;
      await executeDurableRollback(orderId, deductedItems, errReason, claimId, fencingToken);
      return { success: false, reason: errReason };
    }

    const deductOpId = `order_${orderId}_prod_${item.productId}_deduct`;

    // 0. Check durable InventoryOperation collection first (handles already completed / archived operations)
    const existingDurableOp = await InventoryOperation.findOne({ operationId: deductOpId });
    if (existingDurableOp && ['completed', 'archived', 'active'].includes(existingDurableOp.status)) {
      deductedItems.push({ productId: item.productId, quantity: qty, deductOpId, variantId: item.variantId || null });
      await Order.updateOne(
        { _id: orderId, 'products.productId': item.productId },
        { $set: { 'products.$.inventoryState': 'deducted' } }
      );
      continue;
    }

    // BOUNDARY 1 SIMULATION: Crash before InventoryOperation is inserted
    if (options.simulateCrashBoundary === 1 || options.simulateCrashBeforeOpInsert) {
      await markOrderStaleAfterSimulatedCrash(orderId);
      throw new Error(`Simulated crash at Boundary 1: before InventoryOperation insert (op: ${deductOpId})`);
    }

    // Step 1: Record durable operation with status 'pending' (reservation)
    let durableOpDoc;
    try {
      durableOpDoc = await InventoryOperation.findOneAndUpdate(
        { operationId: deductOpId },
        {
          $setOnInsert: {
            operationId: deductOpId,
            orderId,
            productId: item.productId,
            action: 'deduct',
            quantity: qty,
            claimId,
            fencingToken,
            status: 'pending',
            createdAt: new Date()
          }
        },
        { upsert: true, new: true }
      );
    } catch (dupErr) {
      if (dupErr.code === 11000) {
        durableOpDoc = await InventoryOperation.findOne({ operationId: deductOpId });
      } else {
        throw dupErr;
      }
    }

    // If another worker already completed this operation, record and continue
    if (durableOpDoc && ['completed', 'archived', 'active'].includes(durableOpDoc.status)) {
      deductedItems.push({ productId: item.productId, quantity: qty, deductOpId, variantId: item.variantId || null });
      await Order.updateOne(
        { _id: orderId, 'products.productId': item.productId },
        { $set: { 'products.$.inventoryState': 'deducted' } }
      );
      continue;
    }

    // If existing operation was pending or failed, and this worker has a strictly higher fencingToken,
    // take over ownership atomically:
    if (durableOpDoc && ['pending', 'failed'].includes(durableOpDoc.status) && durableOpDoc.fencingToken < fencingToken) {
      await InventoryOperation.updateOne(
        {
          operationId: deductOpId,
          status: { $in: ['pending', 'failed'] },
          fencingToken: { $lt: fencingToken }
        },
        {
          $set: {
            claimId,
            fencingToken,
            status: 'pending',
            updatedAt: new Date()
          }
        }
      );
    }

    // BOUNDARY 2 SIMULATION: Crash after InventoryOperation pending, before Product stock update
    if (options.simulateCrashBoundary === 2 || options.simulateCrashAfterOpPendingBeforeStock) {
      await markOrderStaleAfterSimulatedCrash(orderId);
      throw new Error(`Simulated crash at Boundary 2: after InventoryOperation pending, before Product stock update (op: ${deductOpId})`);
    }

    // Deterministic test hook: pause worker AFTER reserving operation, before Product stock write:
    if (typeof options.pauseAfterReservationBeforeStockWrite === 'function') {
      await options.pauseAfterReservationBeforeStockWrite({ orderId, claimId, fencingToken, itemIndex: i, operationId: deductOpId });
    }

    // Step 2: Atomic update coupling stock decrement and embedded idempotency marker together
    const deductQuery = item.variantId
      ? {
          _id: item.productId,
          stock: { $gte: qty },
          variants: {
            $elemMatch: {
              _id: item.variantId,
              stock: { $gte: qty }
            }
          },
          'inventoryOperations.operationId': { $ne: deductOpId }
        }
      : {
          _id: item.productId,
          stock: { $gte: qty },
          'inventoryOperations.operationId': { $ne: deductOpId }
        };

    const deductInc = item.variantId
      ? { 'variants.$.stock': -qty, stock: -qty }
      : { stock: -qty };

    const updated = await Product.findOneAndUpdate(
      deductQuery,
      {
        $inc: deductInc,
        $push: {
          inventoryOperations: {
            $each: [{
              operationId: deductOpId,
              orderId,
              action: 'deduct',
              quantity: qty,
              variantId: item.variantId || null,
              claimId,
              fencingToken,
              createdAt: new Date()
            }],
            $slice: -200
          }
        }
      },
      { new: true }
    );

    if (!updated) {
      // Stock update failed.
      // 1. Check if this worker was fenced out while paused
      const currentActive = await Order.findOne({
        _id: orderId,
        inventoryClaimId: claimId,
        claimVersion: fencingToken
      });
      if (!currentActive) {
        // Stale worker was fenced out! Atomically mark ONLY its own pending operation failed,
        // and NEVER touch if another worker already completed it!
        await InventoryOperation.updateOne(
          {
            operationId: deductOpId,
            status: 'pending',
            claimId: claimId,
            fencingToken: fencingToken
          },
          { $set: { status: 'failed' } }
        );
        return { success: false, reason: 'Worker lost claim before stock update (stale worker fenced out)', fencedOut: true };
      }

      // 2. Check if already deducted by another worker or earlier attempt
      const alreadyDeducted = await Product.findOne({
        _id: item.productId,
        'inventoryOperations.operationId': deductOpId
      });

      if (alreadyDeducted) {
        await InventoryOperation.updateOne(
          {
            operationId: deductOpId,
            status: { $in: ['pending', 'reserved'] },
            claimId: claimId,
            fencingToken: fencingToken
          },
          { $set: { status: 'completed', completedAt: new Date() } }
        );
        deductedItems.push({ productId: item.productId, quantity: qty, deductOpId, variantId: item.variantId || null });
        await Order.updateOne(
          { _id: orderId, 'products.productId': item.productId },
          { $set: { 'products.$.inventoryState': 'deducted' } }
        );
        continue;
      }

      // 3. Insufficient stock failure
      // Mark ONLY this worker's pending operation as failed.
      // Condition: status MUST be 'pending', claimId and fencingToken MUST match!
      await InventoryOperation.updateOne(
        {
          operationId: deductOpId,
          status: 'pending',
          claimId: claimId,
          fencingToken: fencingToken
        },
        { $set: { status: 'failed' } }
      );

      const product = await Product.findById(item.productId);
      const title = product?.title || 'Unknown Product';
      const available = product ? product.stock : 0;
      const failReason = `Insufficient stock for "${title}" (${available} available)`;

      await executeDurableRollback(orderId, deductedItems, failReason, claimId, fencingToken);
      return { success: false, reason: failReason };
    }

    // BOUNDARY 3 SIMULATION: Crash after stock update, before InventoryOperation marked completed
    if (options.simulateCrashBoundary === 3 || options.simulateCrashAfterStockBeforeOpCompleted ||
        (options.simulateCrashAfterItemIndex !== undefined && i === options.simulateCrashAfterItemIndex)) {
      await markOrderStaleAfterSimulatedCrash(orderId);
      throw new Error(`Simulated crash at Boundary 3: after stock decrement, before InventoryOperation completed (op: ${deductOpId})`);
    }

    // Step 3: Mark InventoryOperation as 'completed'
    await InventoryOperation.updateOne(
      {
        operationId: deductOpId,
        status: { $in: ['pending', 'reserved'] },
        claimId: claimId,
        fencingToken: fencingToken
      },
      { $set: { status: 'completed', completedAt: new Date() } }
    );

    // BOUNDARY 4 SIMULATION: Crash after InventoryOperation completed, before Order item state saved
    if (options.simulateCrashBoundary === 4 || options.simulateCrashAfterOpCompletedBeforeOrderSave) {
      await markOrderStaleAfterSimulatedCrash(orderId);
      throw new Error(`Simulated crash at Boundary 4: after InventoryOperation completed, before Order item save (op: ${deductOpId})`);
    }

    // Step 4: Update Order item state
    await Order.updateOne(
      { _id: orderId, 'products.productId': item.productId },
      {
        $set: { 'products.$.inventoryState': 'deducted' },
        $push: {
          inventoryLogs: {
            action: 'item_deducted',
            productId: item.productId,
            quantity: qty,
            timestamp: new Date(),
            status: 'success'
          }
        }
      }
    );

    deductedItems.push({ productId: item.productId, quantity: qty, deductOpId, variantId: item.variantId || null });
  }

  // Fencing check before committing completion
  const finalOrder = await Order.findOneAndUpdate(
    {
      _id: orderId,
      inventoryClaimId: claimId,
      claimVersion: fencingToken,
      inventoryStatus: 'deducting'
    },
    {
      $set: { inventoryStatus: 'deducted' },
      $push: {
        inventoryLogs: {
          action: 'deduction_completed_durable',
          timestamp: new Date(),
          status: 'success',
          message: 'All products deducted and persisted durably'
        }
      }
    },
    { new: true }
  );

  if (!finalOrder) {
    return { success: false, reason: 'Worker fenced out before committing order deduction', fencedOut: true };
  }

  await recordAuditLog({
    action: 'inventory.deduct',
    resourceType: 'Order',
    resourceId: orderId,
    metadata: { itemsCount: finalOrder.products?.length || 0, mode: 'durable' }
  });

  return { success: true, order: finalOrder };
}

/**
 * Durably rollback partially deducted inventory items.
 * Uses InventoryOperation unique index and couples stock increment on Product.
 */
async function executeDurableRollback(orderId, deductedItems, reason, claimId, fencingToken) {
  await Order.updateOne(
    { _id: orderId },
    {
      $set: {
        inventoryStatus: 'deduction_failed',
        failureReason: reason
      },
      $push: {
        inventoryLogs: {
          action: 'rollback_started',
          timestamp: new Date(),
          status: 'in_progress',
          message: reason
        }
      }
    }
  );

  for (const item of deductedItems) {
    const deductOpId = item.deductOpId || `order_${orderId}_prod_${item.productId}_deduct`;
    const rollbackOpId = `order_${orderId}_prod_${item.productId}_rollback`;

    const existingRollback = await InventoryOperation.findOne({ operationId: rollbackOpId });
    if (existingRollback) {
      continue;
    }

    try {
      await InventoryOperation.create({
        operationId: rollbackOpId,
        orderId,
        productId: item.productId,
        action: 'rollback',
        quantity: item.quantity,
        claimId,
        fencingToken
      });
    } catch (dupErr) {
      if (dupErr.code === 11000) continue;
      throw dupErr;
    }

    try {
      const rollbackQuery = item.variantId
        ? {
            _id: item.productId,
            'variants._id': item.variantId,
            'inventoryOperations.operationId': {
              $nin: [rollbackOpId]
            }
          }
        : {
            _id: item.productId,
            'inventoryOperations.operationId': {
              $nin: [rollbackOpId]
            }
          };

      const rollbackInc = item.variantId
        ? { 'variants.$.stock': item.quantity, stock: item.quantity }
        : { stock: item.quantity };

      await Product.findOneAndUpdate(
        rollbackQuery,
        {
          $inc: rollbackInc,
          $push: {
            inventoryOperations: {
              $each: [{
                operationId: rollbackOpId,
                orderId,
                action: 'rollback',
                quantity: item.quantity,
                variantId: item.variantId || null,
                claimId,
                createdAt: new Date()
              }],
              $slice: -200
            }
          }
        }
      );

      await Order.updateOne(
        { _id: orderId, 'products.productId': item.productId },
        {
          $set: { 'products.$.inventoryState': 'rolled_back' },
          $push: {
            inventoryLogs: {
              action: 'rollback_item_success',
              productId: item.productId,
              quantity: item.quantity,
              timestamp: new Date(),
              status: 'success'
            }
          }
        }
      );
    } catch (err) {
      console.error(`Rollback error for item ${item.productId}:`, err);
      await Order.updateOne(
        { _id: orderId },
        {
          $set: { inventoryStatus: 'recovery_required' },
          $push: {
            inventoryLogs: {
              action: 'rollback_item_failed',
              productId: item.productId,
              timestamp: new Date(),
              status: 'failed',
              message: err.message
            }
          }
        }
      );
    }
  }
}

/**
 * Atomically restore inventory for eligible orders (cancellation or refund).
 * - Restores only if inventoryStatus === 'deducted'.
 * - Claims 'restoring' state with monotonic fencingToken (claimVersion) and active heartbeat.
 * - Enforces durable idempotency via InventoryOperation unique index.
 */
async function restoreOrderInventory(orderInput, reason = 'cancellation', options = {}) {
  const orderId = (orderInput && orderInput._id) ? orderInput._id.toString() : String(orderInput);

  const existing = await Order.findById(orderId);
  if (!existing) {
    return { restored: false, reason: 'Order not found' };
  }

  if (existing.inventoryStatus === 'restored') {
    return { restored: true, alreadyRestored: true, order: existing };
  }

  const currentStatus = (existing.status || '').toLowerCase();
  if (currentStatus === 'shipped' || currentStatus === 'delivered') {
    return {
      restored: false,
      reason: `Orders in "${existing.status}" status cannot be automatically restocked`
    };
  }

  if (existing.inventoryStatus !== 'deducted' && existing.inventoryStatus !== 'restoring') {
    return {
      restored: false,
      reason: `Order inventory status is "${existing.inventoryStatus}", cannot restore`
    };
  }

  const claimId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const staleThreshold = new Date(Date.now() - 30000);

  const claimedOrder = await Order.findOneAndUpdate(
    {
      _id: orderId,
      status: { $nin: ['shipped', 'delivered', 'Shipped', 'Delivered'] },
      $or: [
        { inventoryStatus: 'deducted' },
        {
          inventoryStatus: 'restoring',
          inventoryClaimedAt: { $lt: staleThreshold },
          inventoryHeartbeatAt: { $lt: staleThreshold }
        }
      ]
    },
    {
      $set: {
        inventoryStatus: 'restoring',
        inventoryClaimedAt: new Date(),
        inventoryClaimId: claimId,
        inventoryHeartbeatAt: new Date()
      },
      $inc: { claimVersion: 1 },
      $push: {
        inventoryLogs: {
          action: 'claim_restoration',
          timestamp: new Date(),
          status: 'in_progress',
          message: `Restoration claimed by ${reason} with token ${claimId}`
        }
      }
    },
    { new: true }
  );

  if (!claimedOrder) {
    const pollAttempts = options.pollAttempts !== undefined ? options.pollAttempts : 30;
    const pollIntervalMs = options.pollIntervalMs !== undefined ? options.pollIntervalMs : 100;

    for (let i = 0; i < pollAttempts; i++) {
      await new Promise(res => setTimeout(res, pollIntervalMs));
      const polled = await Order.findById(orderId);
      if (!polled) break;
      if (polled.inventoryStatus === 'restored') {
        return { restored: true, alreadyRestored: true, order: polled };
      }
    }
    const current = await Order.findById(orderId);
    return {
      restored: false,
      reason: `Order not eligible for restoration (inventoryStatus is ${current?.inventoryStatus}, order status is ${current?.status})`
    };
  }

  const fencingToken = claimedOrder.claimVersion;

  const isConnected = mongoose.connection?.readyState === 1;
  const topologyType = mongoose.connection?.client?.topology?.description?.type;
  const isReplicaSet = topologyType === 'ReplicaSetWithPrimary' || topologyType === 'Sharded';
  const hasSimulatedCrash = options.simulateCrashBoundary !== undefined ||
                            options.simulateCrashBeforeOpInsert !== undefined ||
                            options.simulateCrashAfterOpPendingBeforeStock !== undefined ||
                            options.simulateCrashAfterStockBeforeOpCompleted !== undefined ||
                            options.simulateCrashAfterItemIndex !== undefined ||
                            options.simulateCrashAfterOpCompletedBeforeOrderSave !== undefined ||
                            options.simulateCrashAfterRestoreIndex !== undefined ||
                            options.simulateFailureDuringRestore !== undefined;
  const useTransaction = isReplicaSet && options.forceCompensation !== true && !hasSimulatedCrash;

  if (options.simulateNoTransactions === true || (isConnected && !isReplicaSet && options.forceCompensation !== true)) {
    await Order.findOneAndUpdate(
      { _id: orderId, inventoryClaimId: claimId, claimVersion: fencingToken },
      {
        $set: { inventoryStatus: 'deducted', inventoryClaimId: null },
        $push: {
          inventoryLogs: {
            action: 'restoration_aborted_no_transactions',
            timestamp: new Date(),
            status: 'failed',
            message: 'TransactionUnavailableError: MongoDB replica set transactions are required for inventory operations'
          }
        }
      }
    );
    return {
      restored: false,
      transactionUnavailable: true,
      reason: 'TransactionUnavailableError: MongoDB replica set transactions are required for inventory operations. Standalone non-transactional stock mutations are not permitted.'
    };
  }

  if (useTransaction) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const freshOrder = await Order.findOne({
        _id: orderId,
        inventoryClaimId: claimId,
        claimVersion: fencingToken
      }).session(session);

      if (!freshOrder) {
        throw new Error('WorkerFencedOutError: Lost claim ownership before restoration transaction execution');
      }

      for (let i = 0; i < claimedOrder.products.length; i++) {
        const item = claimedOrder.products[i];
        const qty = Number(item.quantity);
        if (item.inventoryState !== 'rolled_back' && item.inventoryState !== 'restored' && qty > 0) {
          const restoreOpId = `order_${orderId}_prod_${item.productId}_restore`;
          const rollbackOpId = `order_${orderId}_prod_${item.productId}_rollback`;

          const existingRestore = await InventoryOperation.findOne({ operationId: restoreOpId }).session(session);
          if (existingRestore && ['completed', 'archived', 'active'].includes(existingRestore.status)) {
            item.inventoryState = 'restored';
            continue;
          }

          const existingRollback = await InventoryOperation.findOne({ operationId: rollbackOpId }).session(session);
          if (existingRollback && ['completed', 'archived', 'active'].includes(existingRollback.status)) {
            continue;
          }

          // Test hook: pause inside restoration transaction
          if (typeof options.pauseInTransactionBeforeRestoreWrite === 'function') {
            await options.pauseInTransactionBeforeRestoreWrite({ orderId, claimId, fencingToken, session, itemIndex: i });
          }

          await InventoryOperation.findOneAndUpdate(
            { operationId: restoreOpId },
            {
              $set: {
                orderId,
                productId: item.productId,
                action: 'restore',
                quantity: qty,
                claimId,
                fencingToken,
                status: 'completed',
                completedAt: new Date()
              }
            },
            { session, upsert: true }
          );

          const restoreQuery = item.variantId
            ? { _id: item.productId, 'variants._id': item.variantId }
            : { _id: item.productId };

          const restoreInc = item.variantId
            ? { 'variants.$.stock': qty, stock: qty }
            : { stock: qty };

          await Product.findOneAndUpdate(
            restoreQuery,
            {
              $inc: restoreInc,
              $push: {
                inventoryOperations: {
                  $each: [{
                    operationId: restoreOpId,
                    orderId,
                    action: 'restore',
                    quantity: qty,
                    variantId: item.variantId || null,
                    claimId,
                    createdAt: new Date()
                  }],
                  $slice: -200
                }
              }
            },
            { session, new: true }
          );

          item.inventoryState = 'restored';
        }
      }

      claimedOrder.inventoryStatus = 'restored';
      claimedOrder.inventoryLogs.push({
        action: 'restoration_completed_transactional',
        timestamp: new Date(),
        status: 'success',
        message: `All items restored via replica set transaction (${reason})`
      });
      await claimedOrder.save({ session });
      await session.commitTransaction();
      await recordAuditLog({
        action: 'inventory.restore',
        resourceType: 'Order',
        resourceId: claimedOrder._id.toString(),
        metadata: { reason, mode: 'transactional' }
      });
      return { success: true, restored: true, order: claimedOrder };
    } catch (txErr) {
      await session.abortTransaction();
      const failReason = txErr.message || 'Transaction aborted during restoration';
      const updatedOrder = await Order.findOneAndUpdate(
        { _id: orderId, inventoryClaimId: claimId, claimVersion: fencingToken },
        {
          $set: {
            inventoryStatus: 'restoration_failed',
            failureReason: failReason
          },
          $push: {
            inventoryLogs: {
              action: 'restoration_failed_transactional',
              timestamp: new Date(),
              status: 'failed',
              message: failReason
            }
          }
        },
        { new: true }
      );
      return { restored: false, reason: failReason, order: updatedOrder };
    } finally {
      await session.endSession();
    }
  }

  for (let i = 0; i < claimedOrder.products.length; i++) {
    try {
      await assertWorkerActive(orderId, claimId, fencingToken, 'restoring');
    } catch (fenceErr) {
      return { restored: false, reason: fenceErr.message, fencedOut: true };
    }

    // Deterministic test hook: pause worker before pre-write checks
    if (typeof options.pauseBeforeProductUpdate === 'function') {
      await options.pauseBeforeProductUpdate({ orderId, claimId, fencingToken, itemIndex: i, action: 'restore' });
    }

    // Check if worker is still active immediately at the point of write
    const activeCheck = await Order.findOne({
      _id: orderId,
      inventoryClaimId: claimId,
      claimVersion: fencingToken
    });
    if (!activeCheck) {
      return { restored: false, reason: 'Worker lost claim before stock update', fencedOut: true };
    }

    // Deterministic test hooks: pause worker immediately AFTER ownership check,
    // but BEFORE product stock restoration write (the hardest race):
    if (typeof options.pauseAfterChecksBeforeStockWrite === 'function') {
      await options.pauseAfterChecksBeforeStockWrite({ orderId, claimId, fencingToken, itemIndex: i, action: 'restore' });
    }

    const item = claimedOrder.products[i];
    const qty = Number(item.quantity);

    if (item.inventoryState !== 'rolled_back' && item.inventoryState !== 'restored' && qty > 0) {
      const restoreOpId = `order_${orderId}_prod_${item.productId}_restore`;
      const rollbackOpId = `order_${orderId}_prod_${item.productId}_rollback`;

      // Durable idempotency check
      const existingRestore = await InventoryOperation.findOne({ operationId: restoreOpId });
      if (existingRestore && ['completed', 'archived', 'active'].includes(existingRestore.status)) {
        continue;
      }

      const existingRollback = await InventoryOperation.findOne({ operationId: rollbackOpId });
      if (existingRollback && ['completed', 'archived', 'active'].includes(existingRollback.status)) {
        continue;
      }

      // Step 1: Record durable operation with status 'pending'
      try {
        await InventoryOperation.findOneAndUpdate(
          { operationId: restoreOpId },
          {
            $setOnInsert: {
              operationId: restoreOpId,
              orderId,
              productId: item.productId,
              action: 'restore',
              quantity: qty,
              claimId,
              fencingToken,
              status: 'pending',
              createdAt: new Date()
            }
          },
          { upsert: true }
        );
      } catch (dupErr) {
        if (dupErr.code !== 11000) throw dupErr;
      }

      const existingRestoreDoc = await InventoryOperation.findOne({ operationId: restoreOpId });
      if (existingRestoreDoc && ['completed', 'archived', 'active'].includes(existingRestoreDoc.status)) {
        continue;
      }
      if (existingRestoreDoc && existingRestoreDoc.status === 'pending' && existingRestoreDoc.fencingToken < fencingToken) {
        await InventoryOperation.updateOne(
          {
            operationId: restoreOpId,
            status: 'pending',
            fencingToken: { $lt: fencingToken }
          },
          {
            $set: {
              claimId,
              fencingToken,
              updatedAt: new Date()
            }
          }
        );
      }

      const restoreQuery = item.variantId
        ? {
            _id: item.productId,
            'variants._id': item.variantId,
            'inventoryOperations.operationId': {
              $nin: [restoreOpId, rollbackOpId] // FIX: using $nin
            }
          }
        : {
            _id: item.productId,
            'inventoryOperations.operationId': {
              $nin: [restoreOpId, rollbackOpId] // FIX: using $nin
            }
          };

      const restoreInc = item.variantId
        ? { 'variants.$.stock': qty, stock: qty }
        : { stock: qty };

      if (options.simulateCrashAfterRestoreIndex !== undefined && i === options.simulateCrashAfterRestoreIndex) {
        await Product.findOneAndUpdate(
          restoreQuery,
          {
            $inc: restoreInc,
            $push: {
              inventoryOperations: {
                $each: [{
                  operationId: restoreOpId,
                  orderId,
                  action: 'restore',
                  quantity: qty,
                  variantId: item.variantId || null,
                  claimId,
                  createdAt: new Date()
                }],
                $slice: -200
              }
            }
          }
        );
        try {
          await InventoryOperation.updateOne(
            {
              operationId: restoreOpId,
              status: { $in: ['pending', 'reserved'] },
              claimId,
              fencingToken
            },
            { $set: { status: 'completed', completedAt: new Date() } }
          );
        } catch (e) { }
        await markOrderStaleAfterSimulatedCrash(orderId);
        throw new Error(`Simulated server crash after product increment (op: ${restoreOpId})`);
      }

      if (options.simulateFailureDuringRestore && i === options.simulateFailureDuringRestoreIndex) {
        await Order.updateOne(
          { _id: orderId },
          {
            $set: { inventoryStatus: 'restoration_failed' },
            $push: {
              inventoryLogs: {
                action: 'restore_simulated_crash',
                timestamp: new Date(),
                status: 'failed',
                message: `Simulated crash during restoration at index ${i}`
              }
            }
          }
        );
        await markOrderStaleAfterSimulatedCrash(orderId);
        throw new Error(`Simulated server crash during restoration at product index ${i}`);
      }

      // Step 2: Atomic Product stock increment
      const updated = await Product.findOneAndUpdate(
        restoreQuery,
        {
          $inc: restoreInc,
          $push: {
            inventoryOperations: {
              $each: [{
                operationId: restoreOpId,
                orderId,
                action: 'restore',
                quantity: qty,
                variantId: item.variantId || null,
                claimId,
                createdAt: new Date()
              }],
              $slice: -200
            }
          }
        },
        { new: true }
      );

      if (!updated) {
        const currentActive = await Order.findOne({
          _id: orderId,
          inventoryClaimId: claimId,
          claimVersion: fencingToken
        });
        if (!currentActive) {
          await InventoryOperation.updateOne(
            {
              operationId: restoreOpId,
              status: 'pending',
              claimId: claimId,
              fencingToken: fencingToken
            },
            { $set: { status: 'failed' } }
          );
          return { restored: false, reason: 'Worker lost claim before stock update (stale worker fenced out)', fencedOut: true };
        }
      }

      // Step 3: Mark completed
      try {
        await InventoryOperation.updateOne(
          {
            operationId: restoreOpId,
            status: { $in: ['pending', 'reserved'] },
            claimId: claimId,
            fencingToken: fencingToken
          },
          { $set: { status: 'completed', completedAt: new Date() } }
        );
      } catch (dupErr) {
        if (dupErr.code !== 11000) throw dupErr;
      }

      // Step 4: Save order item state
      await Order.updateOne(
        { _id: orderId, 'products._id': item._id },
        {
          $set: { 'products.$.inventoryState': 'restored' },
          $push: {
            inventoryLogs: {
              action: 'item_restored',
              productId: item.productId,
              quantity: qty,
              timestamp: new Date(),
              status: 'success'
            }
          }
        }
      );
    }
  }

  const finalOrder = await Order.findOneAndUpdate(
    {
      _id: orderId,
      inventoryClaimId: claimId,
      claimVersion: fencingToken,
      inventoryStatus: 'restoring'
    },
    {
      $set: { inventoryStatus: 'restored' },
      $push: {
        inventoryLogs: {
          action: 'restoration_completed',
          timestamp: new Date(),
          status: 'success',
          message: `All items restored due to ${reason}`
        }
      }
    },
    { new: true }
  );

  await recordAuditLog({
    action: 'inventory.restore',
    resourceType: 'Order',
    resourceId: orderId,
    metadata: { reason, mode: 'durable' }
  });

  return { restored: true, order: finalOrder };
}

/**
 * Detects and recovers interrupted inventory operations caused by server crashes.
 * Inspects both the durable InventoryOperation collection and the Product document
 * to establish ground truth, guaranteeing no stock is lost, double-deducted, or double-restocked.
 */
async function recoverInterruptedInventory(orderId, options = {}) {
  const staleThreshold = new Date(Date.now() - 30000);
  const recoveryClaimId = `recovery_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  const order = await Order.findById(orderId);
  if (!order) {
    return { recovered: false, reason: 'Order not found' };
  }

  // 1. Prevent interrupting active workers:
  if (['deducting', 'restoring'].includes(order.inventoryStatus)) {
    const isClaimFresh = (order.inventoryHeartbeatAt && order.inventoryHeartbeatAt >= staleThreshold) ||
                         (!order.inventoryHeartbeatAt && order.inventoryClaimedAt && order.inventoryClaimedAt >= staleThreshold);
    if (isClaimFresh && options.forceStaleTakeover !== true) {
      return {
        recovered: false,
        reason: 'Active inventory worker in progress; recovery aborted to prevent race',
        activeWorker: true
      };
    }
  }

  // 2. Check if status even needs recovery:
  const eligibleStatuses = ['deducting', 'deduction_failed', 'recovery_required', 'restoring', 'restoration_failed'];
  if (!eligibleStatuses.includes(order.inventoryStatus)) {
    return { recovered: false, reason: `No recovery needed for status "${order.inventoryStatus}"` };
  }

  // 3. Atomic conditional takeover with incremented fencing token:
  const claimedOrder = await Order.findOneAndUpdate(
    {
      _id: orderId,
      $or: [
        { inventoryStatus: { $in: ['deduction_failed', 'recovery_required', 'restoration_failed'] } },
        {
          inventoryStatus: { $in: ['deducting', 'restoring'] },
          $or: [
            { inventoryHeartbeatAt: { $lt: staleThreshold } },
            { inventoryHeartbeatAt: null, inventoryClaimedAt: { $lt: staleThreshold } }
          ]
        }
      ]
    },
    {
      $set: {
        inventoryClaimId: recoveryClaimId,
        inventoryClaimedAt: new Date(),
        inventoryHeartbeatAt: new Date()
      },
      $inc: { claimVersion: 1 }
    },
    { new: true }
  );

  if (!claimedOrder) {
    return {
      recovered: false,
      reason: 'Order could not be claimed for recovery (active worker present or already recovered)'
    };
  }

  const recoveryFencingToken = claimedOrder.claimVersion;
  const isConnected = mongoose.connection?.readyState === 1;
  const topologyType = mongoose.connection?.client?.topology?.description?.type;
  const isReplicaSet = topologyType === 'ReplicaSetWithPrimary' || topologyType === 'Sharded';
  const hasSimulatedCrash = options.simulateCrashBoundary !== undefined ||
                            options.simulateCrashBeforeOpInsert !== undefined ||
                            options.simulateCrashAfterOpPendingBeforeStock !== undefined ||
                            options.simulateCrashAfterStockBeforeOpCompleted !== undefined ||
                            options.simulateCrashAfterItemIndex !== undefined ||
                            options.simulateCrashAfterOpCompletedBeforeOrderSave !== undefined ||
                            options.simulateCrashAfterRestoreIndex !== undefined ||
                            options.simulateFailureDuringRestore !== undefined;
  const useTransaction = isReplicaSet && options.forceCompensation !== true && !hasSimulatedCrash;

  if (options.simulateNoTransactions === true || (isConnected && !isReplicaSet && options.forceCompensation !== true)) {
    return {
      recovered: false,
      transactionUnavailable: true,
      reason: 'TransactionUnavailableError: MongoDB replica set transactions are required for inventory recovery.'
    };
  }

  if (useTransaction) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const freshOrder = await Order.findOne({
        _id: orderId,
        inventoryClaimId: recoveryClaimId,
        claimVersion: recoveryFencingToken
      }).session(session);

      if (!freshOrder) {
        throw new Error('RecoveryWorkerFencedOutError: Lost claim ownership before recovery transaction execution');
      }

      if (['deducting', 'deduction_failed', 'recovery_required'].includes(freshOrder.inventoryStatus)) {
        let rolledBackCount = 0;
        for (const item of freshOrder.products) {
          const deductOpId = `order_${freshOrder._id}_prod_${item.productId}_deduct`;
          const rollbackOpId = `order_${freshOrder._id}_prod_${item.productId}_rollback`;

          const durableDeduct = await InventoryOperation.findOne({ operationId: deductOpId }).session(session);
          const productDeduct = await Product.findOne({
            _id: item.productId,
            'inventoryOperations.operationId': deductOpId
          }).session(session);
          const wasDeducted = Boolean(productDeduct || (durableDeduct && ['completed', 'archived', 'active'].includes(durableDeduct.status)));

          if (wasDeducted) {
            if (durableDeduct && durableDeduct.status === 'pending') {
              await InventoryOperation.updateOne(
                { operationId: deductOpId, status: 'pending' },
                { $set: { status: 'completed', completedAt: new Date() } }
              ).session(session);
            }

            const durableRollback = await InventoryOperation.findOne({ operationId: rollbackOpId }).session(session);
            if (!durableRollback || !['completed', 'archived', 'active'].includes(durableRollback.status)) {
              await InventoryOperation.findOneAndUpdate(
                { operationId: rollbackOpId },
                {
                  $set: {
                    orderId: freshOrder._id,
                    productId: item.productId,
                    action: 'rollback',
                    quantity: item.quantity,
                    claimId: recoveryClaimId,
                    fencingToken: recoveryFencingToken,
                    status: 'completed',
                    completedAt: new Date()
                  }
                },
                { session, upsert: true }
              );

              const rollbackQuery = item.variantId
                ? { _id: item.productId, 'variants._id': item.variantId }
                : { _id: item.productId };
              const rollbackInc = item.variantId
                ? { 'variants.$.stock': item.quantity, stock: item.quantity }
                : { stock: item.quantity };

              await Product.findOneAndUpdate(
                rollbackQuery,
                {
                  $inc: rollbackInc,
                  $push: {
                    inventoryOperations: {
                      $each: [{
                        operationId: rollbackOpId,
                        orderId: freshOrder._id,
                        action: 'rollback',
                        quantity: item.quantity,
                        variantId: item.variantId || null,
                        claimId: recoveryClaimId,
                        createdAt: new Date()
                      }],
                      $slice: -200
                    }
                  }
                },
                { session, new: true }
              );
              rolledBackCount++;
            }
            item.inventoryState = 'rolled_back';
          } else {
            if (durableDeduct && durableDeduct.status === 'pending') {
              await InventoryOperation.updateOne(
                { operationId: deductOpId, status: 'pending' },
                { $set: { status: 'failed' } }
              ).session(session);
            }
            item.inventoryState = 'pending';
          }
        }

        freshOrder.inventoryStatus = 'not_deducted';
        freshOrder.failureReason = 'Recovered from interrupted deduction; all deducted stock returned to inventory';
        freshOrder.inventoryLogs.push({
          action: 'recovery_deduction_complete_transactional',
          timestamp: new Date(),
          status: 'recovered',
          message: `Recovered ${rolledBackCount} items from interrupted deduction via replica set transaction`
        });
        await freshOrder.save({ session });
        await session.commitTransaction();
        return { recovered: true, rolledBackCount, order: freshOrder };
      }

      if (['restoring', 'restoration_failed'].includes(freshOrder.inventoryStatus)) {
        let restoredCount = 0;
        for (const item of freshOrder.products) {
          const restoreOpId = `order_${freshOrder._id}_prod_${item.productId}_restore`;

          const durableRestore = await InventoryOperation.findOne({ operationId: restoreOpId }).session(session);
          const productRestore = await Product.findOne({
            _id: item.productId,
            'inventoryOperations.operationId': restoreOpId
          }).session(session);
          const alreadyRestored = Boolean(productRestore || (durableRestore && ['completed', 'archived', 'active'].includes(durableRestore.status)));

          if (!alreadyRestored && item.inventoryState !== 'rolled_back' && item.inventoryState !== 'restored') {
            await InventoryOperation.findOneAndUpdate(
              { operationId: restoreOpId },
              {
                $set: {
                  orderId: freshOrder._id,
                  productId: item.productId,
                  action: 'restore',
                  quantity: item.quantity,
                  claimId: recoveryClaimId,
                  fencingToken: recoveryFencingToken,
                  status: 'completed',
                  completedAt: new Date()
                }
              },
              { session, upsert: true }
            );

            const restoreQuery = item.variantId
              ? { _id: item.productId, 'variants._id': item.variantId }
              : { _id: item.productId };
            const restoreInc = item.variantId
              ? { 'variants.$.stock': item.quantity, stock: item.quantity }
              : { stock: item.quantity };

            await Product.findOneAndUpdate(
              restoreQuery,
              {
                $inc: restoreInc,
                $push: {
                  inventoryOperations: {
                    $each: [{
                      operationId: restoreOpId,
                      orderId: freshOrder._id,
                      action: 'restore',
                      quantity: item.quantity,
                      variantId: item.variantId || null,
                      claimId: recoveryClaimId,
                      createdAt: new Date()
                    }],
                    $slice: -200
                  }
                }
              },
              { session, new: true }
            );
            restoredCount++;
          }
          item.inventoryState = 'restored';
        }

        freshOrder.inventoryStatus = 'restored';
        freshOrder.inventoryLogs.push({
          action: 'recovery_restoration_complete_transactional',
          timestamp: new Date(),
          status: 'recovered',
          message: `Restored ${restoredCount} items via replica set recovery transaction`
        });
        await freshOrder.save({ session });
        await session.commitTransaction();
        return { recovered: true, restoredCount, order: freshOrder };
      }

      await session.commitTransaction();
      return { recovered: true, order: freshOrder };
    } catch (txErr) {
      await session.abortTransaction();
      return { recovered: false, reason: txErr.message };
    } finally {
      await session.endSession();
    }
  }

  if (['deducting', 'deduction_failed', 'recovery_required'].includes(order.inventoryStatus)) {
    let rolledBackCount = 0;

    for (const item of order.products) {
      const deductOpId = `order_${order._id}_prod_${item.productId}_deduct`;
      const rollbackOpId = `order_${order._id}_prod_${item.productId}_rollback`;

      const durableDeduct = await InventoryOperation.findOne({ operationId: deductOpId });
      const productDeduct = await Product.findOne({
        _id: item.productId,
        'inventoryOperations.operationId': deductOpId
      });

      // Ground truth reconciliation:
      // If durableDeduct is 'pending' AND productDeduct is null:
      // Process crashed at Boundary 2 (after pending op created, BEFORE stock changed).
      // Stock was NEVER changed on Product! Do not treat pending as proof that stock was changed!
      if (durableDeduct && durableDeduct.status === 'pending' && !productDeduct) {
        await InventoryOperation.updateOne(
          { operationId: deductOpId, status: 'pending' },
          { $set: { status: 'failed' } }
        );
      }

      // Stock was actually deducted only if product has the marker OR durable operation was completed/archived/active
      const wasDeducted = Boolean(
        productDeduct ||
        (durableDeduct && ['completed', 'archived', 'active'].includes(durableDeduct.status))
      );

      if (wasDeducted) {
        if (durableDeduct && durableDeduct.status === 'pending') {
          await InventoryOperation.updateOne(
            { operationId: deductOpId, status: 'pending' },
            { $set: { status: 'completed', completedAt: new Date() } }
          );
        }

        const durableRollback = await InventoryOperation.findOne({ operationId: rollbackOpId });
        const productRollback = await Product.findOne({
          _id: item.productId,
          'inventoryOperations.operationId': rollbackOpId
        });

        const alreadyRolledBack = Boolean(durableRollback || productRollback);

        if (!alreadyRolledBack) {
          try {
            await InventoryOperation.findOneAndUpdate(
              { operationId: rollbackOpId },
              {
                $setOnInsert: {
                  orderId: order._id,
                  productId: item.productId,
                  action: 'rollback',
                  quantity: item.quantity,
                  status: 'completed',
                  completedAt: new Date(),
                  createdAt: new Date()
                }
              },
              { upsert: true }
            );
          } catch (e) { }

          const rollbackQuery = item.variantId
            ? {
                _id: item.productId,
                'variants._id': item.variantId,
                'inventoryOperations.operationId': {
                  $nin: [rollbackOpId] // FIX: using $nin
                }
              }
            : {
                _id: item.productId,
                'inventoryOperations.operationId': {
                  $nin: [rollbackOpId] // FIX: using $nin
                }
              };
          const rollbackInc = item.variantId
            ? { 'variants.$.stock': item.quantity, stock: item.quantity }
            : { stock: item.quantity };

          await Product.findOneAndUpdate(
            rollbackQuery,
            {
              $inc: rollbackInc,
              $push: {
                inventoryOperations: {
                  $each: [{
                    operationId: rollbackOpId,
                    orderId: order._id,
                    action: 'rollback',
                    quantity: item.quantity,
                    variantId: item.variantId || null,
                    createdAt: new Date()
                  }],
                  $slice: -200
                }
              }
            }
          );
          rolledBackCount++;
        }

        await Order.updateOne(
          { _id: order._id, 'products._id': item._id },
          { $set: { 'products.$.inventoryState': 'rolled_back' } }
        );
      } else {
        await Order.updateOne(
          { _id: order._id, 'products._id': item._id },
          { $set: { 'products.$.inventoryState': 'pending' } }
        );
      }
    }

    order.inventoryStatus = 'not_deducted';
    order.failureReason = 'Recovered from interrupted deduction; all deducted stock returned to inventory';
    order.inventoryLogs.push({
      action: 'recovery_deduction_complete',
      timestamp: new Date(),
      status: 'recovered',
      message: `Recovered ${rolledBackCount} items from interrupted deduction`
    });
    await order.save();

    return { recovered: true, rolledBackCount, order };
  }

  if (['restoring', 'restoration_failed'].includes(order.inventoryStatus)) {
    let restoredCount = 0;

    for (const item of order.products) {
      const restoreOpId = `order_${order._id}_prod_${item.productId}_restore`;
      const rollbackOpId = `order_${order._id}_prod_${item.productId}_rollback`;

      const durableRestore = await InventoryOperation.findOne({ operationId: restoreOpId });
      const productRestore = await Product.findOne({
        _id: item.productId,
        'inventoryOperations.operationId': restoreOpId
      });

      // Ground truth reconciliation:
      // If productRestore is found OR durableRestore is completed/archived/active:
      const alreadyRestored = Boolean(
        productRestore ||
        (durableRestore && ['completed', 'archived', 'active'].includes(durableRestore.status))
      );

      if (!alreadyRestored) {
        const restoreQuery = item.variantId
          ? {
              _id: item.productId,
              'variants._id': item.variantId,
              'inventoryOperations.operationId': {
                $nin: [restoreOpId, rollbackOpId] // FIX: using $nin
              }
            }
          : {
              _id: item.productId,
              'inventoryOperations.operationId': {
                $nin: [restoreOpId, rollbackOpId] // FIX: using $nin
              }
            };
        const restoreInc = item.variantId
          ? { 'variants.$.stock': item.quantity, stock: item.quantity }
          : { stock: item.quantity };

        await Product.findOneAndUpdate(
          restoreQuery,
          {
            $inc: restoreInc,
            $push: {
              inventoryOperations: {
                $each: [{
                  operationId: restoreOpId,
                  orderId: order._id,
                  action: 'restore',
                  quantity: item.quantity,
                  variantId: item.variantId || null,
                  createdAt: new Date()
                }],
                $slice: -200
              }
            }
          }
        );

        await InventoryOperation.findOneAndUpdate(
          { operationId: restoreOpId },
          {
            $set: {
              orderId: order._id,
              productId: item.productId,
              action: 'restore',
              quantity: item.quantity,
              status: 'completed',
              completedAt: new Date()
            }
          },
          { upsert: true }
        );

        restoredCount++;
      } else {
        if (durableRestore && durableRestore.status === 'pending') {
          await InventoryOperation.updateOne(
            { operationId: restoreOpId, status: 'pending' },
            { $set: { status: 'completed', completedAt: new Date() } }
          );
        }
      }

      await Order.updateOne(
        { _id: order._id, 'products._id': item._id },
        { $set: { 'products.$.inventoryState': 'restored' } }
      );
    }

    order.inventoryStatus = 'restored';
    order.inventoryLogs.push({
      action: 'recovery_restoration_complete',
      timestamp: new Date(),
      status: 'recovered',
      message: `Recovered ${restoredCount} items from interrupted restoration`
    });
    await order.save();

    return { recovered: true, restoredCount, order };
  }

  return { recovered: false, reason: `No recovery needed for status "${order.inventoryStatus}"` };
}

/**
 * Classifies gateway errors to distinguish:
 * 1. Definite gateway rejection (4xx HTTP status from Razorpay, client business logic failure)
 *    where releasing the refund reservation is safe.
 * 2. Ambiguous timeout or connection failure (ETIMEDOUT, ECONNRESET, 5xx, or network abort)
 *    where Razorpay may have created the refund despite missing the response.
 */
function isDefiniteGatewayRejection(err) {
  if (!err) return false;

  // Test simulation flags
  if (err.isDefiniteRejection === true) return true;
  if (err.isTimeout === true || err.isAmbiguous === true) return false;

  const statusCode = err.statusCode || err.status || err.response?.status;
  const errorCode = err.error?.code || err.code;
  const message = String(err.error?.description || err.message || '').toLowerCase();

  // Transport, socket, or timeout failure -> AMBIGUOUS
  if (
    err.code === 'ECONNABORTED' ||
    err.code === 'ETIMEDOUT' ||
    err.code === 'ECONNRESET' ||
    err.code === 'ENOTFOUND' ||
    err.code === 'EAI_AGAIN' ||
    err.name === 'TimeoutError' ||
    message.includes('timeout') ||
    message.includes('etimedout') ||
    message.includes('socket hang up') ||
    message.includes('econnreset') ||
    message.includes('network error')
  ) {
    return false;
  }

  // 5xx Server errors -> AMBIGUOUS (gateway may have completed transaction before crashing)
  if (typeof statusCode === 'number' && statusCode >= 500) {
    return false;
  }

  // 4xx Client errors (excluding 408 Request Timeout and 429 Rate Limit) -> DEFINITE REJECTION
  // Razorpay returns 400 for BAD_REQUEST_ERROR (e.g. payment not captured, already refunded, invalid ID)
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 && statusCode !== 408 && statusCode !== 429) {
    return true;
  }

  // Known Razorpay definite rejection error codes
  const definiteCodes = [
    'BAD_REQUEST_ERROR',
    'GATEWAY_ERROR',
    'INVALID_PAYMENT_ID',
    'PAYMENT_NOT_CAPTURED',
    'PAYMENT_ALREADY_REFUNDED'
  ];
  if (errorCode && definiteCodes.includes(errorCode)) {
    return true;
  }

  // If no HTTP response or status was received at all, it's a transport failure -> AMBIGUOUS
  if (!statusCode && !err.response) {
    return false;
  }

  return false;
}

/**
 * Reconciles ambiguous refund outcomes using the installed Razorpay SDK method:
 * razorpay.payments.fetchMultipleRefund(paymentId)
 *
 * Safety protections:
 * 1. An empty list from Razorpay does NOT prove absence; reservation is kept held and moved to manual_review.
 * 2. If multiple partial refunds exist with matching amount and no unique attempt ID, avoids selecting the wrong one;
 *    moves to manual_review with reservation held.
 * 3. Concurrent reconciliation attempts are serialized via claim tokens and atomic document conditions
 *    ensuring the same gateway refund cannot be counted twice.
 */
async function reconcileOrderRefund(orderId, { mockGatewayRefunds } = {}) {
  const order = await Order.findById(orderId);
  if (!order) {
    return { success: false, reason: 'Order not found' };
  }

  if (!order.razorpayPaymentId) {
    return { success: false, reason: 'No payment ID associated with this order' };
  }

  // If already quarantined in manual_review, return early
  if (order.refundStatus === 'manual_review' || order.notes?.refundManualReviewRequired) {
    return {
      success: false,
      requiresManualReview: true,
      reason: 'Order refund is already quarantined in manual_review state. Manual review required.',
      order
    };
  }

  // Atomic claim to serialize reconciliation and prevent concurrent double-counting
  const claimToken = crypto.randomBytes(16).toString('hex');
  const claimedOrder = await Order.findOneAndUpdate(
    {
      _id: orderId,
      $or: [
        { 'notes.refundReconciliationClaimToken': { $in: [null, undefined, ''] } },
        { 'notes.refundReconciliationClaimedAt': { $lt: new Date(Date.now() - 30000) } } // 30s stale claim recovery
      ],
      $and: [
        {
          $or: [
            { 'notes.refundReconciliationRequired': true },
            { refundStatus: { $in: ['processing', 'initiated'] } }
          ]
        }
      ]
    },
    {
      $set: {
        'notes.refundReconciliationClaimToken': claimToken,
        'notes.refundReconciliationClaimedAt': new Date()
      }
    },
    { new: true }
  );

  if (!claimedOrder) {
    const fresh = await Order.findById(orderId);
    if (fresh?.refundStatus === 'completed' || fresh?.refundStatus === 'manual_review') {
      return { success: true, alreadyProcessed: true, order: fresh };
    }
    return {
      success: false,
      concurrentReconciliation: true,
      reason: 'Refund reconciliation already in progress by concurrent worker'
    };
  }

  try {
    const isSimulatedPayment = !hasRazorpayCredentials || claimedOrder.notes?.isSimulated || String(claimedOrder.razorpayPaymentId).includes('_', 4);

    let gatewayRefunds = [];

    if (mockGatewayRefunds !== undefined) {
      gatewayRefunds = Array.isArray(mockGatewayRefunds) ? mockGatewayRefunds : (mockGatewayRefunds?.items || []);
    } else if (hasRazorpayCredentials && !isSimulatedPayment) {
      try {
        const response = await razorpay.payments.fetchMultipleRefund(claimedOrder.razorpayPaymentId);
        gatewayRefunds = response?.items || [];
      } catch (fetchErr) {
        // Gateway query itself failed: release claim token but keep reservation held
        await Order.updateOne(
          { _id: orderId, 'notes.refundReconciliationClaimToken': claimToken },
          { $set: { 'notes.refundReconciliationClaimToken': null } }
        );
        return {
          success: false,
          reconciled: false,
          requiresReconciliation: true,
          reason: `Gateway reconciliation query failed: ${fetchErr.message}. Reservation remains held.`
        };
      }
    } else {
      // In simulated/test environment without credentials or mock gateway responses:
      // We cannot query the gateway, so outcome remains unknown. Keep reservation held.
      await Order.updateOne(
        { _id: orderId, 'notes.refundReconciliationClaimToken': claimToken },
        { $set: { 'notes.refundReconciliationClaimToken': null } }
      );
      return {
        success: false,
        reconciled: false,
        requiresReconciliation: true,
        reason: 'Gateway credentials missing and no mock gateway refunds provided. Cannot query gateway outcome. Reservation remains held.'
      };
    }

    // Find refunds already marked completed in order.refunds
    const recordedRefundIds = new Set(
      (claimedOrder.refunds || []).filter(r => r.status === 'completed' && r.refundId).map(r => r.refundId)
    );

    // Filter unrecorded gateway refunds
    const candidateRefunds = gatewayRefunds.filter(gr => !recordedRefundIds.has(gr.id));

    const expectedAmount = claimedOrder.notes?.ambiguousRefundAttempt?.amount || claimedOrder.reservedRefundAmount;
    const expectedAttemptId = claimedOrder.notes?.ambiguousRefundAttempt?.refundAttemptId;

    // 1. Primary Match: by unique refundAttemptId in gateway notes
    const attemptMatch = expectedAttemptId
      ? candidateRefunds.find(gr => gr.notes?.refundAttemptId === expectedAttemptId)
      : null;

    // 2. Secondary Match: by orderId and exact amount
    const candidatesByOrderAndAmount = candidateRefunds.filter(gr => {
      const matchesOrder = gr.notes?.orderId === claimedOrder._id.toString();
      const matchesAmt = Math.abs(roundCurrency((gr.amount || 0) / 100) - roundCurrency(expectedAmount)) < 0.001;
      return matchesOrder && matchesAmt;
    });

    const isAmbiguousAmountMatch = !attemptMatch && candidatesByOrderAndAmount.length > 1;
    const matchedRefund = attemptMatch || (candidatesByOrderAndAmount.length === 1 ? candidatesByOrderAndAmount[0] : null);

    if (matchedRefund) {
      // Definitive, unambiguous gateway acceptance confirmed!
      const refundAmt = roundCurrency((matchedRefund.amount || 0) / 100);
      const refundId = matchedRefund.id;
      const isProcessed = matchedRefund.status === 'processed';

      const isFullyRefunded = roundCurrency((claimedOrder.refundAmount || 0) + refundAmt) >= claimedOrder.totalAmount;

      // Atomic update preventing duplicate counting of the same gateway refund ID
      const updatedOrder = await Order.findOneAndUpdate(
        {
          _id: orderId,
          'notes.refundReconciliationClaimToken': claimToken,
          'refunds.refundId': { $ne: matchedRefund.id }
        },
        {
          $inc: {
            reservedRefundAmount: -refundAmt,
            refundAmount: isProcessed ? refundAmt : 0
          },
          $set: {
            refundId,
            refundStatus: isProcessed ? 'completed' : 'processing',
            'notes.refundReconciliationRequired': false,
            'notes.refundReconciliationClaimToken': null,
            'notes.ambiguousRefundAttempt': null,
            ...(isFullyRefunded ? { paymentStatus: 'refunded' } : {}),
            ...(isFullyRefunded && claimedOrder.status !== 'cancelled' ? { status: 'refunded' } : {})
          },
          $push: {
            refunds: {
              refundId,
              amount: refundAmt,
              reason: matchedRefund.notes?.reason || 'Reconciled gateway refund',
              status: isProcessed ? 'completed' : 'processing',
              initiatedAt: new Date(matchedRefund.created_at ? matchedRefund.created_at * 1000 : Date.now()),
              completedAt: isProcessed ? new Date() : null
            },
            statusHistory: {
              fromStatus: claimedOrder.status,
              toStatus: isFullyRefunded && claimedOrder.status !== 'cancelled' ? 'refunded' : claimedOrder.status,
              role: 'system',
              reason: `Ambiguous refund reconciled with gateway: ${refundId} (₹${refundAmt}, status: ${isProcessed ? 'completed' : 'processing'})`,
              timestamp: new Date()
            }
          }
        },
        { new: true }
      );

      if (!updatedOrder) {
        // Concurrently recorded by another worker
        const fresh = await Order.findById(orderId);
        return { success: true, alreadyProcessed: true, order: fresh };
      }

      if (isProcessed && isFullyRefunded) {
        if (updatedOrder.inventoryStatus === 'deducted') {
          await restoreOrderInventory(orderId, 'refund_reconciled');
        }
        if (updatedOrder.transferStatus === 'processed') {
          await Order.updateOne(
            { _id: orderId },
            {
              $set: {
                transferStatus: 'manual_review',
                transferError: `Order refunded after vendor transfer ${updatedOrder.transferId || ''} was processed. Manual financial reconciliation or clawback required.`,
                'notes.payoutReconciliationRequired': true
              }
            }
          );
        }
      }

      const finalOrder = await Order.findById(orderId);
      return {
        success: true,
        reconciled: true,
        acceptedByGateway: true,
        refund: matchedRefund,
        refundId,
        order: finalOrder
      };
    } else {
      // Gateway absence cannot be established reliably from an empty list or ambiguous matches.
      // KEEP RESERVATION HELD and move to manual_review state.
      const reviewReason = isAmbiguousAmountMatch
        ? `Multiple candidate gateway refunds of ₹${expectedAmount} found on payment ${claimedOrder.razorpayPaymentId}. Ambiguous match cannot be resolved automatically.`
        : `Gateway refund absence cannot be established reliably from empty or unmatched list. Reservation ₹${claimedOrder.reservedRefundAmount} held pending manual review.`;

      const reviewedOrder = await Order.findOneAndUpdate(
        {
          _id: orderId,
          'notes.refundReconciliationClaimToken': claimToken
        },
        {
          $set: {
            refundStatus: 'manual_review',
            failureReason: reviewReason,
            'notes.refundManualReviewRequired': true,
            'notes.refundReconciliationRequired': false,
            'notes.refundReconciliationClaimToken': null
          },
          $push: {
            statusHistory: {
              fromStatus: claimedOrder.status,
              toStatus: claimedOrder.status,
              role: 'system',
              reason: reviewReason,
              timestamp: new Date()
            }
          }
        },
        { new: true }
      );

      return {
        success: false,
        reconciled: false,
        requiresManualReview: true,
        isAmbiguousMatch: isAmbiguousAmountMatch,
        reason: reviewReason,
        order: reviewedOrder
      };
    }
  } catch (err) {
    // Release claim token on unexpected error so future reconciliation can run
    await Order.updateOne(
      { _id: orderId, 'notes.refundReconciliationClaimToken': claimToken },
      { $set: { 'notes.refundReconciliationClaimToken': null } }
    ).catch(() => {});

    throw err;
  }
}

/**
 * Safely and idempotently initiates a refund for a paid order.
 * Supports full and multiple partial refunds up to captured order total.
 * Marks paymentStatus 'refunded' ONLY when cumulative refunds equal order total
 * and the payment provider confirms completion.
 */
async function initiateOrderRefund(orderId, { amount, reason = 'Order refund', mockRefundResult, mockGatewayRefunds } = {}) {
  const order = await Order.findById(orderId);
  if (!order) {
    return { success: false, reason: 'Order not found' };
  }

  // Quarantined in manual_review?
  if (order.refundStatus === 'manual_review' || order.notes?.refundManualReviewRequired) {
    return {
      success: false,
      requiresManualReview: true,
      reason: 'Order refund is quarantined in manual_review state. Automatic refund attempts are disabled pending administrative financial review.',
      order
    };
  }

  // Pre-flight reconciliation gate:
  // If a previous ambiguous refund is awaiting reconciliation, reconcile FIRST before attempting another refund!
  if (order.notes?.refundReconciliationRequired) {
    const recon = await reconcileOrderRefund(orderId, { mockGatewayRefunds });
    if (!recon.reconciled) {
      if (recon.requiresManualReview) {
        return {
          success: false,
          requiresManualReview: true,
          reason: recon.reason,
          order: recon.order
        };
      }
      return {
        success: false,
        requiresReconciliation: true,
        reason: 'Previous refund attempt outcome is ambiguous and currently pending gateway reconciliation. Cannot submit duplicate refund until gateway status is confirmed.'
      };
    }
    if (recon.acceptedByGateway) {
      return {
        success: true,
        reconciled: true,
        alreadyProcessed: true,
        refund: recon.refund,
        refundId: recon.refund?.id,
        order: recon.order
      };
    }
  }

  // Calculate existing completed refunds
  const existingCompletedAmount = Array.isArray(order.refunds) && order.refunds.length > 0
    ? roundCurrency(order.refunds.filter(r => r.status === 'completed').reduce((sum, r) => sum + Number(r.amount || 0), 0))
    : roundCurrency(Number(order.refundAmount || 0));

  const existingReservedAmount = roundCurrency(Number(order.reservedRefundAmount || 0));

  // If order is already completely refunded
  if (order.paymentStatus === 'refunded' || existingCompletedAmount >= order.totalAmount) {
    return { success: true, alreadyRefunded: true, refundId: order.refundId, order };
  }

  if (order.paymentStatus !== 'paid' && !order.razorpayPaymentId) {
    return { success: false, reason: 'Only paid orders can be refunded' };
  }

  const remainingBalance = roundCurrency(Math.max(0, order.totalAmount - existingCompletedAmount - existingReservedAmount));

  // Validate amount parameter
  const requestedAmount = (amount !== undefined && amount !== null && amount !== '') ? Number(amount) : undefined;
  if (requestedAmount !== undefined && (!Number.isFinite(requestedAmount) || requestedAmount <= 0)) {
    return { success: false, reason: 'Refund amount must be a positive finite number' };
  }

  const refundAmount = requestedAmount !== undefined ? roundCurrency(requestedAmount) : remainingBalance;

  if (refundAmount <= 0) {
    if (existingCompletedAmount >= order.totalAmount) {
      return { success: true, alreadyRefunded: true, refundId: order.refundId, order };
    }
    return {
      success: false,
      reason: `No remaining balance available for refund (completed: ₹${existingCompletedAmount}, in-progress: ₹${existingReservedAmount})`
    };
  }

  if (refundAmount > remainingBalance + 0.001) {
    return {
      success: false,
      reason: `Requested refund amount ₹${refundAmount} exceeds remaining refundable balance ₹${remainingBalance}`
    };
  }

  // Atomic refund reservation:
  // Ensures that concurrent refund attempts cannot exceed the captured total amount.
  // The condition verifies that (refundAmount + reservedRefundAmount + newRefundAmount) <= totalAmount
  // and prevents duplicate concurrent execution on the same order.
  const claimedOrder = await Order.findOneAndUpdate(
    {
      _id: orderId,
      paymentStatus: 'paid',
      refundStatus: { $in: ['none', 'completed', 'failed'] },
      $expr: {
        $lte: [
          {
            $round: [
              {
                $add: [
                  { $ifNull: ["$refundAmount", 0] },
                  { $ifNull: ["$reservedRefundAmount", 0] },
                  refundAmount
                ]
              },
              2
            ]
          },
          { $add: ["$totalAmount", 0.001] }
        ]
      }
    },
    {
      $inc: { reservedRefundAmount: refundAmount },
      $set: { refundStatus: 'initiated' }
    },
    { new: true }
  );

  if (!claimedOrder) {
    const fresh = await Order.findById(orderId);
    if (!fresh) {
      return { success: false, reason: 'Order not found' };
    }
    if (fresh.paymentStatus === 'refunded' || (fresh.refundAmount || 0) >= fresh.totalAmount) {
      return { success: true, alreadyRefunded: true, refundId: fresh.refundId, order: fresh };
    }
    const freshCompleted = Number(fresh.refundAmount || 0);
    const freshReserved = Number(fresh.reservedRefundAmount || 0);
    const freshAvailable = roundCurrency(Math.max(0, fresh.totalAmount - freshCompleted - freshReserved));
    if (refundAmount > freshAvailable + 0.001) {
      return {
        success: false,
        reason: `Requested refund amount ₹${refundAmount} exceeds remaining refundable balance ₹${freshAvailable}`
      };
    }
    return { success: false, reason: 'Refund already in progress by concurrent process' };
  }

  const refundAttemptId = `rfatt_${claimedOrder._id}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  try {
    let refundId;
    let isProcessed = false;
    let refundObj = null;

    if (mockRefundResult) {
      if (mockRefundResult.status === 'failed') {
        const err = new Error(mockRefundResult.error || 'Gateway refund simulation failed');
        if (mockRefundResult.isDefiniteRejection === true || mockRefundResult.statusCode === 400) {
          err.statusCode = 400;
          err.isDefiniteRejection = true;
        } else if (mockRefundResult.isTimeout === true || mockRefundResult.isAmbiguous === true || mockRefundResult.code === 'ETIMEDOUT') {
          err.code = 'ETIMEDOUT';
          err.isTimeout = true;
        }
        throw err;
      }
      refundId = mockRefundResult.id || `mock_rfnd_${Date.now()}`;
      isProcessed = mockRefundResult.status === 'processed';
      refundObj = mockRefundResult;
      if (!refundObj.notes) refundObj.notes = {};
      if (!refundObj.notes.refundAttemptId) refundObj.notes.refundAttemptId = refundAttemptId;
    } else {
      const isSimulatedRefund = !hasRazorpayCredentials || !claimedOrder.razorpayPaymentId || claimedOrder.notes?.isSimulated || String(claimedOrder.razorpayPaymentId).includes('_', 4);

      if (isSimulatedRefund) {
        refundId = `sim_rfnd_${Date.now()}`;
        isProcessed = true;
        refundObj = { id: refundId, amount: toPaise(refundAmount), status: 'processed', notes: { orderId: claimedOrder._id.toString(), refundAttemptId } };
      } else {
        const refund = await razorpay.payments.refund(claimedOrder.razorpayPaymentId, {
          amount: toPaise(refundAmount),
          notes: {
            orderId: claimedOrder._id.toString(),
            refundAttemptId,
            reason
          }
        });
        refundId = refund.id;
        isProcessed = refund.status === 'processed';
        refundObj = refund;
      }
    }

    const refundRecord = {
      refundId,
      amount: refundAmount,
      reason,
      status: isProcessed ? 'completed' : 'processing',
      initiatedAt: new Date(),
      completedAt: isProcessed ? new Date() : null
    };

    if (isProcessed) {
      const completedTotal = roundCurrency(
        (Array.isArray(claimedOrder.refunds)
          ? claimedOrder.refunds.filter(r => r.status === 'completed').reduce((sum, r) => sum + Number(r.amount || 0), 0)
          : Number(claimedOrder.refundAmount || 0)) + refundAmount
      );
      const isFullyRefunded = completedTotal >= claimedOrder.totalAmount;

      const updatedOrder = await Order.findOneAndUpdate(
        { _id: orderId },
        {
          $inc: {
            reservedRefundAmount: -refundAmount,
            refundAmount: refundAmount
          },
          $set: {
            refundId,
            refundStatus: 'completed',
            paymentStatus: isFullyRefunded ? 'refunded' : 'paid',
            ...(isFullyRefunded && claimedOrder.status !== 'cancelled' ? { status: 'refunded' } : {})
          },
          $push: {
            refunds: refundRecord,
            statusHistory: {
              fromStatus: claimedOrder.status,
              toStatus: isFullyRefunded && claimedOrder.status !== 'cancelled' ? 'refunded' : claimedOrder.status,
              role: 'system',
              reason: `Refund completed: ${refundId} (₹${refundAmount}, status: completed)`,
              timestamp: new Date()
            }
          }
        },
        { new: true }
      );

      return { success: true, refund: refundObj, refundId, order: updatedOrder };
    } else {
      const updatedOrder = await Order.findOneAndUpdate(
        { _id: orderId },
        {
          $set: {
            refundId,
            refundStatus: 'processing'
          },
          $push: {
            refunds: refundRecord,
            statusHistory: {
              fromStatus: claimedOrder.status,
              toStatus: claimedOrder.status,
              role: 'system',
              reason: `Refund pending at gateway: ${refundId} (₹${refundAmount}, status: processing)`,
              timestamp: new Date()
            }
          }
        },
        { new: true }
      );

      return { success: true, refund: refundObj, refundId, order: updatedOrder };
    }
  } catch (err) {
    const isDefinite = isDefiniteGatewayRejection(err);

    if (isDefinite) {
      // 1. Definite gateway rejection: SAFE to immediately release reservation
      const failedOrder = await Order.findOneAndUpdate(
        { _id: orderId },
        {
          $inc: { reservedRefundAmount: -refundAmount },
          $set: {
            refundStatus: 'failed',
            failureReason: `Refund rejected by gateway: ${err.message}`
          },
          $push: {
            statusHistory: {
              fromStatus: claimedOrder.status,
              toStatus: claimedOrder.status,
              role: 'system',
              reason: `Definite gateway rejection: ${err.message} (₹${refundAmount} reservation released)`,
              timestamp: new Date()
            }
          }
        },
        { new: true }
      );

      if (failedOrder && failedOrder.reservedRefundAmount < 0) {
        await Order.updateOne({ _id: orderId }, { $set: { reservedRefundAmount: 0 } });
      }

      return {
        success: false,
        definiteRejection: true,
        reason: err.message,
        order: failedOrder
      };
    } else {
      // 2. Ambiguous timeout or connection failure:
      // DO NOT immediately release the reservation! Razorpay may have created the refund!
      // Keep refund in a pending/reconciliation state
      const ambiguousOrder = await Order.findOneAndUpdate(
        { _id: orderId },
        {
          $set: {
            refundStatus: 'processing',
            failureReason: `Ambiguous gateway outcome (timeout/network): ${err.message}. Reservation held pending reconciliation.`,
            'notes.refundReconciliationRequired': true,
            'notes.ambiguousRefundAttempt': {
              refundAttemptId,
              amount: refundAmount,
              reason,
              attemptedAt: new Date(),
              error: err.message
            }
          },
          $push: {
            statusHistory: {
              fromStatus: claimedOrder.status,
              toStatus: claimedOrder.status,
              role: 'system',
              reason: `Ambiguous refund outcome: ${err.message} (₹${refundAmount} reservation held pending gateway reconciliation)`,
              timestamp: new Date()
            }
          }
        },
        { new: true }
      );

      return {
        success: false,
        ambiguousOutcome: true,
        requiresReconciliation: true,
        reason: `Ambiguous refund outcome: ${err.message}. Refund reservation held pending gateway reconciliation.`,
        order: ambiguousOrder
      };
    }
  }
}

// Public health check for Razorpay configuration
router.get('/health/razorpay', async (req, res) => {
  res.json({
    configured: hasRazorpayCredentials,
    publicKey: hasRazorpayCredentials ? razorpayKeyId : '',
    message: hasRazorpayCredentials
      ? 'Razorpay is configured'
      : 'Razorpay credentials are missing on the server'
  });
});

async function buildOrderPayload(products) {
  let totalAmountPaise = 0;
  const orderProducts = [];
  let vendorId = null;

  for (const item of products) {
    if (!item?.productId) {
      const err = new Error('Product ID is required for all items');
      err.status = 400;
      throw err;
    }

    if (!mongoose.Types.ObjectId.isValid(item.productId)) {
      const err = new Error(`Invalid product ID format "${item.productId}"`);
      err.status = 400;
      throw err;
    }

    const qty = Number(item.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      const err = new Error(`Quantity for product ${item.productId} must be a positive integer`);
      err.status = 400;
      throw err;
    }

    const product = await Product.findById(item.productId);
    if (!product) {
      const err = new Error(`Product ${item.productId} not found`);
      err.status = 404;
      throw err;
    }

    let effectivePrice = Number(product.price);
    let effectiveStock = product.stock;
    let targetVariantId = null;
    let variantName = '';
    let variantSku = '';

    if (item.variantId) {
      if (!mongoose.Types.ObjectId.isValid(item.variantId)) {
        const err = new Error(`Invalid variant ID format "${item.variantId}"`);
        err.status = 400;
        throw err;
      }
      const variant = (product.variants || []).find(v => v._id.toString() === item.variantId.toString());
      if (!variant) {
        const err = new Error(`Selected variant not found for "${product.title}"`);
        err.status = 404;
        throw err;
      }
      if (variant.isActive === false) {
        const err = new Error(`Variant "${variant.name}" of "${product.title}" is currently inactive`);
        err.status = 400;
        throw err;
      }
      targetVariantId = variant._id;
      variantName = variant.name;
      variantSku = variant.sku || '';
      effectiveStock = variant.stock;
      if (variant.price !== undefined && variant.price !== null) {
        effectivePrice = Number(variant.price);
      }
    }

    if (effectiveStock < qty) {
      const label = variantName ? `"${product.title} (${variantName})"` : `"${product.title}"`;
      const err = new Error(`Insufficient stock for ${label} (${effectiveStock} available)`);
      err.status = 400;
      throw err;
    }

    if (!vendorId) {
      vendorId = product.vendorId;
    } else if (vendorId.toString() !== product.vendorId.toString()) {
      const err = new Error('All products must be from the same vendor');
      err.status = 400;
      throw err;
    }

    const unitPricePaise = toPaise(effectivePrice);
    const itemSubtotalPaise = unitPricePaise * qty;
    totalAmountPaise += itemSubtotalPaise;

    orderProducts.push({
      productId: product._id,
      variantId: targetVariantId,
      variantName,
      variantSku,
      quantity: qty,
      price: roundCurrency(unitPricePaise / 100)
    });
  }

  if (!vendorId) {
    throw new Error('Could not identify vendor for order');
  }

  const totalAmount = roundCurrency(totalAmountPaise / 100);
  const adminCommissionPaise = Math.round(totalAmountPaise * COMMISSION_RATE);
  const vendorEarningPaise = totalAmountPaise - adminCommissionPaise;

  const vendorEarning = roundCurrency(vendorEarningPaise / 100);
  const adminCommission = roundCurrency(adminCommissionPaise / 100);

  return {
    vendorId,
    totalAmount,
    vendorEarning,
    adminCommission,
    orderProducts
  };
}

/**
 * Crash-safe and idempotent vendor earnings recording.
 * Uses a MongoDB multi-document transaction when available (Atlas / replica set),
 * and conditional atomic updates with durable markers to guarantee earnings
 * are never double-credited even during crashes or concurrent worker races.
 */
async function recordVendorEarningsAtomic({ orderId, vendorId, amount, transferId }) {
  const creditAmount = roundCurrency(Number(amount || 0));
  if (creditAmount <= 0) return { credited: false, alreadyCredited: false };

  const topologyType = mongoose.connection?.client?.topology?.description?.type;
  const isReplicaSet = topologyType === 'ReplicaSetWithPrimary' || topologyType === 'Sharded';

  if (isReplicaSet) {
    const maxRetries = 5;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const session = await mongoose.startSession();
      try {
        session.startTransaction();

        // Condition: order must NOT have vendorEarningsCredited: true
        const updatedOrder = await Order.findOneAndUpdate(
          {
            _id: orderId,
            vendorEarningsCredited: { $ne: true }
          },
          {
            $set: {
              vendorEarningsCredited: true,
              vendorEarningsCreditedAt: new Date(),
              'notes.vendorEarningsRecorded': true
            }
          },
          { session, new: true }
        );

        if (!updatedOrder) {
          // Already credited by another worker or earlier transaction
          await session.abortTransaction();
          await session.endSession();
          return { credited: false, alreadyCredited: true };
        }

        // Atomically increment vendor totalPaidEarnings inside the same transaction
        const updatedVendor = await Vendor.findByIdAndUpdate(
          vendorId,
          {
            $inc: { totalPaidEarnings: creditAmount }
          },
          { session, new: true }
        );

        await session.commitTransaction();
        await session.endSession();
        return { credited: true, vendor: updatedVendor, order: updatedOrder };
      } catch (txErr) {
        if (session.inTransaction()) {
          await session.abortTransaction().catch(() => {});
        }
        await session.endSession().catch(() => {});

        const isTransient = txErr.hasErrorLabel && txErr.hasErrorLabel('TransientTransactionError');
        const isWriteConflict = txErr.code === 112 || txErr.codeName === 'WriteConflict' || isTransient;

        if (isWriteConflict && attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, 25 * (attempt + 1) + Math.floor(Math.random() * 25)));
          continue;
        }
        throw txErr;
      }
    }
  } else {
    // Standalone fallback: conditional claim on Order first, then atomic $inc on Vendor
    const updatedOrder = await Order.findOneAndUpdate(
      {
        _id: orderId,
        vendorEarningsCredited: { $ne: true }
      },
      {
        $set: {
          vendorEarningsCredited: true,
          vendorEarningsCreditedAt: new Date(),
          'notes.vendorEarningsRecorded': true
        }
      },
      { new: true }
    );

    if (!updatedOrder) {
      // Already credited
      return { credited: false, alreadyCredited: true };
    }

    try {
      const updatedVendor = await Vendor.findByIdAndUpdate(
        vendorId,
        {
          $inc: { totalPaidEarnings: creditAmount }
        },
        { new: true }
      );
      return { credited: true, vendor: updatedVendor, order: updatedOrder };
    } catch (vendorErr) {
      // Rollback marker if vendor update fails
      await Order.updateOne(
        { _id: orderId },
        {
          $set: {
            vendorEarningsCredited: false,
            vendorEarningsCreditedAt: null,
            'notes.vendorEarningsRecorded': false
          }
        }
      );
      throw vendorErr;
    }
  }
}

async function createVendorTransfer({ razorpayPaymentId, order }) {
  if (!order) return null;
  const orderDoc = await Order.findById(order._id);
  if (!orderDoc) return null;

  // If order is quarantined for manual review, permanently exclude from automatic retry and recovery
  if (orderDoc.transferStatus === 'manual_review') {
    order.transferId = orderDoc.transferId || '';
    order.transferStatus = 'manual_review';
    order.transferError = orderDoc.transferError;
    return {
      id: orderDoc.transferId || '',
      status: 'manual_review',
      error: orderDoc.transferError,
      requiresManualReview: true
    };
  }

  // Idempotency: If transfer is already completed or reversed, return existing record
  if (orderDoc.transferId && (orderDoc.transferStatus === 'processed' || orderDoc.transferStatus === 'reversed')) {
    order.transferId = orderDoc.transferId;
    order.transferStatus = orderDoc.transferStatus;
    return { id: orderDoc.transferId, status: orderDoc.transferStatus };
  }

  const vendor = await Vendor.findById(orderDoc.vendorId);
  if (!vendor || !vendor.razorpayAccountId) {
    orderDoc.transferId = '';
    orderDoc.transferStatus = 'not_initiated';
    orderDoc.transferError = 'Vendor payout account not configured yet';
    await orderDoc.save();
    order.transferId = '';
    order.transferStatus = 'not_initiated';
    order.transferError = orderDoc.transferError;
    return null;
  }

  const paymentId = razorpayPaymentId || orderDoc.razorpayPaymentId || order.razorpayPaymentId;
  if (!paymentId) {
    return null;
  }

  const isSimulatedPayment = !hasRazorpayCredentials || orderDoc.notes?.isSimulated || String(paymentId).includes('_', 4);

  // 1. RECONCILE WITH GATEWAY FIRST
  // Before submitting any new transfer to Razorpay, inspect existing transfers on this payment.
  // This safely resolves crash windows where Razorpay accepted the transfer but the worker
  // crashed before writing the transferId to MongoDB.
  if (hasRazorpayCredentials && !isSimulatedPayment) {
    try {
      const existingTransfers = await razorpay.payments.fetchTransfer(paymentId);
      const items = existingTransfers?.items || [];

      // Strict matching: requires exact order ID match and expected recipient account
      const matchedTransfer = items.find(t => {
        const matchesRecipient = t.recipient === vendor.razorpayAccountId || t.account === vendor.razorpayAccountId;
        const matchesOrderId = Boolean(t.notes?.orderId && t.notes.orderId === orderDoc._id.toString());
        return matchesRecipient && matchesOrderId;
      });

      if (matchedTransfer) {
        orderDoc.transferId = matchedTransfer.id;
        orderDoc.transferStatus = matchedTransfer.status === 'processed' ? 'processed' : (matchedTransfer.status === 'failed' ? 'failed' : 'queued');
        orderDoc.transferError = matchedTransfer.status === 'failed' ? (matchedTransfer.error?.description || 'Transfer failed') : '';
        await orderDoc.save();

        if (orderDoc.transferStatus === 'processed') {
          await recordVendorEarningsAtomic({
            orderId: orderDoc._id,
            vendorId: orderDoc.vendorId,
            amount: orderDoc.vendorEarning,
            transferId: matchedTransfer.id
          });
        }

        order.transferId = orderDoc.transferId;
        order.transferStatus = orderDoc.transferStatus;
        order.transferError = orderDoc.transferError;
        return matchedTransfer;
      }

      // Ambiguous check: If a transfer exists for this recipient on this payment but notes.orderId is missing,
      // do not mark processed, do not credit earnings, and do NOT submit another transfer.
      // Quarantines permanently in 'manual_review' state to exclude from automatic retries and stale recovery.
      const ambiguousTransfer = items.find(t => {
        const matchesRecipient = t.recipient === vendor.razorpayAccountId || t.account === vendor.razorpayAccountId;
        const missingOrderId = !t.notes || !t.notes.orderId;
        return matchesRecipient && missingOrderId;
      });

      if (ambiguousTransfer) {
        orderDoc.transferStatus = 'manual_review';
        orderDoc.transferError = `Ambiguous gateway transfer detected (${ambiguousTransfer.id}): recipient matches but notes.orderId is missing. Quarantined for manual administrator review.`;
        await orderDoc.save();
        order.transferId = '';
        order.transferStatus = 'manual_review';
        order.transferError = orderDoc.transferError;
        return {
          id: '',
          status: 'manual_review',
          error: orderDoc.transferError,
          requiresManualReview: true
        };
      }
    } catch (checkErr) {
      console.warn('Could not inspect existing transfers on payment:', checkErr.message);
    }
  }

  // 2. ACQUIRE ATOMIC STATE LOCK WITH UNIQUE CLAIM TOKEN & FENCING VERSION
  const claimToken = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const staleThreshold = new Date(Date.now() - 30000);

  const lockedOrder = await Order.findOneAndUpdate(
    {
      _id: orderDoc._id,
      $and: [
        {
          $or: [
            { transferStatus: { $in: ['not_initiated', 'failed'] } },
            { transferStatus: 'queued', transferClaimedAt: { $lt: staleThreshold } },
            { transferStatus: 'queued', transferClaimedAt: null }
          ]
        },
        {
          $or: [
            { transferId: '' },
            { transferId: null },
            { transferId: { $exists: false } }
          ]
        }
      ]
    },
    {
      $set: {
        transferStatus: 'queued',
        transferClaimedAt: new Date(),
        transferClaimToken: claimToken,
        transferError: ''
      },
      $inc: { transferClaimVersion: 1 }
    },
    { new: true }
  );

  if (!lockedOrder) {
    // Another concurrent worker is actively processing this claim right now (within 30s)
    const current = await Order.findById(orderDoc._id);
    order.transferId = current.transferId;
    order.transferStatus = current.transferStatus;
    return { id: current.transferId, status: current.transferStatus };
  }

  const claimVersion = lockedOrder.transferClaimVersion;

  // Fencing Check 1: Ensure worker still owns current claim before transfer submission
  const preCheck = await Order.findOne({
    _id: lockedOrder._id,
    transferClaimToken: claimToken,
    transferClaimVersion: claimVersion,
    transferStatus: 'queued'
  });
  if (!preCheck) {
    throw new Error(`WorkerFencedOutError: Worker lost claim ownership before transfer submission (token: ${claimToken})`);
  }

  const vendorAmountPaise = toPaise(lockedOrder.vendorEarning);
  let transfer;

  if (isSimulatedPayment) {
    transfer = {
      id: `trf_sim_${lockedOrder._id.toString().slice(-8)}_${Date.now()}`,
      entity: 'transfer',
      status: 'processed',
      amount: vendorAmountPaise,
      currency: 'INR',
      recipient: vendor.razorpayAccountId,
      created_at: Math.floor(Date.now() / 1000)
    };
  } else {
    let transferResponse;
    try {
      transferResponse = await razorpay.payments.transfer(paymentId, {
        transfers: [
          {
            account: vendor.razorpayAccountId,
            amount: vendorAmountPaise,
            currency: 'INR',
            notes: {
              orderId: lockedOrder._id.toString(),
              vendorId: lockedOrder.vendorId.toString(),
              commission: String(lockedOrder.adminCommission),
              transferRef: `xfer_${lockedOrder._id.toString()}_${lockedOrder.vendorId.toString()}`
            },
            on_hold: 0
          }
        ]
      });
      transfer = transferResponse?.items?.[0] || null;
      if (!transfer) {
        throw new Error('Transfer API did not return transfer details');
      }
    } catch (transferErr) {
      // 3. AMBIGUOUS TRANSFER RECONCILIATION
      // If transfer API call failed (e.g. timeout), the gateway may still have accepted it.
      // Re-check fetchTransfer before marking failed.
      try {
        const recheck = await razorpay.payments.fetchTransfer(paymentId);
        const recheckMatched = (recheck?.items || []).find(t => {
          const matchesRecipient = t.recipient === vendor.razorpayAccountId || t.account === vendor.razorpayAccountId;
          const matchesOrderId = Boolean(t.notes?.orderId && t.notes.orderId === lockedOrder._id.toString());
          return matchesRecipient && matchesOrderId;
        });
        if (recheckMatched) {
          transfer = recheckMatched;
        }
      } catch (recheckErr) { }

      if (!transfer) {
        await Order.updateOne(
          {
            _id: lockedOrder._id,
            transferClaimToken: claimToken,
            transferClaimVersion: claimVersion,
            transferStatus: 'queued'
          },
          {
            $set: {
              transferStatus: 'failed',
              transferError: transferErr.message
            }
          }
        );
        order.transferStatus = 'failed';
        order.transferError = transferErr.message;
        throw transferErr;
      }
    }
  }

  // Fencing Check 2 & Commit: Keep database state update strictly conditional on the current claim token/version
  const committedOrder = await Order.findOneAndUpdate(
    {
      _id: lockedOrder._id,
      transferClaimToken: claimToken,
      transferClaimVersion: claimVersion,
      transferStatus: 'queued'
    },
    {
      $set: {
        transferId: transfer.id,
        transferStatus: transfer.status === 'processed' ? 'processed' : (transfer.status === 'failed' ? 'failed' : 'queued'),
        transferError: transfer.status === 'failed' ? (transfer.error?.description || 'Transfer failed') : ''
      }
    },
    { new: true }
  );

  if (!committedOrder) {
    // Worker was fenced out by a newer worker while transfer was in-flight!
    // Stale worker must NOT credit vendor earnings or overwrite newer state.
    throw new Error(`WorkerFencedOutError: Worker lost claim ownership before commit (token: ${claimToken})`);
  }

  // Only credit vendor paid earnings if this fenced worker successfully committed 'processed' status
  if (committedOrder.transferStatus === 'processed') {
    await recordVendorEarningsAtomic({
      orderId: committedOrder._id,
      vendorId: committedOrder.vendorId,
      amount: committedOrder.vendorEarning,
      transferId: transfer.id
    });
  }

  order.transferId = committedOrder.transferId;
  order.transferStatus = committedOrder.transferStatus;
  order.transferError = committedOrder.transferError;

  return transfer;
}

/**
 * Normalizes and hashes the intentional checkout payload to detect idempotent retries vs conflicts.
 */
function computeCheckoutPayloadHash(products, shippingAddress) {
  const normalizedProducts = (Array.isArray(products) ? products : []).map(p => ({
    productId: String(p?.productId || ''),
    variantId: p?.variantId ? String(p.variantId) : '',
    quantity: Number(p?.quantity || 1)
  })).sort((a, b) => {
    const keyA = `${a.productId}_${a.variantId}`;
    const keyB = `${b.productId}_${b.variantId}`;
    return keyA.localeCompare(keyB);
  });

  const canonicalPayload = {
    products: normalizedProducts,
    shippingAddress: String(shippingAddress || '').trim().replace(/\s+/g, ' ')
  };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalPayload))
    .digest('hex');
}

/**
 * Unified, idempotent payment settlement for both frontend verification and webhooks.
 * Enforces:
 * - Payment, Razorpay order, marketplace order, amount, and currency matching.
 * - Atomic inventory deduction before successful payment confirmation.
 * - Automated refund if inventory deduction fails upon payment capture.
 * - Idempotent execution (duplicate frontend or webhook calls produce consistent state).
 * - No vendor payouts or commission recorded before payment is confirmed captured.
 */
async function settleOrderPayment({
  orderId,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
  paymentStatus, // 'captured' | 'failed' | 'authorized' | 'refunded'
  amountPaise,
  currency = 'INR',
  failureReason,
  source = 'frontend_verify',
  isSimulated = false
}) {
  let order;
  if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
    order = await Order.findById(orderId);
  } else if (razorpayOrderId) {
    order = await Order.findOne({ razorpayOrderId });
  }

  if (!order) {
    return { error: 'Order not found', statusCode: 404 };
  }

  // Idempotency & Terminal State Protections
  // 1. If order is already paid:
  if (order.paymentStatus === 'paid') {
    if (paymentStatus === 'captured' || paymentStatus === 'paid') {
      return { success: true, alreadySettled: true, order };
    }
    if (paymentStatus === 'failed' || paymentStatus === 'authorized') {
      // Stale failed or authorized event arriving after payment was already captured
      return { success: true, ignored: true, message: `Ignoring stale event '${paymentStatus}' for already paid order`, order };
    }
  }

  // 2. If order is already refunded or cancelled:
  if (order.paymentStatus === 'refunded' || order.status === 'cancelled') {
    if (paymentStatus === 'captured' || paymentStatus === 'paid' || paymentStatus === 'authorized') {
      return { success: false, ignored: true, error: `Cannot apply payment event '${paymentStatus}' to cancelled or refunded order`, statusCode: 409, order };
    }
    if (paymentStatus === 'failed') {
      return { success: true, alreadySettled: true, order };
    }
  }

  // 1. Payment Failed or Cancelled
  if (paymentStatus === 'failed') {
    if (order.paymentStatus !== 'created' && order.paymentStatus !== 'authorized') {
      return { success: true, ignored: true, message: `Ignoring failed payment event for order in state '${order.paymentStatus}'`, order };
    }
    order.paymentStatus = 'failed';
    order.status = 'cancelled';
    order.failureReason = failureReason || 'Payment failed or cancelled';
    if (order.inventoryStatus === 'deducted') {
      await restoreOrderInventory(order._id, 'payment_failed');
    }
    await order.save();

    await recordAuditLog({
      action: 'payment.state_change',
      resourceType: 'Order',
      resourceId: order._id.toString(),
      before: { paymentStatus: 'created' },
      after: { paymentStatus: 'failed', status: 'cancelled' },
      metadata: { failureReason: order.failureReason, source }
    });

    return { success: true, paymentStatus: 'failed', order };
  }

  // 2. Refund Processed
  if (paymentStatus === 'refunded') {
    order.paymentStatus = 'refunded';
    order.status = 'cancelled';
    if (order.inventoryStatus === 'deducted') {
      await restoreOrderInventory(order._id, 'refund_processed');
    }
    await order.save();
    return { success: true, paymentStatus: 'refunded', order };
  }

  // 3. Payment Authorized (Pending Capture)
  if (paymentStatus === 'authorized') {
    if (order.paymentStatus !== 'created') {
      return { success: true, alreadySettled: true, order };
    }
    // Deduct stock to hold items for authorized payment
    if (order.inventoryStatus !== 'deducted') {
      await deductOrderInventory(order._id);
      const refreshed = await Order.findById(order._id);
      if (refreshed) order = refreshed;
    }
    order.paymentStatus = 'authorized';
    order.razorpayPaymentId = razorpayPaymentId || order.razorpayPaymentId;
    if (razorpaySignature) order.razorpaySignature = razorpaySignature;
    // CRITICAL: Do NOT execute vendor payout or commission before capture!
    await order.save();

    await recordAuditLog({
      action: 'payment.state_change',
      resourceType: 'Order',
      resourceId: order._id.toString(),
      before: { paymentStatus: 'created' },
      after: { paymentStatus: 'authorized' },
      metadata: { source }
    });

    return { success: true, paymentStatus: 'authorized', order };
  }

  // 4. Payment Captured / Paid
  if (paymentStatus === 'captured' || paymentStatus === 'paid') {
    // Verify amount matches
    const expectedAmountPaise = toPaise(order.totalAmount);
    if (amountPaise !== undefined && amountPaise !== null && Number(amountPaise) !== expectedAmountPaise) {
      return {
        error: `Payment provider amount mismatch: expected ${expectedAmountPaise} paise, received ${amountPaise} paise`,
        statusCode: 400
      };
    }

    // Verify currency matches
    if (currency && String(currency).toUpperCase() !== 'INR') {
      return {
        error: `Payment provider currency mismatch: expected INR, received ${currency}`,
        statusCode: 400
      };
    }

    // Verify order ID matches
    if (razorpayOrderId && order.razorpayOrderId && razorpayOrderId !== order.razorpayOrderId) {
      return {
        error: 'Payment provider order mismatch',
        statusCode: 400
      };
    }

    if (razorpayPaymentId) order.razorpayPaymentId = razorpayPaymentId;
    if (razorpayOrderId && !order.razorpayOrderId) order.razorpayOrderId = razorpayOrderId;
    await order.save();

    // Atomically deduct inventory if not already deducted
    if (order.inventoryStatus !== 'deducted') {
      const deductionResult = await deductOrderInventory(order._id);
      if (!deductionResult.success) {
        // Inventory exhausted at time of capture! Automatically initiate refund
        const refundResult = await initiateOrderRefund(order._id, {
          amount: order.totalAmount,
          reason: `Stock exhausted before fulfillment: ${deductionResult.reason}`
        });

        const updatedOrder = await Order.findById(order._id);
        updatedOrder.status = 'cancelled';
        updatedOrder.failureReason = deductionResult.reason;
        if (refundResult.success && (refundResult.alreadyRefunded || updatedOrder.refundStatus === 'completed')) {
          updatedOrder.paymentStatus = 'refunded';
          updatedOrder.refundStatus = 'completed';
        } else if (refundResult.pending || updatedOrder.refundStatus === 'initiated' || updatedOrder.refundStatus === 'processing') {
          updatedOrder.paymentStatus = 'paid';
          updatedOrder.refundStatus = updatedOrder.refundStatus || 'processing';
        } else {
          updatedOrder.paymentStatus = 'paid';
          updatedOrder.refundStatus = 'failed';
        }
        await updatedOrder.save();

        return {
          success: false,
          error: `Payment received, but stock could not be fulfilled (${deductionResult.reason}). Automated refund initiated.`,
          refundInitiated: true,
          statusCode: 400,
          order: updatedOrder
        };
      }

      // Reload order document to sync state updated by deductOrderInventory transaction
      const refreshed = await Order.findById(order._id);
      if (refreshed) order = refreshed;
    }

    // Update order fields
    order.razorpayPaymentId = razorpayPaymentId || order.razorpayPaymentId;
    if (razorpaySignature) order.razorpaySignature = razorpaySignature;
    order.paymentStatus = 'paid';
    order.status = 'confirmed';
    order.paymentMethod = isSimulated ? 'simulated' : 'razorpay';

    // Vendor transfer (idempotent: only if transfer has not already been initiated)
    if (order.transferStatus === 'not_initiated') {
      try {
        await createVendorTransfer({ razorpayPaymentId: order.razorpayPaymentId, order });
      } catch (transferError) {
        order.transferStatus = 'failed';
        order.transferError = transferError.message;
      }
    }

    await order.save();

    // Record Commission
    await Commission.findOneAndUpdate(
      { orderId: order._id },
      {
        orderId: order._id,
        totalAmount: order.totalAmount,
        vendorEarning: order.vendorEarning,
        commissionAmount: order.adminCommission,
        commissionRate: order.commissionRate
      },
      { new: true, upsert: true }
    );

    // Update Vendor Earnings only once
    if (!order.notes?.vendorEarningsRecorded) {
      const vendor = await Vendor.findById(order.vendorId);
      if (vendor) {
        vendor.totalEarnings += order.vendorEarning;
        await vendor.save();
      }
      order.notes = { ...(order.notes || {}), vendorEarningsRecorded: true };
      await order.save();
    }

    await recordAuditLog({
      action: 'payment.state_change',
      resourceType: 'Order',
      resourceId: order._id.toString(),
      before: { paymentStatus: 'created' },
      after: { paymentStatus: 'paid', status: order.status },
      metadata: { paymentId: order.razorpayPaymentId, source }
    });

    if (global.orderEventEmitter && notificationDeduplicator.shouldDispatch(`orderPlaced:${order._id}`)) {
      global.orderEventEmitter.emit('orderPlaced', {
        orderId: order._id.toString(),
        vendorId: order.vendorId.toString(),
        buyerId: order.buyerId.toString(),
        totalAmount: order.totalAmount,
        paymentStatus: order.paymentStatus
      });
    }

    return { success: true, order };
  }

  return { error: `Unrecognized payment status: ${paymentStatus}`, statusCode: 400 };
}

// Mandatory payment flow: create Razorpay order
router.post('/create-razorpay-order', authenticate, authorize('buyer'), async (req, res) => {
  try {
    const isSimulatedRequest = (req.body.paymentProvider === 'simulated' || req.headers['x-payment-provider'] === 'simulated') && process.env.NODE_ENV !== 'production';

    if (!hasRazorpayCredentials && !isSimulatedRequest) {
      return res.status(503).json({
        message: 'Razorpay credentials are not configured on server',
        details: 'Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in backend/.env and restart backend server.'
      });
    }

    const rawKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || req.body?.idempotencyKey;
    const idempotencyKey = rawKey ? String(rawKey).trim() : null;
    const { products, shippingAddress, addressId } = req.body;

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: 'Products are required' });
    }

    let finalShippingAddress = shippingAddress ? String(shippingAddress).trim() : '';

    if (addressId) {
      if (!mongoose.Types.ObjectId.isValid(addressId)) {
        return res.status(400).json({ message: 'Invalid address ID format' });
      }
      const savedAddress = await Address.findById(addressId);
      if (!savedAddress) {
        return res.status(404).json({ message: 'Selected address not found' });
      }
      if (savedAddress.userId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Access denied: You do not own this address' });
      }
      if (!finalShippingAddress) {
        finalShippingAddress = typeof savedAddress.toSnapshotString === 'function'
          ? savedAddress.toSnapshotString()
          : `${savedAddress.fullName}, ${savedAddress.addressLine1}, ${savedAddress.city}, ${savedAddress.state} - ${savedAddress.postalCode}. Phone: ${savedAddress.phone}`;
      }
    }

    if (!finalShippingAddress) {
      return res.status(400).json({ message: 'Shipping address is required' });
    }

    const payloadHash = computeCheckoutPayloadHash(products, finalShippingAddress);

    // If an idempotency key is provided, check for existing order
    if (idempotencyKey) {
      const existingOrder = await Order.findOne({ buyerId: req.user._id, idempotencyKey });
      if (existingOrder) {
        if (existingOrder.payloadHash && existingOrder.payloadHash !== payloadHash) {
          return res.status(409).json({
            message: 'Idempotency conflict: A request with this idempotency key was previously created with different checkout parameters.',
            code: 'IDEMPOTENCY_CONFLICT'
          });
        }

        // Edge Case B: If existingOrder exists but razorpayOrderId was not saved (e.g. crash after gateway creation before save)
        if (!existingOrder.razorpayOrderId && hasRazorpayCredentials) {
          const expectedReceipt = `order_${existingOrder._id.toString().slice(-12)}`;
          try {
            const list = await razorpay.orders.all({ count: 10 });
            const matched = (list?.items || []).find(o => o.receipt === expectedReceipt);
            if (matched) {
              existingOrder.razorpayOrderId = matched.id;
              existingOrder.notes = { ...(existingOrder.notes || {}), razorpayOrder: matched };
              await existingOrder.save();
            }
          } catch (e) {
            console.warn('Failed to query gateway for receipt:', e.message);
          }
        }

        const cachedRazorpayOrder = existingOrder.notes?.razorpayOrder || {
          id: existingOrder.razorpayOrderId,
          amount: toPaise(existingOrder.totalAmount),
          currency: 'INR'
        };

        return res.status(200).json({
          message: 'Existing order retrieved (idempotent)',
          idempotent: true,
          key: razorpayKeyId || 'simulated_key_id',
          orderId: existingOrder._id,
          amount: existingOrder.totalAmount,
          currency: 'INR',
          commissionRate: existingOrder.commissionRate,
          vendorEarning: existingOrder.vendorEarning,
          adminCommission: existingOrder.adminCommission,
          razorpayOrder: cachedRazorpayOrder
        });
      }
    }

    const payload = await buildOrderPayload(products);

    let order;
    try {
      order = await Order.create({
        buyerId: req.user._id,
        vendorId: payload.vendorId,
        products: payload.orderProducts,
        totalAmount: payload.totalAmount,
        vendorEarning: payload.vendorEarning,
        adminCommission: payload.adminCommission,
        commissionRate: COMMISSION_RATE,
        shippingAddress: finalShippingAddress.trim(),
        paymentStatus: 'created',
        transferStatus: 'not_initiated',
        idempotencyKey,
        payloadHash
      });
    } catch (createErr) {
      if (createErr.code === 11000 && idempotencyKey) {
        let concurrentOrder = await Order.findOne({ buyerId: req.user._id, idempotencyKey });
        let retries = 0;
        while (concurrentOrder && !concurrentOrder.razorpayOrderId && retries < 15) {
          await new Promise(r => setTimeout(r, 100));
          concurrentOrder = await Order.findOne({ buyerId: req.user._id, idempotencyKey });
          retries++;
        }

        if (concurrentOrder) {
          if (concurrentOrder.payloadHash && concurrentOrder.payloadHash !== payloadHash) {
            return res.status(409).json({
              message: 'Idempotency conflict: A request with this idempotency key was previously created with different checkout parameters.',
              code: 'IDEMPOTENCY_CONFLICT'
            });
          }

          const cachedRazorpayOrder = concurrentOrder.notes?.razorpayOrder || {
            id: concurrentOrder.razorpayOrderId,
            amount: toPaise(concurrentOrder.totalAmount),
            currency: 'INR'
          };

          return res.status(200).json({
            message: 'Existing order retrieved (idempotent race resolution)',
            idempotent: true,
            key: razorpayKeyId || 'simulated_key_id',
            orderId: concurrentOrder._id,
            amount: concurrentOrder.totalAmount,
            currency: 'INR',
            commissionRate: concurrentOrder.commissionRate,
            vendorEarning: concurrentOrder.vendorEarning,
            adminCommission: concurrentOrder.adminCommission,
            razorpayOrder: cachedRazorpayOrder
          });
        }
      }
      throw createErr;
    }

    let razorpayOrder;
    if (isSimulatedRequest) {
      const simOrderId = `sim_order_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      razorpayOrder = {
        id: simOrderId,
        entity: 'order',
        amount: toPaise(payload.totalAmount),
        amount_paid: 0,
        amount_due: toPaise(payload.totalAmount),
        currency: 'INR',
        receipt: `order_${order._id.toString().slice(-12)}`,
        status: 'created',
        attempts: 0,
        notes: {
          appOrderId: order._id.toString(),
          buyerId: req.user._id.toString(),
          vendorId: payload.vendorId.toString()
        },
        created_at: Math.floor(Date.now() / 1000)
      };
      order.notes = { ...(order.notes || {}), isSimulated: true };
    } else {
      try {
        razorpayOrder = await razorpay.orders.create({
          amount: toPaise(payload.totalAmount),
          currency: 'INR',
          receipt: `order_${order._id.toString().slice(-12)}`,
          payment_capture: 1,
          notes: {
            appOrderId: order._id.toString(),
            buyerId: req.user._id.toString(),
            vendorId: payload.vendorId.toString()
          }
        });
      } catch (rzpErr) {
        await Order.deleteOne({ _id: order._id });
        throw rzpErr;
      }
    }

    order.razorpayOrderId = razorpayOrder.id;
    order.notes = { ...(order.notes || {}), razorpayOrder };
    await order.save();

    res.status(201).json({
      message: 'Razorpay order created',
      key: isSimulatedRequest ? 'simulated_key_id' : razorpayKeyId,
      orderId: order._id,
      amount: payload.totalAmount,
      currency: 'INR',
      commissionRate: COMMISSION_RATE,
      vendorEarning: payload.vendorEarning,
      adminCommission: payload.adminCommission,
      razorpayOrder
    });
  } catch (error) {
    if (error.statusCode === 409 || error.status === 409) {
      return res.status(409).json({
        message: error.message || 'Idempotency conflict',
        code: 'IDEMPOTENCY_CONFLICT'
      });
    }
    console.error('Error creating Razorpay order:', error);
    const errorMessage = error.error?.description || error.description || error.message || 'Server error';
    const statusCode = /not found|Insufficient stock|same vendor|positive integer|Invalid product ID|Invalid variant ID|Product ID is required/i.test(errorMessage) ? 400 : (error.statusCode || error.status || 500);
    res.status(statusCode).json({ message: `Razorpay Error: ${errorMessage}`, details: error.error || error.message });
  }
});

// Verify signature, mark paid, then transfer vendor share
router.post('/verify-payment', authenticate, authorize('buyer'), async (req, res) => {
  try {
    const {
      orderId,
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: razorpaySignature,
      isSimulated: clientSimulated,
      simulatedPaymentDetails
    } = req.body;

    if (!orderId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({ message: 'Missing Razorpay payment verification fields' });
    }

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: 'Invalid order ID format' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.buyerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to verify this order' });
    }

    // Check if order is already verified (idempotency)
    if (order.paymentStatus === 'paid' && order.inventoryStatus === 'deducted') {
      return res.json({ message: 'Payment already verified', order });
    }

    if (order.razorpayOrderId !== razorpayOrderId) {
      return res.status(400).json({ message: 'Razorpay order mismatch' });
    }

    const isSimulated = Boolean(order.notes?.isSimulated || clientSimulated) && process.env.NODE_ENV !== 'production';
    const secret = isSimulated
      ? (process.env.RAZORPAY_KEY_SECRET || 'simulated_test_secret')
      : razorpayKeySecret;

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    if (expectedSignature !== razorpaySignature) {
      // Risk 1 Audit Fix: Do NOT mutate order state or mark order as failed.
      // Rejection must leave order in its current state ('created') without stock consumption or state changes.
      return res.status(400).json({ message: 'Payment verification failed (invalid signature)' });
    }

    let paymentStatus = 'captured';
    let paymentAmountPaise = toPaise(order.totalAmount);
    let paymentCurrency = 'INR';

    // Verify payment details with provider if configured and not simulated
    if (hasRazorpayCredentials && !isSimulated && !String(razorpayPaymentId).includes('_', 4)) {
      try {
        const paymentDetails = await razorpay.payments.fetch(razorpayPaymentId);
        if (paymentDetails) {
          if (paymentDetails.status) {
            paymentStatus = paymentDetails.status;
          }
          if (paymentDetails.amount) {
            paymentAmountPaise = paymentDetails.amount;
          }
          if (paymentDetails.currency) {
            paymentCurrency = paymentDetails.currency;
          }
        }
      } catch (fetchErr) {
        console.error('Error fetching payment details from Razorpay:', fetchErr.message);
      }
    } else if (isSimulated && simulatedPaymentDetails) {
      if (simulatedPaymentDetails.status) paymentStatus = simulatedPaymentDetails.status;
      if (simulatedPaymentDetails.amount !== undefined) paymentAmountPaise = simulatedPaymentDetails.amount;
      if (simulatedPaymentDetails.currency) paymentCurrency = simulatedPaymentDetails.currency;
    }

    const result = await settleOrderPayment({
      orderId: order._id,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      paymentStatus,
      amountPaise: paymentAmountPaise,
      currency: paymentCurrency,
      source: 'frontend_verify',
      isSimulated
    });

    if (result.error) {
      return res.status(result.statusCode || 400).json({
        message: result.error,
        order: result.order || order
      });
    }

    res.json({ message: 'Payment verified and transfer initiated', order: result.order });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Explicit payment cancellation endpoint
router.post('/:id/cancel-payment', authenticate, authorize('buyer'), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid order ID format' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.buyerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (order.paymentStatus === 'paid') {
      return res.status(400).json({ message: 'Cannot cancel an already paid order' });
    }

    const result = await settleOrderPayment({
      orderId: order._id,
      paymentStatus: 'failed',
      failureReason: req.body.reason || 'Payment cancelled by user',
      source: 'frontend_cancel'
    });

    res.json({ message: 'Payment cancelled successfully', order: result.order });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Razorpay webhook
router.post('/webhook/razorpay', async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret';
    const signature = req.headers['x-razorpay-signature'];

    if (!signature) {
      return res.status(400).json({ message: 'Webhook signature missing' });
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body || {});
    const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

    if (expected !== signature) {
      return res.status(400).json({ message: 'Invalid webhook signature' });
    }

    const eventPayload = Buffer.isBuffer(req.body)
      ? JSON.parse(req.body.toString('utf8'))
      : req.body;
    const event = eventPayload?.event;
    const paymentEntity = eventPayload?.payload?.payment?.entity;
    const refundEntity = eventPayload?.payload?.refund?.entity;

    if (event === 'payment.failed' && paymentEntity?.order_id) {
      await settleOrderPayment({
        razorpayOrderId: paymentEntity.order_id,
        razorpayPaymentId: paymentEntity.id,
        paymentStatus: 'failed',
        failureReason: paymentEntity.error_description || paymentEntity.error_reason || 'Payment failed',
        source: 'webhook'
      });
    } else if (event === 'payment.captured' && paymentEntity?.order_id) {
      const result = await settleOrderPayment({
        razorpayOrderId: paymentEntity.order_id,
        razorpayPaymentId: paymentEntity.id,
        paymentStatus: 'captured',
        amountPaise: paymentEntity.amount,
        currency: paymentEntity.currency,
        source: 'webhook'
      });
      if (result.error) {
        return res.status(result.statusCode || 400).json({ message: result.error });
      }
    } else if (event === 'payment.authorized' && paymentEntity?.order_id) {
      await settleOrderPayment({
        razorpayOrderId: paymentEntity.order_id,
        razorpayPaymentId: paymentEntity.id,
        paymentStatus: 'authorized',
        amountPaise: paymentEntity.amount,
        currency: paymentEntity.currency,
        source: 'webhook'
      });
    } else if (event === 'refund.processed' && refundEntity?.payment_id) {
      const order = await Order.findOne({ razorpayPaymentId: refundEntity.payment_id });
      if (order) {
        const refundId = refundEntity.id || order.refundId;
        const refundAmt = roundCurrency((refundEntity.amount || 0) / 100);

        order.refunds = order.refunds || [];
        const existingRecord = order.refunds.find(r => r.refundId === refundId);

        if (existingRecord && existingRecord.status === 'completed') {
          // Idempotent: already processed
          return res.json({ status: 'ok', alreadyProcessed: true });
        }

        const wasProcessing = existingRecord && existingRecord.status === 'processing';

        if (existingRecord) {
          existingRecord.status = 'completed';
          existingRecord.completedAt = new Date();
        } else {
          order.refunds.push({
            refundId,
            amount: refundAmt,
            reason: refundEntity.notes?.reason || 'Gateway webhook refund',
            status: 'completed',
            initiatedAt: new Date(refundEntity.created_at ? refundEntity.created_at * 1000 : Date.now()),
            completedAt: new Date()
          });
        }

        if (wasProcessing) {
          order.reservedRefundAmount = Math.max(0, roundCurrency((order.reservedRefundAmount || 0) - refundAmt));
        }

        const completedTotal = roundCurrency(
          order.refunds.filter(r => r.status === 'completed').reduce((sum, r) => sum + Number(r.amount || 0), 0)
        );

        order.refundId = refundId;
        order.refundAmount = completedTotal;
        order.refundStatus = 'completed';

        if (completedTotal >= order.totalAmount) {
          order.paymentStatus = 'refunded';
          if (order.status !== 'cancelled') {
            order.status = 'refunded';
          }
          if (order.inventoryStatus === 'deducted') {
            await restoreOrderInventory(order._id, 'refund_processed');
          }

          // Vendor payout handling: if transfer already processed, flag for manual review
          if (order.transferStatus === 'processed') {
            order.transferStatus = 'manual_review';
            order.transferError = `Order refunded after vendor transfer ${order.transferId || ''} was processed. Manual financial reconciliation or clawback required.`;
            order.notes = order.notes || {};
            order.notes.payoutReconciliationRequired = true;
          } else if (!order.notes?.vendorEarningsReversed) {
            if (order.vendorEarningsCredited) {
              await Vendor.findByIdAndUpdate(order.vendorId, {
                $inc: { totalEarnings: -order.vendorEarning }
              });
              order.vendorEarningsCredited = false;
            }
            order.notes = order.notes || {};
            order.notes.vendorEarningsReversed = true;
          }
        }

        if (order.notes?.refundReconciliationRequired) {
          order.notes.refundReconciliationRequired = false;
          order.notes.ambiguousRefundAttempt = null;
          order.markModified('notes');
        }

        order.statusHistory = order.statusHistory || [];
        order.statusHistory.push({
          fromStatus: order.status,
          toStatus: order.status,
          role: 'webhook',
          reason: `Gateway refund processed: ${refundId} (₹${refundAmt}, cumulative: ₹${completedTotal})`,
          timestamp: new Date()
        });

        await order.save();

        await recordAuditLog({
          action: 'refund.state_change',
          resourceType: 'Order',
          resourceId: order._id.toString(),
          before: { refundStatus: 'processing' },
          after: { refundStatus: 'completed', refundAmount: completedTotal, paymentStatus: order.paymentStatus },
          metadata: { refundId, amount: refundAmt, source: 'webhook' }
        });

        if (global.orderEventEmitter && notificationDeduplicator.shouldDispatch(`refundProcessed:${refundId}`)) {
          global.orderEventEmitter.emit('orderStatusUpdated', {
            orderId: order._id.toString(),
            buyerId: order.buyerId.toString(),
            vendorId: order.vendorId.toString(),
            status: order.status
          });
        }
      }
    } else if (event === 'refund.failed' && refundEntity?.payment_id) {
      const order = await Order.findOne({ razorpayPaymentId: refundEntity.payment_id });
      if (order) {
        const refundId = refundEntity.id || order.refundId;
        const refundAmt = roundCurrency((refundEntity.amount || 0) / 100);

        order.refunds = order.refunds || [];
        const existingRecord = order.refunds.find(r => r.refundId === refundId);

        if (existingRecord && existingRecord.status === 'failed') {
          return res.json({ status: 'ok', alreadyProcessed: true });
        }

        if (existingRecord) {
          existingRecord.status = 'failed';
        }

        // Release reservation safely
        order.reservedRefundAmount = Math.max(0, roundCurrency((order.reservedRefundAmount || 0) - refundAmt));
        order.refundStatus = 'failed';
        order.failureReason = refundEntity.error_description || 'Gateway refund failed';

        if (order.notes?.refundReconciliationRequired) {
          order.notes.refundReconciliationRequired = false;
          order.notes.ambiguousRefundAttempt = null;
          order.markModified('notes');
        }

        order.statusHistory = order.statusHistory || [];
        order.statusHistory.push({
          fromStatus: order.status,
          toStatus: order.status,
          role: 'webhook',
          reason: `Gateway refund failed: ${refundId} (₹${refundAmt} reservation released)`,
          timestamp: new Date()
        });

        await order.save();

        await recordAuditLog({
          action: 'refund.state_change',
          resourceType: 'Order',
          resourceId: order._id.toString(),
          before: { refundStatus: 'processing' },
          after: { refundStatus: 'failed', reservedRefundAmount: order.reservedRefundAmount },
          metadata: { refundId, amount: refundAmt, source: 'webhook', reason: order.failureReason }
        });
      }
    }

    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ message: 'Webhook processing failed', error: error.message });
  }
});

// Backward compatibility endpoint for old checkout flow
router.post('/', authenticate, authorize('buyer'), async (req, res) => {
  return res.status(400).json({
    message: 'Direct order creation is disabled. Please use /api/orders/create-razorpay-order and /api/orders/verify-payment.'
  });
});

// Refund API (admin only)
router.post('/:id/refund', authenticate, authorize('admin'), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid order ID format' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (!order.razorpayPaymentId || order.paymentStatus !== 'paid') {
      return res.status(400).json({ message: 'Only paid Razorpay orders can be refunded' });
    }

    const requestedAmount = (req.body.amount !== undefined && req.body.amount !== null && req.body.amount !== '')
      ? Number(req.body.amount)
      : undefined;

    const refundRes = await initiateOrderRefund(order._id, {
      amount: requestedAmount,
      reason: req.body.reason || 'Admin initiated refund'
    });

    if (!refundRes.success && !refundRes.alreadyRefunded) {
      return res.status(400).json({ message: refundRes.reason || 'Refund failed', error: refundRes.reason });
    }

    const updatedOrder = await Order.findById(order._id);
    // If full refund reached, restore inventory and update status
    if (updatedOrder.paymentStatus === 'refunded' || updatedOrder.refundAmount >= updatedOrder.totalAmount) {
      if (updatedOrder.status !== 'cancelled') {
        updatedOrder.status = 'refunded';
      }
      if (updatedOrder.inventoryStatus === 'deducted') {
        await restoreOrderInventory(order._id, 'admin_refund');
      }

      // Check vendor transfer handling:
      if (updatedOrder.transferStatus === 'processed') {
        updatedOrder.transferStatus = 'manual_review';
        updatedOrder.transferError = `Order refunded after vendor transfer ${updatedOrder.transferId || ''} was processed. Manual financial reconciliation or clawback required.`;
        updatedOrder.notes = updatedOrder.notes || {};
        updatedOrder.notes.payoutReconciliationRequired = true;
      } else if (!updatedOrder.notes?.vendorEarningsReversed) {
        if (updatedOrder.vendorEarningsCredited) {
          await Vendor.findByIdAndUpdate(updatedOrder.vendorId, {
            $inc: { totalEarnings: -updatedOrder.vendorEarning }
          });
          updatedOrder.vendorEarningsCredited = false;
        }
        updatedOrder.notes = updatedOrder.notes || {};
        updatedOrder.notes.vendorEarningsReversed = true;
      }
      await updatedOrder.save();
    } else if (updatedOrder.transferStatus === 'processed') {
      // Partial refund on processed transfer also flags manual review
      updatedOrder.transferStatus = 'manual_review';
      updatedOrder.transferError = `Partial refund of ₹${requestedAmount || refundRes.order?.refundAmount} issued after vendor transfer ${updatedOrder.transferId || ''} was processed. Manual financial reconciliation required.`;
      updatedOrder.notes = updatedOrder.notes || {};
      updatedOrder.notes.payoutReconciliationRequired = true;
      await updatedOrder.save();
    }

    const finalOrder = await Order.findById(order._id);
    res.json({ message: 'Refund processed successfully', order: finalOrder, refund: refundRes.refund || refundRes });
  } catch (error) {
    res.status(500).json({ message: 'Refund failed', error: error.message });
  }
});

// Valid order status transitions by role
const VENDOR_ALLOWED_TRANSITIONS = {
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
  refunded: []
};

const ADMIN_ALLOWED_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'shipped', 'cancelled', 'refunded'],
  processing: ['shipped', 'cancelled', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  cancelled: ['refunded'],
  refunded: []
};

const VALID_ORDER_STATUS_TRANSITIONS = ADMIN_ALLOWED_TRANSITIONS;

function isValidOrderStatusTransition(fromStatus, toStatus, role = 'admin') {
  const from = (fromStatus || 'pending').toLowerCase();
  const to = (toStatus || '').toLowerCase();
  if (from === to) return true; // idempotent same-state update

  const matrix = (role === 'vendor') ? VENDOR_ALLOWED_TRANSITIONS : ADMIN_ALLOWED_TRANSITIONS;
  const allowed = matrix[from];
  return Boolean(allowed && allowed.includes(to));
}

// Get buyer's orders
router.get('/buyer/my-orders', authenticate, authorize('buyer'), async (req, res) => {
  try {
    const orders = await Order.find({ buyerId: req.user._id })
      .populate('vendorId', 'shopName')
      .populate('products.productId', 'title imageUrl')
      .sort({ createdAt: -1 })
      .lean();
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get vendor's orders
router.get('/vendor/my-orders', authenticate, authorize('vendor'), async (req, res) => {
  try {
    const vendors = await Vendor.find({ userId: req.user._id }).lean();
    if (!vendors || vendors.length === 0) {
      return res.status(404).json({ message: 'Vendor profile not found' });
    }

    const vendorIds = vendors.map(v => v._id);
    const { vendorId } = req.query;

    let targetVendorIds = vendorIds;
    if (vendorId) {
      if (!mongoose.Types.ObjectId.isValid(vendorId)) {
        return res.status(400).json({ message: 'Invalid vendor ID format' });
      }
      const match = vendorIds.find(id => id.toString() === vendorId.toString());
      if (!match) {
        return res.status(403).json({ message: 'Access denied: You do not own this shop' });
      }
      targetVendorIds = [match];
    }

    const orders = await Order.find({ vendorId: { $in: targetVendorIds } })
      .populate('buyerId', 'username email')
      .populate('vendorId', 'shopName')
      .populate('products.productId', 'title imageUrl price')
      .sort({ createdAt: -1 })
      .lean();

    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update order status (vendor or admin)
router.put('/:id/status', authenticate, authorize('vendor', 'admin'), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid order ID format' });
    }

    const { status, reason } = req.body;
    if (!status || typeof status !== 'string') {
      return res.status(400).json({ message: 'Valid status string is required' });
    }

    const normalizedStatus = status.toLowerCase().trim();
    const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'];

    if (!validStatuses.includes(normalizedStatus)) {
      return res.status(400).json({
        message: `Invalid status "${status}". Allowed values: ${validStatuses.join(', ')}`
      });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const currentStatus = (order.status || 'pending').toLowerCase();

    // Enforce ownership for vendors
    if (req.user.role === 'vendor') {
      const vendors = await Vendor.find({ userId: req.user._id });
      if (!vendors || vendors.length === 0) {
        return res.status(404).json({ message: 'Vendor profile not found' });
      }
      const vendorIds = vendors.map(v => v._id.toString());
      if (!vendorIds.includes(order.vendorId.toString())) {
        return res.status(403).json({ message: 'Not authorized to update this order' });
      }

      // Role permission check: Vendor cannot directly mark an order as 'refunded'
      if (normalizedStatus === 'refunded') {
        return res.status(403).json({ message: 'Vendors cannot set status to refunded directly. Use refund process.' });
      }
    }

    // Idempotent: If already in requested status, return early
    if (currentStatus === normalizedStatus) {
      return res.json(order);
    }

    // Terminal state protection: Cancelled or Refunded orders cannot be updated to non-refund states
    if (currentStatus === 'cancelled' && normalizedStatus !== 'refunded') {
      return res.status(400).json({ message: 'Cancelled orders cannot be modified or fulfilled' });
    }
    if (currentStatus === 'refunded') {
      return res.status(400).json({ message: 'Refunded orders are terminal and cannot be modified' });
    }

    // Check role-specific status transition rules
    const role = req.user.role;
    if (!isValidOrderStatusTransition(currentStatus, normalizedStatus, role)) {
      if (role === 'vendor') {
        if (currentStatus === 'confirmed' && ['shipped', 'delivered'].includes(normalizedStatus)) {
          return res.status(400).json({
            message: `Vendors must transition orders through required fulfillment states: confirmed -> processing -> shipped -> delivered. Cannot jump directly from ${order.status} to ${status}.`
          });
        }
        if (currentStatus === 'processing' && normalizedStatus === 'delivered') {
          return res.status(400).json({
            message: `Vendors must transition orders through required fulfillment states: confirmed -> processing -> shipped -> delivered. Cannot jump directly from processing to delivered without shipping.`
          });
        }
      }
      return res.status(400).json({
        message: `Cannot transition order from "${order.status}" to "${status}". Invalid or unauthorized transition for role "${role}".`
      });
    }

    // Specific cancellation business logic:
    if (normalizedStatus === 'cancelled') {
      if (currentStatus === 'shipped' || currentStatus === 'delivered') {
        return res.status(400).json({ message: `Orders that are already ${order.status} cannot be cancelled` });
      }

      // If order was paid, vendor/admin cancellation MUST initiate gateway refund
      if (order.paymentStatus === 'paid' && order.razorpayPaymentId) {
        const refundRes = await initiateOrderRefund(order._id, {
          amount: order.totalAmount,
          reason: reason || `${req.user.role} cancelled order`
        });
        if (!refundRes.success && !refundRes.alreadyRefunded) {
          return res.status(500).json({
            message: 'Failed to process refund for cancelled order',
            error: refundRes.reason
          });
        }
      }

      // Restore inventory exactly once
      if (order.inventoryStatus === 'deducted') {
        await restoreOrderInventory(order._id, `${req.user.role}_cancellation`);
      }

      // Vendor payout handling:
      if (order.transferStatus === 'processed') {
        order.transferStatus = 'manual_review';
        order.transferError = `Order cancelled after vendor transfer ${order.transferId || ''} was processed. Manual financial reconciliation or clawback required.`;
        order.notes = order.notes || {};
        order.notes.payoutReconciliationRequired = true;
      } else if (!order.notes?.vendorEarningsReversed) {
        if (order.vendorEarningsCredited) {
          await Vendor.findByIdAndUpdate(order.vendorId, {
            $inc: { totalEarnings: -order.vendorEarning }
          });
          order.vendorEarningsCredited = false;
        }
        order.notes = order.notes || {};
        order.notes.vendorEarningsReversed = true;
      }
    }

    // Record audit trail in statusHistory
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({
      fromStatus: order.status,
      toStatus: normalizedStatus,
      changedBy: req.user._id,
      role: req.user.role,
      reason: reason || '',
      timestamp: new Date()
    });

    const previousStatus = order.status;
    order.status = normalizedStatus;
    if (reason) {
      order.failureReason = reason;
    }
    await order.save();

    await recordAuditLog({
      actorId: req.user._id,
      actorRole: req.user.role,
      action: 'order.status_change',
      resourceType: 'Order',
      resourceId: order._id.toString(),
      before: { status: previousStatus },
      after: { status: normalizedStatus },
      metadata: { reason: reason || '', changedBy: req.user._id.toString() }
    });

    if (global.orderEventEmitter && notificationDeduplicator.shouldDispatch(`orderStatus:${order._id}:${normalizedStatus}`)) {
      global.orderEventEmitter.emit('orderStatusUpdated', {
        orderId: order._id.toString(),
        buyerId: order.buyerId.toString(),
        vendorId: order.vendorId.toString(),
        status: normalizedStatus
      });
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Cancel order (buyer)
router.post('/:id/cancel', authenticate, authorize('buyer'), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid order ID format' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.buyerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to cancel this order' });
    }

    const currentStatus = (order.status || 'pending').toLowerCase();

    if (currentStatus === 'cancelled') {
      return res.status(400).json({ message: 'Order is already cancelled' });
    }
    if (currentStatus === 'refunded') {
      return res.status(400).json({ message: 'Order is already refunded and cannot be cancelled' });
    }
    if (currentStatus === 'shipped' || currentStatus === 'delivered') {
      return res.status(400).json({ message: `Cannot cancel order that has already been ${order.status}` });
    }

    // Only allow cancellation from pending, confirmed, processing
    if (!['pending', 'confirmed', 'processing'].includes(currentStatus)) {
      return res.status(400).json({ message: `Order in state "${order.status}" is not eligible for cancellation` });
    }

    const cancelReason = req.body.reason || 'Buyer requested cancellation';

    // If paid, refund through existing payment provider
    if (order.paymentStatus === 'paid' && order.razorpayPaymentId) {
      const refundRes = await initiateOrderRefund(order._id, {
        amount: order.totalAmount,
        reason: cancelReason
      });
      if (!refundRes.success && !refundRes.alreadyRefunded) {
        return res.status(500).json({
          message: 'Failed to process refund for cancelled order',
          error: refundRes.reason
        });
      }
    }

    // Restore stock exactly once
    if (order.inventoryStatus === 'deducted') {
      await restoreOrderInventory(order._id, 'buyer_cancellation');
    }

    // Vendor payout handling:
    if (order.transferStatus === 'processed') {
      order.transferStatus = 'manual_review';
      order.transferError = `Order cancelled after vendor transfer ${order.transferId || ''} was processed. Manual financial reconciliation or clawback required.`;
      order.notes = order.notes || {};
      order.notes.payoutReconciliationRequired = true;
    } else if (!order.notes?.vendorEarningsReversed) {
      if (order.vendorEarningsCredited) {
        await Vendor.findByIdAndUpdate(order.vendorId, {
          $inc: { totalEarnings: -order.vendorEarning }
        });
        order.vendorEarningsCredited = false;
      }
      order.notes = order.notes || {};
      order.notes.vendorEarningsReversed = true;
    }

    const updatedOrder = await Order.findById(order._id);
    updatedOrder.status = 'cancelled';
    updatedOrder.failureReason = cancelReason;

    updatedOrder.statusHistory = updatedOrder.statusHistory || [];
    updatedOrder.statusHistory.push({
      fromStatus: currentStatus,
      toStatus: 'cancelled',
      changedBy: req.user._id,
      role: 'buyer',
      reason: cancelReason,
      timestamp: new Date()
    });

    await updatedOrder.save();

    await recordAuditLog({
      actorId: req.user._id,
      actorRole: req.user.role,
      action: 'order.cancel',
      resourceType: 'Order',
      resourceId: updatedOrder._id.toString(),
      before: { status: currentStatus },
      after: { status: 'cancelled' },
      metadata: { reason: cancelReason, changedBy: req.user._id.toString() }
    });

    if (global.orderEventEmitter && notificationDeduplicator.shouldDispatch(`orderStatus:${updatedOrder._id}:cancelled`)) {
      global.orderEventEmitter.emit('orderStatusUpdated', {
        orderId: updatedOrder._id.toString(),
        buyerId: updatedOrder.buyerId.toString(),
        vendorId: updatedOrder.vendorId.toString(),
        status: 'cancelled'
      });
    }

    res.json({ message: 'Order cancelled successfully', order: updatedOrder });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get single order
router.get('/:id', authenticate, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid order ID format' });
    }

    const order = await Order.findById(req.params.id)
      .populate('buyerId', 'username email')
      .populate('vendorId', 'shopName')
      .populate('products.productId', 'title imageUrl price');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const vendors = await Vendor.find({ userId: req.user._id }).select('_id');
    const vendorIdSet = new Set(vendors.map(v => v._id.toString()));

    const orderBuyerId = (order.buyerId?._id || order.buyerId || '').toString();
    const orderVendorId = (order.vendorId?._id || order.vendorId || '').toString();

    const isBuyer = orderBuyerId === req.user._id.toString();
    const isVendor = vendorIdSet.has(orderVendorId);
    const isAdmin = req.user.role === 'admin';

    if (!isBuyer && !isVendor && !isAdmin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.deductOrderInventory = deductOrderInventory;
router.restoreOrderInventory = restoreOrderInventory;
router.recoverInterruptedInventory = recoverInterruptedInventory;
router.initiateOrderRefund = initiateOrderRefund;
router.reconcileOrderRefund = reconcileOrderRefund;
router.isDefiniteGatewayRejection = isDefiniteGatewayRejection;
router.buildOrderPayload = buildOrderPayload;
router.computeCheckoutPayloadHash = computeCheckoutPayloadHash;
router.settleOrderPayment = settleOrderPayment;
router.createVendorTransfer = createVendorTransfer;
router.recordVendorEarningsAtomic = recordVendorEarningsAtomic;
router.VALID_ORDER_STATUS_TRANSITIONS = VALID_ORDER_STATUS_TRANSITIONS;
router.VENDOR_ALLOWED_TRANSITIONS = VENDOR_ALLOWED_TRANSITIONS;
router.ADMIN_ALLOWED_TRANSITIONS = ADMIN_ALLOWED_TRANSITIONS;
router.isValidOrderStatusTransition = isValidOrderStatusTransition;

module.exports = router;

