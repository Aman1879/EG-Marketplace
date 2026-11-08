/**
 * TASK 3C: DURABLE IDEMPOTENCY, STALE-WORKER FENCING AT STOCK WRITE,
 * AND TRANSACTION ROLLBACK INTEGRATION TESTS
 *
 * Strict Rules:
 * - Dedicated database verification: aborts unless mongoose.connection.name === 'marketplace_test'.
 * - Scoped cleanup using prefix TEST_T3C_ only (never deletes broad data).
 * - Tests actual application functions: deductOrderInventory, restoreOrderInventory, recoverInterruptedInventory.
 * - Does not expose environment credentials or secrets.
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

const TEST_PREFIX = `TEST_T3C_${Date.now()}_`;
const dummyBuyerId = new mongoose.Types.ObjectId();
const dummyVendorId = new mongoose.Types.ObjectId();

async function createTestProduct(stock, price = 100) {
  return await Product.create({
    title: `${TEST_PREFIX}Prod_${Math.random().toString(36).substring(7)}`,
    description: 'Test product for Task 3C durable idempotency verification',
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

async function runDurableFencingTests() {
  console.log('\n============================================================');
  console.log(' TASK 3C: DURABLE IDEMPOTENCY & STALE-WORKER INTEGRATION TESTS');
  console.log('============================================================\n');

  const testDbUri = process.env.TEST_MONGODB_URI || process.env.MONGODB_URI?.replace('/marketplace', '/marketplace_test');
  if (!testDbUri) {
    console.error('Fatal: No dedicated test database URI configured in TEST_MONGODB_URI.');
    process.exit(1);
  }

  try {
    await mongoose.connect(testDbUri);
    console.log('Connected to database:', mongoose.connection.name);

    // Strict Rule: Enforce dedicated test database
    if (mongoose.connection.name !== 'marketplace_test') {
      console.error(`ABORT: Active database "${mongoose.connection.name}" is NOT "marketplace_test"!`);
      process.exit(1);
    }
    assert(mongoose.connection.name === 'marketplace_test', 'Active database is confirmed marketplace_test');

    // Ensure model indexes and collections exist before transactions run
    await InventoryOperation.init();
    await Product.init();
    await Order.init();

    const topology = mongoose.connection?.client?.topology?.description?.type;
    const isReplicaSet = topology === 'ReplicaSetWithPrimary' || topology === 'Sharded';
    console.log('Cluster Topology:', topology, '| Replica Set Transactions Supported:', isReplicaSet);
    console.log('------------------------------------------------------------\n');

    // -------------------------------------------------------------
    // Test 1: Duplicate deduction after more than 200 later operations
    // -------------------------------------------------------------
    console.log('Test 1: Duplicate deduction after more than 200 later operations (proves durable collection idempotency)');
    const p1 = await createTestProduct(10);
    const order1 = await createTestOrder([{ _id: p1._id, quantity: 2 }]);
    const deductOpId1 = `order_${order1._id}_prod_${p1._id}_deduct`;

    // Perform initial deduction
    const deductRes1 = await deductOrderInventory(order1._id, { forceCompensation: true });
    assert(deductRes1.success, 'Initial deduction succeeded');
    const midP1 = await Product.findById(p1._id);
    assert(midP1.stock === 8, `Stock decremented from 10 to 8 (actual: ${midP1.stock})`);

    // Verify durable InventoryOperation record exists
    const durableOp1 = await InventoryOperation.findOne({ operationId: deductOpId1 });
    assert(durableOp1 !== null, 'Durable InventoryOperation recorded in separate collection');

    // Push 250 dummy operations to exceed the $slice: -200 embedded array limit
    const dummyOps = [];
    for (let k = 0; k < 250; k++) {
      dummyOps.push({
        operationId: `${TEST_PREFIX}dummy_op_${k}`,
        orderId: new mongoose.Types.ObjectId(),
        action: 'deduct',
        quantity: 1,
        createdAt: new Date()
      });
    }
    await Product.updateOne(
      { _id: p1._id },
      { $push: { inventoryOperations: { $each: dummyOps, $slice: -200 } } }
    );

    // Verify embedded array dropped the original operation marker
    const slicedP1 = await Product.findById(p1._id);
    const hasEmbeddedMarker1 = slicedP1.inventoryOperations.some(op => op.operationId === deductOpId1);
    assert(slicedP1.inventoryOperations.length === 200, 'Embedded array is capped at 200 items');
    assert(!hasEmbeddedMarker1, 'Embedded array no longer contains original operation marker (evicted by slice)');

    // Attempt delayed duplicate deduction retry for Order 1
    const retryDeductRes1 = await deductOrderInventory(order1._id, { forceCompensation: true });
    const finalP1 = await Product.findById(p1._id);
    assert(retryDeductRes1.success && retryDeductRes1.alreadyDeducted, 'Retry recognized deduction via durable InventoryOperation collection');
    assert(finalP1.stock === 8, `Product stock remained 8 and was NOT deducted twice (actual: ${finalP1.stock})`);

    // -------------------------------------------------------------
    // Test 2: Duplicate rollback after more than 200 later operations
    // -------------------------------------------------------------
    console.log('\nTest 2: Duplicate rollback after more than 200 later operations');
    const p2A = await createTestProduct(10);
    const p2B = await createTestProduct(0); // Out of stock to trigger compensation rollback
    const order2 = await createTestOrder([
      { _id: p2A._id, quantity: 2 },
      { _id: p2B._id, quantity: 1 }
    ]);
    const rollbackOpId2 = `order_${order2._id}_prod_${p2A._id}_rollback`;

    // Deduction triggers failure on p2B and executes rollback on p2A
    const deductRes2 = await deductOrderInventory(order2._id, { forceCompensation: true });
    assert(!deductRes2.success, 'Multi-product order failed due to out-of-stock product');
    const midP2A = await Product.findById(p2A._id);
    assert(midP2A.stock === 10, `Stock was safely rolled back to 10 (actual: ${midP2A.stock})`);

    // Verify durable rollback record exists in collection
    const durableRollback2 = await InventoryOperation.findOne({ operationId: rollbackOpId2 });
    assert(durableRollback2 !== null, 'Durable rollback record exists in collection');

    // Push 250 dummy operations to Product A to evict rollback marker from embedded array
    await Product.updateOne(
      { _id: p2A._id },
      { $push: { inventoryOperations: { $each: dummyOps, $slice: -200 } } }
    );
    const slicedP2A = await Product.findById(p2A._id);
    const hasEmbeddedRollback2 = slicedP2A.inventoryOperations.some(op => op.operationId === rollbackOpId2);
    assert(!hasEmbeddedRollback2, 'Embedded array evicted rollback marker');

    // Run recovery on Order 2
    const recoverRes2 = await recoverInterruptedInventory(order2._id);
    const finalP2A = await Product.findById(p2A._id);
    assert(recoverRes2.recovered, 'Recovery executed');
    assert(finalP2A.stock === 10, `Stock was NOT rolled back a second time (actual: ${finalP2A.stock}, expected 10)`);

    // -------------------------------------------------------------
    // Test 3: Duplicate restoration after more than 200 later operations
    // -------------------------------------------------------------
    console.log('\nTest 3: Duplicate restoration after more than 200 later operations');
    const p3 = await createTestProduct(10);
    const order3 = await createTestOrder([{ _id: p3._id, quantity: 3 }]);
    const restoreOpId3 = `order_${order3._id}_prod_${p3._id}_restore`;

    // Deduct stock first
    await deductOrderInventory(order3._id, { forceCompensation: true });
    const deductedP3 = await Product.findById(p3._id);
    assert(deductedP3.stock === 7, 'Stock deducted to 7');

    // Restore stock (cancellation)
    const restoreRes3 = await restoreOrderInventory(order3._id, 'cancellation');
    assert(restoreRes3.restored, 'Restoration succeeded');
    const restoredP3 = await Product.findById(p3._id);
    assert(restoredP3.stock === 10, 'Stock restored to 10');

    // Verify durable restoration record exists
    const durableRestore3 = await InventoryOperation.findOne({ operationId: restoreOpId3 });
    assert(durableRestore3 !== null, 'Durable restoration record exists in collection');

    // Evict restore marker from embedded array
    await Product.updateOne(
      { _id: p3._id },
      { $push: { inventoryOperations: { $each: dummyOps, $slice: -200 } } }
    );
    const slicedP3 = await Product.findById(p3._id);
    const hasEmbeddedRestore3 = slicedP3.inventoryOperations.some(op => op.operationId === restoreOpId3);
    assert(!hasEmbeddedRestore3, 'Embedded array evicted restore marker');

    // Attempt second restoration
    const retryRestoreRes3 = await restoreOrderInventory(order3._id, 'cancellation');
    const finalP3 = await Product.findById(p3._id);
    assert(retryRestoreRes3.restored && retryRestoreRes3.alreadyRestored, 'Duplicate restoration detected via durable collection');
    assert(finalP3.stock === 10, `Stock remained 10 and was NOT incremented again (actual: ${finalP3.stock})`);

    // -------------------------------------------------------------
    // Test 4: Recovery after an old operation has been marked 'archived'
    // -------------------------------------------------------------
    console.log('\nTest 4: Recovery after an old operation has been marked "archived"');
    const p4 = await createTestProduct(10);
    const order4 = await createTestOrder([{ _id: p4._id, quantity: 3 }]);
    const deductOpId4 = `order_${order4._id}_prod_${p4._id}_deduct`;

    // Simulate crash after stock decrement
    try {
      await deductOrderInventory(order4._id, {
        forceCompensation: true,
        simulateCrashAfterItemIndex: 0
      });
    } catch (e) {}

    const crashedP4 = await Product.findById(p4._id);
    assert(crashedP4.stock === 7, 'Stock was decremented before crash (10 -> 7)');

    // Mark the durable deduct operation as "archived"
    await InventoryOperation.updateOne(
      { operationId: deductOpId4 },
      { $set: { status: 'archived' } }
    );
    const archivedOp4 = await InventoryOperation.findOne({ operationId: deductOpId4 });
    assert(archivedOp4.status === 'archived', 'Deduct operation marked as archived in collection');

    // Execute recovery
    const recoverRes4 = await recoverInterruptedInventory(order4._id);
    const healedP4 = await Product.findById(p4._id);
    assert(recoverRes4.recovered, 'Recovery executed successfully');
    assert(healedP4.stock === 10, `Archived operation recognized and stock safely returned to 10 (actual: ${healedP4.stock})`);

    // Repeated recovery call
    await recoverInterruptedInventory(order4._id);
    const repeatHealedP4 = await Product.findById(p4._id);
    assert(repeatHealedP4.stock === 10, 'Subsequent recovery does not double-restore archived operation');

    // -------------------------------------------------------------
    // Test 5: Concurrent attempts to execute the same operation ID
    // -------------------------------------------------------------
    console.log('\nTest 5: Concurrent attempts to execute the same operation ID (Unique Index Guard)');
    const concurrentOpId = `${TEST_PREFIX}UNIQUE_OP_CHECK`;
    const dummyOrderId = new mongoose.Types.ObjectId();
    const dummyProdId = new mongoose.Types.ObjectId();

    const insertPromises = [];
    for (let i = 0; i < 5; i++) {
      insertPromises.push(
        InventoryOperation.create({
          operationId: concurrentOpId,
          orderId: dummyOrderId,
          productId: dummyProdId,
          action: 'deduct',
          quantity: 2,
          claimId: `${TEST_PREFIX}claim_${i}`,
          fencingToken: i
        })
      );
    }

    const settleResults = await Promise.allSettled(insertPromises);
    const successes = settleResults.filter(r => r.status === 'fulfilled');
    const duplicates = settleResults.filter(r => r.status === 'rejected' && r.reason.code === 11000);

    assert(successes.length === 1, `Exactly 1 concurrent insert succeeded (actual: ${successes.length})`);
    assert(duplicates.length === 4, `Exactly 4 concurrent inserts rejected with E11000 duplicate key error (actual: ${duplicates.length})`);

    // -------------------------------------------------------------
    // Test 6: Deterministic stale-worker fencing at stock write (Deduction)
    // -------------------------------------------------------------
    console.log('\nTest 6: Deterministic stale-worker fencing at stock write (Worker 1 pauses, Worker 2 reclaims)');
    const p6 = await createTestProduct(10);
    const order6 = await createTestOrder([{ _id: p6._id, quantity: 2 }]);

    let worker1Paused = false;
    let worker1ResumePromiseResolve;
    const worker1ResumePromise = new Promise(res => { worker1ResumePromiseResolve = res; });
    let worker1Result = null;

    // Launch Worker 1 with deterministic pause hook before product update
    const worker1Promise = deductOrderInventory(order6._id, {
      forceCompensation: true,
      pauseBeforeProductUpdate: async ({ orderId, claimId, fencingToken }) => {
        worker1Paused = true;
        // Wait until Worker 2 has reclaimed and completed
        await worker1ResumePromise;
      }
    }).then(res => { worker1Result = res; return res; });

    // Wait until Worker 1 acquires claim and pauses
    while (!worker1Paused) {
      await new Promise(r => setTimeout(r, 50));
    }

    const initialClaimedOrder = await Order.findById(order6._id);
    assert(initialClaimedOrder.claimVersion === 1, 'Worker 1 acquired claim with claimVersion = 1');

    // Simulate claim expiration so Worker 2 is authorized to take over
    const staleTime = new Date(Date.now() - 35000);
    await Order.updateOne(
      { _id: order6._id },
      { $set: { inventoryClaimedAt: staleTime, inventoryHeartbeatAt: staleTime } }
    );

    // Worker 2 runs and reclaims the order
    const worker2Result = await deductOrderInventory(order6._id, { forceCompensation: true });
    const reclaimedOrder = await Order.findById(order6._id);
    const midP6 = await Product.findById(p6._id);

    assert(worker2Result.success, 'Worker 2 successfully reclaimed and processed the order');
    assert(reclaimedOrder.claimVersion === 2, `Worker 2 incremented claimVersion to 2 (actual: ${reclaimedOrder.claimVersion})`);
    assert(midP6.stock === 8, `Worker 2 decremented stock from 10 to 8 (actual: ${midP6.stock})`);

    // Resume Worker 1
    worker1ResumePromiseResolve();
    await worker1Promise;

    const finalP6 = await Product.findById(p6._id);
    assert(worker1Result.fencedOut === true, 'Worker 1 was fenced out at the stock write');
    assert(finalP6.stock === 8, `Product stock remains 8 and was NOT decremented by stale Worker 1 (actual: ${finalP6.stock})`);

    // -------------------------------------------------------------
    // Test 7: Stale worker attempting stock update after order is cancelled by Worker 2
    // -------------------------------------------------------------
    console.log('\nTest 7: Stale worker attempting stock update after order is cancelled by Worker 2');
    const p7 = await createTestProduct(10);
    const order7 = await createTestOrder([{ _id: p7._id, quantity: 2 }]);

    let worker1CancelPaused = false;
    let worker1CancelResume;
    const worker1CancelPromise = new Promise(res => { worker1CancelResume = res; });
    let worker1CancelResult = null;

    const worker1CancelTask = deductOrderInventory(order7._id, {
      forceCompensation: true,
      pauseBeforeProductUpdate: async () => {
        worker1CancelPaused = true;
        await worker1CancelPromise;
      }
    }).then(res => { worker1CancelResult = res; return res; });

    while (!worker1CancelPaused) {
      await new Promise(r => setTimeout(r, 50));
    }

    // Worker 2 reclaims and marks order cancelled with a rollback/restore marker
    await InventoryOperation.create({
      operationId: `${TEST_PREFIX}order_${order7._id}_rollback`,
      orderId: order7._id,
      productId: p7._id,
      action: 'rollback',
      quantity: 2,
      claimId: `${TEST_PREFIX}worker2`
    });
    await Order.updateOne(
      { _id: order7._id },
      { $set: { status: 'cancelled', inventoryStatus: 'not_deducted' }, $inc: { claimVersion: 1 } }
    );

    // Resume Worker 1
    worker1CancelResume();
    await worker1CancelTask;

    const finalP7 = await Product.findById(p7._id);
    assert(worker1CancelResult.fencedOut === true, 'Worker 1 detected order cancellation and was fenced out');
    assert(finalP7.stock === 10, `Product stock remained 10 (untouched by stale worker)`);

    // -------------------------------------------------------------
    // Test 8: Stale-worker fencing at stock write during restoration
    // -------------------------------------------------------------
    console.log('\nTest 8: Stale-worker fencing at stock write during restoration');
    const p8 = await createTestProduct(10);
    const order8 = await createTestOrder([{ _id: p8._id, quantity: 2 }], {
      inventoryStatus: 'deducted',
      itemInventoryState: 'deducted'
    });
    // Set stock to 8 reflecting initial deduction
    await Product.updateOne({ _id: p8._id }, { $set: { stock: 8 } });

    let restorePaused = false;
    let restoreResume;
    const restorePromise = new Promise(res => { restoreResume = res; });
    let restoreWorker1Result = null;

    const restoreTask1 = restoreOrderInventory(order8._id, 'cancellation', {
      pauseBeforeProductUpdate: async () => {
        restorePaused = true;
        await restorePromise;
      }
    }).then(res => { restoreWorker1Result = res; return res; });

    while (!restorePaused) {
      await new Promise(r => setTimeout(r, 50));
    }

    // Expire Worker 1 claim
    await Order.updateOne(
      { _id: order8._id },
      { $set: { inventoryClaimedAt: staleTime, inventoryHeartbeatAt: staleTime } }
    );

    // Worker 2 restores the order
    const restoreWorker2Result = await restoreOrderInventory(order8._id, 'cancellation');
    const midP8 = await Product.findById(p8._id);
    assert(restoreWorker2Result.restored, 'Worker 2 restored order successfully');
    assert(midP8.stock === 10, `Stock restored to 10 by Worker 2 (actual: ${midP8.stock})`);

    // Resume Worker 1
    restoreResume();
    await restoreTask1;

    const finalP8 = await Product.findById(p8._id);
    assert(restoreWorker1Result.fencedOut === true, 'Worker 1 was fenced out during restoration write');
    assert(finalP8.stock === 10, `Stock was NOT incremented a second time by stale worker (actual: ${finalP8.stock}, expected 10)`);

    // -------------------------------------------------------------
    // Test 9: Transaction rollback on supported environments (Replica Set)
    // -------------------------------------------------------------
    console.log('\nTest 9: Multi-document transaction rollback on supported environments');
    if (isReplicaSet) {
      const p9A = await createTestProduct(10);
      const p9B = await createTestProduct(0); // Out of stock to force transaction abort
      const order9 = await createTestOrder([
        { _id: p9A._id, quantity: 2 },
        { _id: p9B._id, quantity: 1 }
      ]);

      const txResult = await deductOrderInventory(order9._id);
      assert(!txResult.success, 'Transactional deduction aborted due to insufficient stock on item 2');

      const finalP9A = await Product.findById(p9A._id);
      const finalP9B = await Product.findById(p9B._id);
      const orphanedOps = await InventoryOperation.countDocuments({ orderId: order9._id });
      const finalOrder9 = await Order.findById(order9._id);

      assert(finalP9A.stock === 10, `Product A stock remained 10 (rolled back in transaction)`);
      assert(finalP9B.stock === 0, `Product B stock remained 0`);
      assert(orphanedOps === 0, `Zero orphaned records in InventoryOperation collection (actual: ${orphanedOps})`);
      assert(finalOrder9.inventoryStatus === 'deduction_failed', 'Order status marked "deduction_failed"');
    } else {
      console.log('  ⚠ SKIP: Standalone MongoDB deployment detected (skipping replica set transaction test)');
    }

    // -------------------------------------------------------------
    // Test 10: Repeated recovery remains safe
    // -------------------------------------------------------------
    console.log('\nTest 10: Repeated recovery remains safe');
    const p10 = await createTestProduct(10);
    const order10 = await createTestOrder([{ _id: p10._id, quantity: 2 }]);

    // Deduct stock, then crash
    try {
      await deductOrderInventory(order10._id, {
        forceCompensation: true,
        simulateCrashAfterItemIndex: 0
      });
    } catch (e) {}

    // First recovery
    const rec1 = await recoverInterruptedInventory(order10._id);
    const p10AfterRec1 = await Product.findById(p10._id);
    assert(rec1.recovered, 'First recovery recovered stock');
    assert(p10AfterRec1.stock === 10, `Stock restored to 10 on first recovery (actual: ${p10AfterRec1.stock})`);

    // Second recovery
    const rec2 = await recoverInterruptedInventory(order10._id);
    const p10AfterRec2 = await Product.findById(p10._id);
    assert(p10AfterRec2.stock === 10, `Stock remains 10 on second recovery (actual: ${p10AfterRec2.stock})`);

    // Third recovery
    const rec3 = await recoverInterruptedInventory(order10._id);
    const p10AfterRec3 = await Product.findById(p10._id);
    assert(p10AfterRec3.stock === 10, `Stock remains 10 on third recovery (actual: ${p10AfterRec3.stock})`);

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

runDurableFencingTests();

