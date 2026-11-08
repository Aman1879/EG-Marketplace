/**
 * TASK 3G: TEST SUITE FOR TRANSACTION-SAFE INVENTORY & RECOVERY RACES
 *
 * Verifies all 10 critical requirements:
 * 1. An active worker cannot be interrupted by recovery.
 * 2. Recovery can take over a genuinely stale worker.
 * 3. A stale worker cannot commit a stock mutation after losing ownership.
 * 4. A transaction failure leaves Product stock, InventoryOperation, and Order state unchanged.
 * 5. Duplicate deduction requests decrement stock exactly once.
 * 6. Duplicate restoration requests increment stock exactly once.
 * 7. Removing or evicting old diagnostic Product markers does not permit duplicate stock mutations.
 * 8. Recovery after a transaction abort is safe.
 * 9. The application refuses inventory mutation when transactions are unavailable.
 * 10. Concurrent checkout/payment events cannot produce negative stock.
 *
 * Database Safety: Strictly runs against dedicated test database (marketplace_test).
 * Zero credential or secret exposure.
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

const TEST_PREFIX = `TEST_T3G_${Date.now()}_`;
const dummyBuyerId = new mongoose.Types.ObjectId();
const dummyVendorId = new mongoose.Types.ObjectId();

async function createTestProduct(stock, price = 100) {
  return await Product.create({
    title: `${TEST_PREFIX}Prod_${Math.random().toString(36).substring(7)}`,
    description: 'Test product for Task 3G transaction safety',
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
    shippingAddress: '789 Transactional Test Blvd',
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

async function runTransactionSafetyTests() {
  console.log('\n============================================================');
  console.log(' TASK 3G: TRANSACTION-SAFE INVENTORY & RECOVERY TEST SUITE');
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
    // TEST 1: AN ACTIVE WORKER CANNOT BE INTERRUPTED BY RECOVERY
    // =============================================================
    console.log('Test 1: An active worker cannot be interrupted by recovery');
    const p1 = await createTestProduct(10);
    const order1 = await createTestOrder([{ _id: p1._id, quantity: 2 }], {
      inventoryStatus: 'deducting',
      inventoryClaimedAt: new Date(),
      inventoryHeartbeatAt: new Date()
    });

    const recovery1 = await recoverInterruptedInventory(order1._id);
    const order1Check = await Order.findById(order1._id);
    const p1Check = await Product.findById(p1._id);

    assert(recovery1.recovered === false, 'Recovery returned false for active unexpired worker');
    assert(recovery1.activeWorker === true, 'Recovery explicitly recognized active worker');
    assert(order1Check.inventoryStatus === 'deducting', 'Order remains in "deducting" state without interruption');
    assert(p1Check.stock === 10, 'Product stock remained untouched at 10');

    // =============================================================
    // TEST 2: RECOVERY CAN TAKE OVER A GENUINELY STALE WORKER
    // =============================================================
    console.log('\nTest 2: Recovery can take over a genuinely stale worker');
    const p2 = await createTestProduct(10);
    const staleTime = new Date(Date.now() - 45000); // 45s ago (> 30s threshold)
    const order2 = await createTestOrder([{ _id: p2._id, quantity: 2 }], {
      inventoryStatus: 'deducting',
      inventoryClaimedAt: staleTime,
      inventoryHeartbeatAt: staleTime,
      claimVersion: 1
    });

    // Simulate stale worker had decremented stock and marked completed before crashing
    const opId2 = `order_${order2._id}_prod_${p2._id}_deduct`;
    await InventoryOperation.create({
      operationId: opId2,
      orderId: order2._id,
      productId: p2._id,
      action: 'deduct',
      quantity: 2,
      claimId: 'stale_worker_claim',
      fencingToken: 1,
      status: 'completed',
      completedAt: new Date()
    });
    await Product.updateOne({ _id: p2._id }, { $inc: { stock: -2 } });

    const recovery2 = await recoverInterruptedInventory(order2._id);
    const order2Final = await Order.findById(order2._id);
    const p2Final = await Product.findById(p2._id);
    const rollbackOp2 = await InventoryOperation.findOne({
      orderId: order2._id,
      productId: p2._id,
      action: 'rollback'
    });

    assert(recovery2.recovered === true, 'Recovery succeeded for genuinely stale worker');
    assert(order2Final.inventoryStatus === 'not_deducted', 'Order transitioned to "not_deducted"');
    assert(order2Final.claimVersion === 2, `Claim version incremented from 1 to 2 (actual: ${order2Final.claimVersion})`);
    assert(p2Final.stock === 10, `Product stock safely restored to 10 (actual: ${p2Final.stock})`);
    assert(rollbackOp2 !== null && rollbackOp2.status === 'completed', 'Durable rollback record created with status "completed"');

    // =============================================================
    // TEST 3: STALE WORKER CANNOT COMMIT A STOCK MUTATION AFTER LOSING OWNERSHIP
    // =============================================================
    console.log('\nTest 3: Stale worker cannot commit a stock mutation after losing ownership');
    const p3 = await createTestProduct(10);
    const order3 = await createTestOrder([{ _id: p3._id, quantity: 3 }]);

    let worker1Paused = false;
    let worker1Resume;
    const worker1Promise = new Promise(r => { worker1Resume = r; });
    let worker1Result = null;

    // Launch Worker 1 in replica set transaction, pausing inside transaction before stock write
    const worker1Task = deductOrderInventory(order3._id, {
      pauseInTransactionBeforeStockWrite: async () => {
        worker1Paused = true;
        await worker1Promise;
      }
    }).then(res => { worker1Result = res; return res; });

    while (!worker1Paused) {
      await new Promise(r => setTimeout(r, 50));
    }

    // Force claim expiration so Worker 2 claims the order
    await Order.updateOne(
      { _id: order3._id },
      { $set: { inventoryClaimedAt: staleTime, inventoryHeartbeatAt: staleTime } }
    );

    // Worker 2 takes over and completes deduction
    const worker2Result = await deductOrderInventory(order3._id);
    const p3AfterWorker2 = await Product.findById(p3._id);

    assert(worker2Result.success === true, 'Worker 2 successfully completed deduction transaction');
    assert(p3AfterWorker2.stock === 7, `Product stock decremented to 7 by Worker 2 (actual: ${p3AfterWorker2.stock})`);

    // Resume Worker 1: its transaction must abort because ownership was lost or operationId collided
    worker1Resume();
    await worker1Task;

    const p3Final = await Product.findById(p3._id);
    assert(worker1Result.success === false, 'Stale Worker 1 transaction was aborted');
    assert(p3Final.stock === 7, `Product stock remains exactly 7 (NOT decremented to 4!)`);

    // =============================================================
    // TEST 4: TRANSACTION FAILURE LEAVES STOCK, LEDGER, AND ORDER UNCHANGED
    // =============================================================
    console.log('\nTest 4: Transaction failure leaves stock, ledger, and order unchanged');
    const p4A = await createTestProduct(5);
    const p4B = await createTestProduct(0); // Zero stock to force transaction abort on item 2
    const order4 = await createTestOrder([
      { _id: p4A._id, quantity: 2 },
      { _id: p4B._id, quantity: 1 }
    ]);

    const txFailRes = await deductOrderInventory(order4._id);
    const p4AFinal = await Product.findById(p4A._id);
    const p4BFinal = await Product.findById(p4B._id);
    const order4Final = await Order.findById(order4._id);
    const op4A = await InventoryOperation.findOne({
      orderId: order4._id,
      productId: p4A._id,
      action: 'deduct'
    });

    assert(txFailRes.success === false, 'Multi-product order transaction aborted due to item 2 out of stock');
    assert(p4AFinal.stock === 5, `Product A stock remained exactly 5 in atomic rollback (actual: ${p4AFinal.stock})`);
    assert(p4BFinal.stock === 0, `Product B stock remained 0 (actual: ${p4BFinal.stock})`);
    assert(op4A === null, 'No completed or orphaned InventoryOperation record committed for Product A');
    assert(order4Final.inventoryStatus === 'deduction_failed', 'Order marked "deduction_failed"');

    // =============================================================
    // TEST 5: DUPLICATE DEDUCTION REQUESTS DECREMENT STOCK EXACTLY ONCE
    // =============================================================
    console.log('\nTest 5: Duplicate deduction requests decrement stock exactly once');
    const p5 = await createTestProduct(10);
    const order5 = await createTestOrder([{ _id: p5._id, quantity: 4 }]);

    const deduct1 = await deductOrderInventory(order5._id);
    assert(deduct1.success === true, 'First deduction succeeded');
    const p5AfterFirst = await Product.findById(p5._id);
    assert(p5AfterFirst.stock === 6, `Stock decremented from 10 to 6 (actual: ${p5AfterFirst.stock})`);

    const deduct2 = await deductOrderInventory(order5._id);
    assert(deduct2.alreadyDeducted === true, 'Second deduction recognized order was already deducted');
    const p5AfterSecond = await Product.findById(p5._id);
    assert(p5AfterSecond.stock === 6, `Stock remained strictly 6 after duplicate request (actual: ${p5AfterSecond.stock})`);

    // =============================================================
    // TEST 6: DUPLICATE RESTORATION REQUESTS INCREMENT STOCK EXACTLY ONCE
    // =============================================================
    console.log('\nTest 6: Duplicate restoration requests increment stock exactly once');
    const p6 = await createTestProduct(6);
    const order6 = await createTestOrder([{ _id: p6._id, quantity: 4 }], {
      inventoryStatus: 'deducted'
    });

    const restore1 = await restoreOrderInventory(order6._id, 'cancellation');
    assert(restore1.restored === true, 'First cancellation restoration succeeded');
    const p6AfterFirst = await Product.findById(p6._id);
    assert(p6AfterFirst.stock === 10, `Stock incremented from 6 to 10 (actual: ${p6AfterFirst.stock})`);

    const restore2 = await restoreOrderInventory(order6._id, 'cancellation');
    assert(restore2.alreadyRestored === true, 'Second restoration recognized order was already restored');
    const p6AfterSecond = await Product.findById(p6._id);
    assert(p6AfterSecond.stock === 10, `Stock remained strictly 10 (NOT incremented to 14!)`);

    // =============================================================
    // TEST 7: EVICTION OF DIAGNOSTIC PRODUCT MARKERS DOES NOT PERMIT DUPLICATE MUTATIONS
    // =============================================================
    console.log('\nTest 7: Removing or evicting old diagnostic Product markers does not permit duplicate mutations');
    const p7 = await createTestProduct(10);
    const order7 = await createTestOrder([{ _id: p7._id, quantity: 2 }]);

    const deduct7 = await deductOrderInventory(order7._id);
    assert(deduct7.success === true, 'Initial deduction succeeded');
    const p7AfterDeduct = await Product.findById(p7._id);
    assert(p7AfterDeduct.stock === 8, `Stock is 8 (actual: ${p7AfterDeduct.stock})`);

    // Simulate extreme eviction where Product.inventoryOperations array was completely cleared / evicted
    await Product.updateOne({ _id: p7._id }, { $set: { inventoryOperations: [] } });

    // Attempt retry
    const retryDeduct7 = await deductOrderInventory(order7._id);
    const p7AfterRetry = await Product.findById(p7._id);

    assert(retryDeduct7.alreadyDeducted === true, 'Retry rejected duplicate deduction using authoritative InventoryOperation');
    assert(p7AfterRetry.stock === 8, `Stock remained strictly 8 despite evicted Product markers (actual: ${p7AfterRetry.stock})`);

    // =============================================================
    // TEST 8: RECOVERY AFTER A TRANSACTION ABORT IS SAFE
    // =============================================================
    console.log('\nTest 8: Recovery after a transaction abort is safe');
    const p8 = await createTestProduct(10);
    const order8 = await createTestOrder([{ _id: p8._id, quantity: 3 }], {
      inventoryStatus: 'deduction_failed'
    });

    const recovery8 = await recoverInterruptedInventory(order8._id);
    const p8Final = await Product.findById(p8._id);
    const order8Final = await Order.findById(order8._id);

    assert(recovery8.recovered === true, 'Recovery completed cleanly for failed transaction');
    assert(p8Final.stock === 10, `Stock remained 10 (no phantom rollbacks, actual: ${p8Final.stock})`);
    assert(order8Final.inventoryStatus === 'not_deducted', 'Order status returned to "not_deducted"');

    // =============================================================
    // TEST 9: APPLICATION REFUSES INVENTORY MUTATIONS WHEN TRANSACTIONS UNAVAILABLE
    // =============================================================
    console.log('\nTest 9: Application refuses inventory mutations when transactions unavailable');
    const p9 = await createTestProduct(10);
    const order9 = await createTestOrder([{ _id: p9._id, quantity: 2 }]);

    const noTxDeduct = await deductOrderInventory(order9._id, { simulateNoTransactions: true });
    const p9Check = await Product.findById(p9._id);
    const order9Check = await Order.findById(order9._id);

    assert(noTxDeduct.success === false, 'Deduction rejected when transactions are unavailable');
    assert(noTxDeduct.transactionUnavailable === true, 'Returned transactionUnavailable flag');
    assert(noTxDeduct.reason.includes('TransactionUnavailableError'), 'Reason contains TransactionUnavailableError');
    assert(p9Check.stock === 10, 'Stock was not decremented outside transaction');
    assert(order9Check.inventoryStatus === 'not_deducted', 'Order claim was released safely');

    // Test restoration refusal
    const order9Restore = await createTestOrder([{ _id: p9._id, quantity: 2 }], {
      inventoryStatus: 'deducted'
    });
    const noTxRestore = await restoreOrderInventory(order9Restore._id, 'cancellation', { simulateNoTransactions: true });
    const p9RestoreCheck = await Product.findById(p9._id);

    assert(noTxRestore.restored === false, 'Restoration rejected when transactions are unavailable');
    assert(noTxRestore.transactionUnavailable === true, 'Returned transactionUnavailable flag for restoration');
    assert(p9RestoreCheck.stock === 10, 'Stock was not incremented outside transaction');

    // =============================================================
    // TEST 10: CONCURRENT CHECKOUT/PAYMENT EVENTS CANNOT PRODUCE NEGATIVE STOCK
    // =============================================================
    console.log('\nTest 10: Concurrent checkout/payment events cannot produce negative stock');
    const p10 = await createTestProduct(1); // Exactly 1 item available
    const orders = await Promise.all([
      createTestOrder([{ _id: p10._id, quantity: 1 }]),
      createTestOrder([{ _id: p10._id, quantity: 1 }]),
      createTestOrder([{ _id: p10._id, quantity: 1 }]),
      createTestOrder([{ _id: p10._id, quantity: 1 }]),
      createTestOrder([{ _id: p10._id, quantity: 1 }])
    ]);

    const results = await Promise.all(orders.map(o => deductOrderInventory(o._id)));
    const successfulCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;
    const p10Final = await Product.findById(p10._id);

    assert(successfulCount === 1, `Exactly 1 concurrent buyer succeeded (actual: ${successfulCount})`);
    assert(failedCount === 4, `Exactly 4 concurrent buyers failed (actual: ${failedCount})`);
    assert(p10Final.stock === 0, `Final stock is exactly 0 (actual: ${p10Final.stock}) and never negative`);

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

runTransactionSafetyTests();

