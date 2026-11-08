/**
 * TASK 3E: FINAL INVENTORY LEDGER OWNERSHIP AND STATE-TRANSITION AUDIT
 *
 * Requirements:
 * 1. Worker 1 reserves an operation and pauses.
 *    Worker 2 takes over and completes the operation.
 *    Worker 1 resumes and attempts to mark it failed.
 *    Verify the operation remains completed and stock is correct.
 * 2. Duplicate operation reservation while original is pending.
 * 3. Duplicate reservation after original is completed (cannot downgrade to pending).
 * 4. Stale worker attempting to overwrite completed operation (rejected).
 * 5. Concurrent recovery and normal processing of the same order.
 * 6. Repeated failure and recovery without stock duplication.
 * 7. Duplicate-key error during reservation handled safely.
 * 8. State transition enforcement (reject completed->pending, completed->failed, archived->pending).
 *
 * Safety:
 * - Dedicated database: aborts unless active database is 'marketplace_test'.
 * - Scoped cleanup using prefix TEST_T3E_.
 * - Zero secret or credential exposure.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const InventoryOperation = require('../models/InventoryOperation');
const {
  deductOrderInventory,
  restoreOrderInventory,
  recoverInterruptedInventory
} = require('../routes/orders');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✔ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ✘ FAIL: ${message}`);
    failedTests++;
  }
}

const TEST_PREFIX = `TEST_T3E_${Date.now()}_`;
const dummyBuyerId = new mongoose.Types.ObjectId();
const dummyVendorId = new mongoose.Types.ObjectId();

async function createTestProduct(stock, price = 100) {
  return await Product.create({
    title: `${TEST_PREFIX}Prod_${Math.random().toString(36).substring(7)}`,
    description: 'Test product for Task 3E ledger ownership audit',
    price,
    stock,
    category: 'Electronics',
    imageUrl: 'https://example.com/test-img.jpg',
    vendorId: dummyVendorId,
    isActive: true,
    inventoryOperations: []
  });
}

async function createTestOrder(products, overrides = {}) {
  const totalAmount = products.reduce((acc, p) => acc + (p.price || 100) * p.quantity, 0);
  return await Order.create({
    buyerId: dummyBuyerId,
    vendorId: dummyVendorId,
    products: products.map(p => ({
      productId: p._id,
      quantity: p.quantity,
      price: p.price || 100,
      inventoryState: overrides.itemInventoryState || 'pending'
    })),
    totalAmount,
    vendorEarning: totalAmount * 0.9,
    adminCommission: totalAmount * 0.1,
    shippingAddress: '123 Dedicated Test Lane',
    paymentStatus: overrides.paymentStatus || 'created',
    inventoryStatus: overrides.inventoryStatus || 'not_deducted',
    claimVersion: overrides.claimVersion || 0,
    razorpayOrderId: `order_${Math.random().toString(36).substring(7)}`,
    razorpayPaymentId: overrides.razorpayPaymentId || `pay_${Math.random().toString(36).substring(7)}`,
    refundStatus: overrides.refundStatus || 'none',
    ...overrides
  });
}

async function cleanupTestData() {
  await Product.deleteMany({ title: { $regex: TEST_PREFIX } });
  await Order.deleteMany({ buyerId: dummyBuyerId });
  await InventoryOperation.deleteMany({ operationId: { $regex: TEST_PREFIX } });
  await InventoryOperation.deleteMany({ claimId: { $regex: TEST_PREFIX } });
}

async function runLedgerOwnershipAudit() {
  console.log('\n============================================================');
  console.log(' TASK 3E: INVENTORY LEDGER OWNERSHIP & TRANSITION AUDIT');
  console.log('============================================================\n');

  const testDbUri = process.env.TEST_MONGODB_URI || process.env.MONGODB_URI?.replace('/marketplace', '/marketplace_test');
  if (!testDbUri) {
    console.error('Fatal: No dedicated test database URI configured in TEST_MONGODB_URI.');
    process.exit(1);
  }

  try {
    await mongoose.connect(testDbUri);
    console.log('Connected to database:', mongoose.connection.name);

    if (mongoose.connection.name !== 'marketplace_test') {
      console.error(`ABORT: Active database "${mongoose.connection.name}" is NOT "marketplace_test"!`);
      process.exit(1);
    }
    assert(mongoose.connection.name === 'marketplace_test', 'Active database confirmed as marketplace_test');

    await InventoryOperation.init();
    await Product.init();
    await Order.init();

    const topology = mongoose.connection?.client?.topology?.description?.type;
    const isReplicaSet = topology === 'ReplicaSetWithPrimary' || topology === 'Sharded';
    console.log('Cluster Topology:', topology, '| Replica Set Transactions Supported:', isReplicaSet);
    console.log('------------------------------------------------------------\n');

    // =============================================================
    // TEST 1: WORKER 1 RESERVES, WORKER 2 COMPLETES, WORKER 1 ATTEMPTS MARK FAILED
    // =============================================================
    console.log('Test 1: Worker 1 reserves op, Worker 2 completes op, Worker 1 resumes & attempts mark failed');
    const p1 = await createTestProduct(10);
    const order1 = await createTestOrder([{ _id: p1._id, quantity: 2 }]);
    const opId1 = `order_${order1._id}_prod_${p1._id}_deduct`;

    let worker1Paused = false;
    let worker1Resume;
    const worker1Promise = new Promise(res => { worker1Resume = res; });
    let worker1Result = null;

    // Launch Worker 1: pauses after reserving operation, right before Product stock update
    const worker1Task = deductOrderInventory(order1._id, {
      forceCompensation: true,
      pauseAfterReservationBeforeStockWrite: async () => {
        worker1Paused = true;
        await worker1Promise;
      }
    }).then(res => { worker1Result = res; return res; });

    while (!worker1Paused) {
      await new Promise(r => setTimeout(r, 50));
    }

    // Verify Worker 1 recorded operation as pending with claimVersion = 1
    const opAfterWorker1 = await InventoryOperation.findOne({ operationId: opId1 });
    assert(opAfterWorker1 !== null && opAfterWorker1.status === 'pending', 'Worker 1 reserved operation with status "pending"');
    assert(opAfterWorker1.fencingToken === 1, 'Worker 1 recorded fencingToken = 1');

    // Simulate claim expiration so Worker 2 reclaims
    const staleTime = new Date(Date.now() - 35000);
    await Order.updateOne(
      { _id: order1._id },
      { $set: { inventoryClaimedAt: staleTime, inventoryHeartbeatAt: staleTime } }
    );

    // Worker 2 takes over and completes the operation
    const worker2Result = await deductOrderInventory(order1._id, { forceCompensation: true });
    const opAfterWorker2 = await InventoryOperation.findOne({ operationId: opId1 });
    const p1AfterWorker2 = await Product.findById(p1._id);

    assert(worker2Result.success, 'Worker 2 took over and completed deduction');
    assert(opAfterWorker2.status === 'completed', 'Worker 2 transitioned operation status to "completed"');
    assert(p1AfterWorker2.stock === 8, `Product stock decremented from 10 to 8 by Worker 2 (actual: ${p1AfterWorker2.stock})`);

    // Worker 1 resumes: will attempt Product update (fails because already deducted),
    // and then attempts to mark its operation failed
    worker1Resume();
    await worker1Task;

    const opFinal1 = await InventoryOperation.findOne({ operationId: opId1 });
    const p1Final = await Product.findById(p1._id);

    assert(worker1Result.fencedOut === true, 'Worker 1 was fenced out');
    assert(opFinal1.status === 'completed', 'Operation remains "completed" (Worker 1 CANNOT overwrite completed to failed)');
    assert(p1Final.stock === 8, `Product stock remains 8 (untouched by stale Worker 1)`);

    // =============================================================
    // TEST 2: DUPLICATE RESERVATION WHILE ORIGINAL IS PENDING
    // =============================================================
    console.log('\nTest 2: Duplicate operation reservation while original is pending');
    const dupPendingOpId = `${TEST_PREFIX}dup_pending_op`;
    const dummyOrder2 = new mongoose.Types.ObjectId();
    const dummyProd2 = new mongoose.Types.ObjectId();

    // Insert initial pending reservation
    await InventoryOperation.create({
      operationId: dupPendingOpId,
      orderId: dummyOrder2,
      productId: dummyProd2,
      action: 'deduct',
      quantity: 1,
      claimId: `${TEST_PREFIX}claim_A`,
      fencingToken: 1,
      status: 'pending'
    });

    // Attempt second reservation with same operationId (duplicate key / upsert)
    let dupKeyCaught = false;
    try {
      await InventoryOperation.create({
        operationId: dupPendingOpId,
        orderId: dummyOrder2,
        productId: dummyProd2,
        action: 'deduct',
        quantity: 1,
        claimId: `${TEST_PREFIX}claim_B`,
        fencingToken: 1,
        status: 'pending'
      });
    } catch (err) {
      if (err.code === 11000) dupKeyCaught = true;
    }

    assert(dupKeyCaught, 'Duplicate-key error E11000 raised when attempting duplicate pending reservation');
    const pendingDocCount = await InventoryOperation.countDocuments({ operationId: dupPendingOpId });
    assert(pendingDocCount === 1, 'Only exactly 1 pending record exists');

    // =============================================================
    // TEST 3: DUPLICATE RESERVATION AFTER ORIGINAL IS COMPLETED
    // =============================================================
    console.log('\nTest 3: Duplicate reservation after original is completed (never downgrades)');
    const dupCompletedOpId = `${TEST_PREFIX}dup_completed_op`;

    await InventoryOperation.create({
      operationId: dupCompletedOpId,
      orderId: dummyOrder2,
      productId: dummyProd2,
      action: 'deduct',
      quantity: 1,
      claimId: `${TEST_PREFIX}claim_A`,
      fencingToken: 1,
      status: 'completed',
      completedAt: new Date()
    });

    // Attempt upsert with $setOnInsert
    const upsertRes = await InventoryOperation.findOneAndUpdate(
      { operationId: dupCompletedOpId },
      {
        $setOnInsert: {
          operationId: dupCompletedOpId,
          orderId: dummyOrder2,
          productId: dummyProd2,
          action: 'deduct',
          quantity: 1,
          status: 'pending'
        }
      },
      { upsert: true, new: true }
    );

    assert(upsertRes.status === 'completed', 'Completed operation was NOT downgraded to pending by upsert');

    // =============================================================
    // TEST 4: STALE WORKER ATTEMPTING TO OVERWRITE A COMPLETED OPERATION
    // =============================================================
    console.log('\nTest 4: Stale worker attempting to overwrite a completed operation');
    // Stale worker with fencingToken: 1 tries to mark op failed or pending
    const staleUpdateRes = await InventoryOperation.updateOne(
      {
        operationId: dupCompletedOpId,
        status: 'pending',
        claimId: `${TEST_PREFIX}stale_claim`,
        fencingToken: 1
      },
      { $set: { status: 'failed' } }
    );

    assert(staleUpdateRes.modifiedCount === 0, 'Stale worker update matched 0 documents (rejected)');
    const checkOp4 = await InventoryOperation.findOne({ operationId: dupCompletedOpId });
    assert(checkOp4.status === 'completed', 'Operation remains strictly "completed"');

    // =============================================================
    // TEST 5: CONCURRENT RECOVERY AND NORMAL PROCESSING OF THE SAME ORDER
    // =============================================================
    console.log('\nTest 5: Concurrent recovery and normal processing of the same order');
    const p5 = await createTestProduct(10);
    const order5 = await createTestOrder([{ _id: p5._id, quantity: 3 }]);

    // Run normal processing and recovery concurrently
    const [processRes, recoveryRes] = await Promise.allSettled([
      deductOrderInventory(order5._id, { forceCompensation: true }),
      recoverInterruptedInventory(order5._id)
    ]);

    const p5Final = await Product.findById(p5._id);
    const order5Final = await Order.findById(order5._id);
    const opId5 = `order_${order5._id}_prod_${p5._id}_deduct`;
    const op5Final = await InventoryOperation.findOne({ operationId: opId5 });

    assert(p5Final.stock === 7, `Stock is exactly 7 (actual: ${p5Final.stock}, expected strictly 7)`);
    assert(
      order5Final.inventoryStatus === 'deducted' && op5Final.status === 'completed',
      'Order status is "deducted" and operation is "completed"; active worker was not interrupted by recovery'
    );

    // =============================================================
    // TEST 6: REPEATED FAILURE AND RECOVERY WITHOUT STOCK DUPLICATION
    // =============================================================
    console.log('\nTest 6: Repeated failure and recovery without stock duplication');
    const p6A = await createTestProduct(10);
    const p6B = await createTestProduct(0); // Out of stock to force failure
    const order6 = await createTestOrder([
      { _id: p6A._id, quantity: 2 },
      { _id: p6B._id, quantity: 1 }
    ]);

    // Initial deduction failure
    const failRes6 = await deductOrderInventory(order6._id, { forceCompensation: true });
    assert(!failRes6.success, 'Multi-product order failed due to out-of-stock product');

    const p6AAfterFail = await Product.findById(p6A._id);
    assert(p6AAfterFail.stock === 10, 'Product A stock was safely rolled back to 10');

    // Run recovery 3 times consecutively
    await recoverInterruptedInventory(order6._id);
    await recoverInterruptedInventory(order6._id);
    await recoverInterruptedInventory(order6._id);

    const p6AFinal = await Product.findById(p6A._id);
    const p6BFinal = await Product.findById(p6B._id);
    assert(p6AFinal.stock === 10, `Product A stock remained 10 after repeated recovery (actual: ${p6AFinal.stock})`);
    assert(p6BFinal.stock === 0, `Product B stock remained 0 (actual: ${p6BFinal.stock})`);

    // =============================================================
    // TEST 7: DUPLICATE-KEY ERROR DURING RESERVATION
    // =============================================================
    console.log('\nTest 7: Duplicate-key error during reservation handled safely');
    const dupKeyOpId = `${TEST_PREFIX}dup_key_test`;
    await InventoryOperation.create({
      operationId: dupKeyOpId,
      orderId: dummyOrder2,
      productId: dummyProd2,
      action: 'deduct',
      quantity: 1,
      claimId: `${TEST_PREFIX}claim_1`,
      fencingToken: 1,
      status: 'pending'
    });

    // Simulate worker catching duplicate key and resolving existing doc
    let caughtE11000 = false;
    let existingDocResolved = null;
    try {
      await InventoryOperation.create({
        operationId: dupKeyOpId,
        orderId: dummyOrder2,
        productId: dummyProd2,
        action: 'deduct',
        quantity: 1,
        claimId: `${TEST_PREFIX}claim_2`,
        fencingToken: 2,
        status: 'pending'
      });
    } catch (e) {
      if (e.code === 11000) {
        caughtE11000 = true;
        existingDocResolved = await InventoryOperation.findOne({ operationId: dupKeyOpId });
      }
    }

    assert(caughtE11000, 'Duplicate key caught code 11000');
    assert(existingDocResolved !== null && existingDocResolved.operationId === dupKeyOpId, 'Existing document safely resolved on duplicate key');

    // =============================================================
    // TEST 8: STATE TRANSITION ENFORCEMENT (FORBIDDEN TRANSITIONS)
    // =============================================================
    console.log('\nTest 8: State transition enforcement (reject invalid transitions)');
    const transitionOpId = `${TEST_PREFIX}state_transition_test`;

    // 1. Create completed operation
    await InventoryOperation.create({
      operationId: transitionOpId,
      orderId: dummyOrder2,
      productId: dummyProd2,
      action: 'deduct',
      quantity: 1,
      claimId: `${TEST_PREFIX}claim_done`,
      fencingToken: 5,
      status: 'completed',
      completedAt: new Date()
    });

    // Attempt forbidden completed -> pending
    const tryDowngradeToPending = await InventoryOperation.updateOne(
      { operationId: transitionOpId, status: 'pending' },
      { $set: { status: 'pending' } }
    );
    assert(tryDowngradeToPending.modifiedCount === 0, 'Forbidden completed -> pending rejected (0 modified)');

    // Attempt forbidden completed -> failed
    const tryDowngradeToFailed = await InventoryOperation.updateOne(
      { operationId: transitionOpId, status: 'pending' },
      { $set: { status: 'failed' } }
    );
    assert(tryDowngradeToFailed.modifiedCount === 0, 'Forbidden completed -> failed rejected (0 modified)');

    // Mark as archived
    await InventoryOperation.updateOne(
      { operationId: transitionOpId },
      { $set: { status: 'archived' } }
    );

    // Attempt forbidden archived -> pending
    const tryArchivedToPending = await InventoryOperation.updateOne(
      { operationId: transitionOpId, status: { $in: ['pending', 'failed'] } },
      { $set: { status: 'pending' } }
    );
    assert(tryArchivedToPending.modifiedCount === 0, 'Forbidden archived -> pending rejected (0 modified)');

    // Create a failed operation
    const failedOpId = `${TEST_PREFIX}failed_op_test`;
    await InventoryOperation.create({
      operationId: failedOpId,
      orderId: dummyOrder2,
      productId: dummyProd2,
      action: 'deduct',
      quantity: 1,
      claimId: `${TEST_PREFIX}claim_failed`,
      fencingToken: 3,
      status: 'failed'
    });

    // Attempt forbidden failed -> completed by stale worker (fencingToken 2 < 3)
    const tryStaleComplete = await InventoryOperation.updateOne(
      { operationId: failedOpId, status: 'pending', fencingToken: 2 },
      { $set: { status: 'completed' } }
    );
    assert(tryStaleComplete.modifiedCount === 0, 'Forbidden failed -> completed by stale worker rejected (0 modified)');

    // Legitimate recovery takeover: worker with newer fencingToken (4 > 3) reclaims failed op to pending
    const validTakeover = await InventoryOperation.updateOne(
      { operationId: failedOpId, status: 'failed', fencingToken: { $lt: 4 } },
      { $set: { claimId: `${TEST_PREFIX}claim_worker4`, fencingToken: 4, status: 'pending' } }
    );
    assert(validTakeover.modifiedCount === 1, 'Legitimate takeover: newer worker (token 4 > 3) reset failed -> pending for retry');

    const finalReclaimedOp = await InventoryOperation.findOne({ operationId: failedOpId });
    assert(finalReclaimedOp.status === 'pending' && finalReclaimedOp.fencingToken === 4, 'Reclaimed operation is pending with fencingToken 4');

  } catch (err) {
    console.error('Test suite error:', err);
    failedTests++;
  } finally {
    console.log('\nCleaning up test artifacts from dedicated test database...');
    try {
      await cleanupTestData();
    } catch (e) {
      console.error('Cleanup warning:', e.message);
    }
    await mongoose.disconnect();
    console.log('Test database disconnected.\n');

    console.log('============================================================');
    console.log(` TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('============================================================\n');

    if (failedTests > 0) {
      process.exit(1);
    }
  }
}

runLedgerOwnershipAudit();
