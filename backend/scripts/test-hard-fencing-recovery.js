/**
 * TASK 3D: VERIFY THE HARDEST STALE-WORKER FENCING RACE,
 * INVENTORY OPERATION LIFECYCLE & CRASH BOUNDARIES, AND TRANSACTION ATOMICITY
 *
 * Requirements:
 * 1. Deterministic test of the hardest stale-worker race:
 *    - Worker 1 obtains claimVersion 1.
 *    - Worker 1 passes ownership and cancellation checks.
 *    - Worker 1 pauses immediately AFTER those checks but BEFORE Product stock write.
 *    - Worker 2 reclaims the order (claimVersion 2) and performs valid inventory deduction.
 *    - Worker 1 resumes.
 *    - Verify Worker 1 cannot modify stock or create conflicting completed operation.
 * 2. InventoryOperation lifecycle (pending -> completed / failed / archived).
 *    Crash boundary tests:
 *    - Boundary 1: Crash before InventoryOperation is inserted.
 *    - Boundary 2: Crash after InventoryOperation is inserted (pending), before stock changes.
 *    - Boundary 3: Crash after stock changes, before InventoryOperation marked completed.
 *    - Boundary 4: Crash after completion, before Order item state saved.
 *    Prove recovery does not deduct or restore twice, does not treat pending as proof of change,
 *    and uses Product document as atomic source of truth.
 * 3. Replica set transaction atomicity: failure leaves zero partial writes, no silent fallback.
 * 4. Dedicated database check: aborts unless active database is 'marketplace_test'.
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

const TEST_PREFIX = `TEST_T3D_${Date.now()}_`;
const dummyBuyerId = new mongoose.Types.ObjectId();
const dummyVendorId = new mongoose.Types.ObjectId();

async function createTestProduct(stock, price = 100) {
  return await Product.create({
    title: `${TEST_PREFIX}Prod_${Math.random().toString(36).substring(7)}`,
    description: 'Test product for Task 3D lifecycle & fencing verification',
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

async function runHardFencingAndLifecycleTests() {
  console.log('\n============================================================');
  console.log(' TASK 3D: HARDEST FENCING RACE & LEDGER LIFECYCLE TESTS');
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
    // SECTION 1: THE HARDEST STALE-WORKER FENCING RACE
    // =============================================================
    console.log('--- SECTION 1: THE HARDEST STALE-WORKER FENCING RACE ---');
    console.log('Sequence: Worker 1 passes checks -> pauses AFTER checks -> Worker 2 reclaims and deducts -> Worker 1 resumes');

    const p1 = await createTestProduct(10);
    const order1 = await createTestOrder([{ _id: p1._id, quantity: 2 }]);
    const deductOpId1 = `order_${order1._id}_prod_${p1._id}_deduct`;

    let worker1PausedAfterChecks = false;
    let worker1ResumePromiseResolve;
    const worker1ResumePromise = new Promise(res => { worker1ResumePromiseResolve = res; });
    let worker1Result = null;

    // Launch Worker 1 using pauseAfterChecksBeforeStockWrite hook:
    // This hook fires AFTER assertWorkerActive, orderCancelled, and activeCheck have all passed!
    const worker1Promise = deductOrderInventory(order1._id, {
      forceCompensation: true,
      pauseAfterChecksBeforeStockWrite: async ({ orderId, claimId, fencingToken }) => {
        worker1PausedAfterChecks = true;
        // Pause until Worker 2 has reclaimed and completed
        await worker1ResumePromise;
      }
    }).then(res => { worker1Result = res; return res; });

    // Wait until Worker 1 has passed checks and is paused
    while (!worker1PausedAfterChecks) {
      await new Promise(r => setTimeout(r, 50));
    }

    const orderAfterWorker1Claim = await Order.findById(order1._id);
    assert(worker1PausedAfterChecks, 'Worker 1 passed all ownership & cancellation checks and is paused right before Product write');
    assert(orderAfterWorker1Claim.claimVersion === 1, 'Worker 1 holds claimVersion = 1');

    // Simulate claim expiration so replacement Worker 2 is authorized to reclaim
    const staleTime = new Date(Date.now() - 35000);
    await Order.updateOne(
      { _id: order1._id },
      { $set: { inventoryClaimedAt: staleTime, inventoryHeartbeatAt: staleTime } }
    );

    // Worker 2 executes deduction
    const worker2Result = await deductOrderInventory(order1._id, { forceCompensation: true });
    const orderAfterWorker2 = await Order.findById(order1._id);
    const productAfterWorker2 = await Product.findById(p1._id);
    const durableOpWorker2 = await InventoryOperation.findOne({ operationId: deductOpId1 });

    assert(worker2Result.success, 'Worker 2 successfully reclaimed the order');
    assert(orderAfterWorker2.claimVersion === 2, `Worker 2 incremented claimVersion to 2 (actual: ${orderAfterWorker2.claimVersion})`);
    assert(productAfterWorker2.stock === 8, `Worker 2 decremented product stock from 10 to 8 (actual: ${productAfterWorker2.stock})`);
    assert(durableOpWorker2.status === 'completed', 'Worker 2 marked InventoryOperation as completed');

    // Resume Worker 1 right at the threshold of the Product stock write
    worker1ResumePromiseResolve();
    await worker1Promise;

    const finalProductP1 = await Product.findById(p1._id);
    const finalDurableOpsCount = await InventoryOperation.countDocuments({ operationId: deductOpId1 });

    assert(worker1Result.fencedOut === true, 'Worker 1 was fenced out at the Product stock write');
    assert(finalProductP1.stock === 8, `Product stock remained 8 and was NOT decremented again by Worker 1 (actual: ${finalProductP1.stock})`);
    assert(finalDurableOpsCount === 1, `Exactly 1 completed operation record exists in collection (actual: ${finalDurableOpsCount})`);

    // =============================================================
    // SECTION 2: INVENTORY OPERATION LIFECYCLE & CRASH BOUNDARIES
    // =============================================================
    console.log('\n--- SECTION 2: INVENTORY OPERATION LIFECYCLE & CRASH RECOVERY ---');

    // -------------------------------------------------------------
    // Boundary 1: Crash BEFORE InventoryOperation is inserted
    // -------------------------------------------------------------
    console.log('\nBoundary 1: Crash BEFORE InventoryOperation is inserted');
    const pB1 = await createTestProduct(10);
    const orderB1 = await createTestOrder([{ _id: pB1._id, quantity: 3 }]);
    const opIdB1 = `order_${orderB1._id}_prod_${pB1._id}_deduct`;

    let crashB1Occurred = false;
    try {
      await deductOrderInventory(orderB1._id, {
        forceCompensation: true,
        simulateCrashBoundary: 1
      });
    } catch (e) {
      crashB1Occurred = true;
    }

    assert(crashB1Occurred, 'Crash occurred before InventoryOperation was inserted');
    const opB1Before = await InventoryOperation.findOne({ operationId: opIdB1 });
    const pB1Before = await Product.findById(pB1._id);
    assert(opB1Before === null, 'No InventoryOperation record exists');
    assert(pB1Before.stock === 10, 'Product stock remains 10 (untouched)');

    // Run recovery
    const recB1 = await recoverInterruptedInventory(orderB1._id);
    const pB1After = await Product.findById(pB1._id);
    assert(recB1.recovered, 'Recovery executed successfully');
    assert(recB1.rolledBackCount === 0, 'Recovery rolled back 0 items (since stock was never deducted)');
    assert(pB1After.stock === 10, `Product stock remains 10 (not erroneously inflated)`);

    // -------------------------------------------------------------
    // Boundary 2: Crash AFTER InventoryOperation pending, BEFORE Product stock changes
    // -------------------------------------------------------------
    console.log('\nBoundary 2: Crash AFTER InventoryOperation pending, BEFORE Product stock changes');
    const pB2 = await createTestProduct(10);
    const orderB2 = await createTestOrder([{ _id: pB2._id, quantity: 4 }]);
    const opIdB2 = `order_${orderB2._id}_prod_${pB2._id}_deduct`;

    let crashB2Occurred = false;
    try {
      await deductOrderInventory(orderB2._id, {
        forceCompensation: true,
        simulateCrashBoundary: 2
      });
    } catch (e) {
      crashB2Occurred = true;
    }

    assert(crashB2Occurred, 'Crash occurred after operation inserted as pending, before stock decrement');
    const opB2Pending = await InventoryOperation.findOne({ operationId: opIdB2 });
    const pB2Before = await Product.findById(pB2._id);
    assert(opB2Pending !== null && opB2Pending.status === 'pending', 'InventoryOperation was recorded with status "pending"');
    assert(pB2Before.stock === 10, 'Product stock remains 10 (stock was NOT changed)');

    // Run recovery: proves recovery does NOT treat a pending record as proof that stock changed!
    const recB2 = await recoverInterruptedInventory(orderB2._id);
    const pB2After = await Product.findById(pB2._id);
    const opB2After = await InventoryOperation.findOne({ operationId: opIdB2 });

    assert(recB2.recovered, 'Recovery executed');
    assert(recB2.rolledBackCount === 0, 'Recovery did NOT roll back stock (pending record was not treated as proof of deduction)');
    assert(pB2After.stock === 10, `Product stock remained 10 and was NOT inflated to 14 (actual: ${pB2After.stock})`);
    assert(opB2After.status === 'failed', 'Uncompleted pending operation was reconciled to "failed"');

    // -------------------------------------------------------------
    // Boundary 3: Crash AFTER stock changes, BEFORE InventoryOperation marked completed
    // -------------------------------------------------------------
    console.log('\nBoundary 3: Crash AFTER stock changes, BEFORE InventoryOperation marked completed');
    const pB3 = await createTestProduct(10);
    const orderB3 = await createTestOrder([{ _id: pB3._id, quantity: 3 }]);
    const opIdB3 = `order_${orderB3._id}_prod_${pB3._id}_deduct`;

    let crashB3Occurred = false;
    try {
      await deductOrderInventory(orderB3._id, {
        forceCompensation: true,
        simulateCrashBoundary: 3
      });
    } catch (e) {
      crashB3Occurred = true;
    }

    assert(crashB3Occurred, 'Crash occurred after Product stock decrement, before InventoryOperation marked completed');
    const opB3Before = await InventoryOperation.findOne({ operationId: opIdB3 });
    const pB3Before = await Product.findById(pB3._id);
    const pB3EmbeddedOp = pB3Before.inventoryOperations.some(op => op.operationId === opIdB3);

    assert(opB3Before.status === 'pending', 'Durable InventoryOperation is still "pending"');
    assert(pB3Before.stock === 7, `Product stock was decremented to 7 (actual: ${pB3Before.stock})`);
    assert(pB3EmbeddedOp, 'Product document holds atomic ground-truth operation marker');

    // Run recovery: establishes Product document as source of truth and reconciles
    const recB3 = await recoverInterruptedInventory(orderB3._id);
    const pB3After = await Product.findById(pB3._id);
    const opB3After = await InventoryOperation.findOne({ operationId: opIdB3 });

    assert(recB3.recovered, 'Recovery executed');
    assert(recB3.rolledBackCount === 1, 'Recovery identified the deducted item using Product ground truth');
    assert(pB3After.stock === 10, `Product stock was safely returned to 10 (actual: ${pB3After.stock})`);
    assert(opB3After.status === 'completed', 'InventoryOperation was reconciled to "completed"');

    // -------------------------------------------------------------
    // Boundary 4: Crash AFTER completion, BEFORE Order item state is saved
    // -------------------------------------------------------------
    console.log('\nBoundary 4: Crash AFTER completion, BEFORE Order item state is saved');
    const pB4 = await createTestProduct(10);
    const orderB4 = await createTestOrder([{ _id: pB4._id, quantity: 2 }]);
    const opIdB4 = `order_${orderB4._id}_prod_${pB4._id}_deduct`;

    let crashB4Occurred = false;
    try {
      await deductOrderInventory(orderB4._id, {
        forceCompensation: true,
        simulateCrashBoundary: 4
      });
    } catch (e) {
      crashB4Occurred = true;
    }

    assert(crashB4Occurred, 'Crash occurred after InventoryOperation completed, before Order item saved');
    const opB4Before = await InventoryOperation.findOne({ operationId: opIdB4 });
    const orderB4Before = await Order.findById(orderB4._id);
    const pB4Before = await Product.findById(pB4._id);

    assert(opB4Before.status === 'completed', 'InventoryOperation is "completed"');
    assert(orderB4Before.products[0].inventoryState === 'pending', 'Order item state was NOT yet updated to "deducted"');
    assert(pB4Before.stock === 8, 'Product stock was decremented to 8');

    // Run recovery
    const recB4 = await recoverInterruptedInventory(orderB4._id);
    const pB4After = await Product.findById(pB4._id);
    const orderB4After = await Order.findById(orderB4._id);

    assert(recB4.recovered, 'Recovery executed');
    assert(pB4After.stock === 10, `Product stock safely restored to 10 (actual: ${pB4After.stock})`);
    assert(orderB4After.products[0].inventoryState === 'rolled_back', 'Order item state updated to "rolled_back"');

    // Repeated recovery: proves no double-restoration
    await recoverInterruptedInventory(orderB4._id);
    const pB4Repeat = await Product.findById(pB4._id);
    assert(pB4Repeat.stock === 10, 'Repeated recovery does NOT double-restore stock (remains 10)');

    // =============================================================
    // SECTION 3: REPLICA SET TRANSACTION BEHAVIOR
    // =============================================================
    console.log('\n--- SECTION 3: REPLICA SET TRANSACTION ATOMICITY & NO SILENT FALLBACK ---');

    if (isReplicaSet) {
      const pTxA = await createTestProduct(10);
      const pTxB = await createTestProduct(0); // Out of stock forces transaction abort
      const orderTx = await createTestOrder([
        { _id: pTxA._id, quantity: 2 },
        { _id: pTxB._id, quantity: 1 }
      ]);

      const txResult = await deductOrderInventory(orderTx._id);
      assert(!txResult.success, 'Multi-product order rejected by transaction due to item 2 out of stock');

      const pTxAAfter = await Product.findById(pTxA._id);
      const pTxBAfter = await Product.findById(pTxB._id);
      const orphanedOps = await InventoryOperation.countDocuments({ orderId: orderTx._id });
      const orderTxAfter = await Order.findById(orderTx._id);

      assert(pTxAAfter.stock === 10, `Product A stock remained 10 (rolled back in session transaction)`);
      assert(pTxBAfter.stock === 0, `Product B stock remained 0`);
      assert(orphanedOps === 0, `Zero orphaned records in InventoryOperation collection (actual: ${orphanedOps})`);
      assert(orderTxAfter.inventoryStatus === 'deduction_failed', 'Order marked "deduction_failed"');
      assert(!txResult.rolledBackCount, 'No silent fallback to standalone compensation occurred');
    } else {
      console.log('  ⚠ SKIP: Standalone MongoDB deployment (skipping replica set transaction test)');
    }

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

runHardFencingAndLifecycleTests();

