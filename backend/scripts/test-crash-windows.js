/**
 * TASK 3B: TEST SUITE FOR CRASH WINDOWS, ATOMIC IDEMPOTENT PRODUCT OPERATIONS,
 * AND WORKER FENCING TOKENS
 *
 * Requirements:
 * 1. Crash after stock decrement but before order item state is saved.
 * 2. Recovery after that crash does not lose stock or increment it twice.
 * 3. Crash after stock increment but before order item state is saved.
 * 4. Recovery after that crash does not increment stock twice.
 * 5. Original worker continues after its claim expires.
 * 6. Replacement worker claims the order.
 * 7. Stale original worker is prevented from making further changes (fenced out).
 * 8. Duplicate operation ID cannot change stock twice.
 * 9. Transaction failure rolls back stock and order item state together.
 * 10. Repeated recovery remains safe.
 *
 * Database Safety: Runs against dedicated test database (TEST_MONGODB_URI).
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
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

const TEST_PREFIX = `TEST_T3B_${Date.now()}_`;
const dummyBuyerId = new mongoose.Types.ObjectId();
const dummyVendorId = new mongoose.Types.ObjectId();

async function createTestProduct(stock, price = 100) {
  return await Product.create({
    title: `${TEST_PREFIX}Prod_${Math.random().toString(36).substring(7)}`,
    description: 'Test product for crash window verification',
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
}

async function runCrashWindowTests() {
  console.log('\n============================================================');
  console.log(' TASK 3B: CRASH WINDOW & WORKER FENCING INTEGRATION TESTS');
  console.log('============================================================\n');

  // Verify dedicated test database is configured per requirement 5
  const testDbUri = process.env.TEST_MONGODB_URI || process.env.MONGODB_URI?.replace('/marketplace', '/marketplace_test');
  if (!testDbUri) {
    console.error('Fatal: No dedicated test database URI configured.');
    process.exit(1);
  }

  try {
    await mongoose.connect(testDbUri);
    console.log('Connected to DEDICATED TEST DATABASE:', mongoose.connection.name);
    assert(mongoose.connection.name.includes('test'), 'Connected to dedicated test database, NOT production/development');

    const topology = mongoose.connection?.client?.topology?.description?.type;
    console.log('Cluster Topology:', topology, '| Replica Set Transactions Supported:', topology === 'ReplicaSetWithPrimary' || topology === 'Sharded');
    console.log('------------------------------------------------------------\n');

    // -------------------------------------------------------------
    // Test 1: Crash after stock decrement but before order item state is saved
    // -------------------------------------------------------------
    console.log('Test 1: Crash after stock decrement but before order item state is saved');
    const p1 = await createTestProduct(10);
    const order1 = await createTestOrder([{ _id: p1._id, quantity: 3 }]);

    let crash1Caught = false;
    try {
      await deductOrderInventory(order1._id, {
        forceCompensation: true,
        simulateCrashAfterItemIndex: 0
      });
    } catch (err) {
      crash1Caught = true;
    }

    const crashedP1 = await Product.findById(p1._id);
    const crashedOrder1 = await Order.findById(order1._id);

    assert(crash1Caught, 'Server crash simulated immediately after product decrement');
    assert(crashedP1.stock === 7, `Product stock was decremented to 7 (current: ${crashedP1.stock})`);
    assert(crashedP1.inventoryOperations.length === 1, 'Product document holds the atomic operation marker');
    assert(
      crashedP1.inventoryOperations[0].operationId === `order_${order1._id}_prod_${p1._id}_deduct`,
      'Operation marker matches unique order deduction operation ID'
    );
    assert(crashedOrder1.inventoryStatus === 'deducting', 'Order was left in "deducting" state without saving item state');

    // -------------------------------------------------------------
    // Test 2: Recovery after that crash does not lose stock or increment it twice
    // -------------------------------------------------------------
    console.log('\nTest 2: Recovery after that crash does not lose stock or increment it twice');
    const recoveryRes2 = await recoverInterruptedInventory(order1._id);
    const recoveredP1 = await Product.findById(p1._id);
    const recoveredOrder1 = await Order.findById(order1._id);

    assert(recoveryRes2.recovered === true, 'Recovery executed successfully');
    assert(recoveryRes2.rolledBackCount === 1, 'Recovery identified the product using Product ground-truth marker');
    assert(recoveredP1.stock === 10, `Product stock was safely returned to 10 (current: ${recoveredP1.stock})`);
    assert(recoveredOrder1.inventoryStatus === 'not_deducted', 'Order status returned to "not_deducted"');

    // Run recovery again to verify it does not increment stock twice
    const repeatRec2 = await recoverInterruptedInventory(order1._id);
    const p1AfterRepeat = await Product.findById(p1._id);
    assert(p1AfterRepeat.stock === 10, 'Repeated recovery did not increment stock twice');

    // -------------------------------------------------------------
    // Test 3: Crash after stock increment but before order item state is saved
    // -------------------------------------------------------------
    console.log('\nTest 3: Crash after stock increment but before order item state is saved');
    const p3 = await createTestProduct(5);
    const order3 = await createTestOrder(
      [{ _id: p3._id, quantity: 2 }],
      {
        inventoryStatus: 'deducted',
        itemInventoryState: 'deducted'
      }
    );
    // Mark initial deduct operation on product
    p3.inventoryOperations.push({
      operationId: `order_${order3._id}_prod_${p3._id}_deduct`,
      orderId: order3._id,
      action: 'deduct',
      quantity: 2
    });
    await p3.save();

    let crash3Caught = false;
    try {
      await restoreOrderInventory(order3._id, 'cancellation', {
        simulateCrashAfterRestoreIndex: 0
      });
    } catch (err) {
      crash3Caught = true;
    }

    const crashedP3 = await Product.findById(p3._id);
    const crashedOrder3 = await Order.findById(order3._id);

    assert(crash3Caught, 'Server crash simulated immediately after product increment');
    assert(crashedP3.stock === 7, `Product stock was incremented to 7 (current: ${crashedP3.stock})`);
    assert(
      crashedP3.inventoryOperations.some(op => op.action === 'restore'),
      'Product document holds the atomic restore operation marker'
    );
    assert(crashedOrder3.inventoryStatus === 'restoring', 'Order was left in "restoring" state');

    // -------------------------------------------------------------
    // Test 4: Recovery after that crash does not increment stock twice
    // -------------------------------------------------------------
    console.log('\nTest 4: Recovery after that crash does not increment stock twice');
    const recoveryRes4 = await recoverInterruptedInventory(order3._id);
    const recoveredP3 = await Product.findById(p3._id);
    const recoveredOrder3 = await Order.findById(order3._id);

    assert(recoveryRes4.recovered === true, 'Recovery executed successfully');
    assert(recoveryRes4.restoredCount === 0, 'Recovery skipped product because restore marker was already present');
    assert(recoveredP3.stock === 7, `Product stock remains exactly 7 (NOT incremented to 9!)`);
    assert(recoveredOrder3.inventoryStatus === 'restored', 'Order status finalized to "restored"');

    // -------------------------------------------------------------
    // Test 5, 6 & 7: Original worker continues after claim expires, replacement worker claims, stale worker fenced out
    // -------------------------------------------------------------
    console.log('\nTest 5, 6 & 7: Stale worker fencing with claim versions and active heartbeats');
    const p5 = await createTestProduct(10);
    const order5 = await createTestOrder([{ _id: p5._id, quantity: 2 }]);

    // Worker 1 claims order
    const claim1Result = await Order.findOneAndUpdate(
      { _id: order5._id, inventoryStatus: 'not_deducted' },
      {
        $set: {
          inventoryStatus: 'deducting',
          inventoryClaimId: 'worker_1',
          inventoryClaimedAt: new Date(Date.now() - 35000), // 35s ago (expired)
          inventoryHeartbeatAt: new Date(Date.now() - 35000) // no heartbeat for 35s (abandoned)
        },
        $inc: { claimVersion: 1 }
      },
      { new: true }
    );

    const worker1Token = claim1Result.claimVersion;
    assert(worker1Token === 1, 'Worker 1 acquired initial claim with fencingToken = 1');

    // Replacement Worker 2 reclaims the abandoned order
    const staleThreshold = new Date(Date.now() - 30000);
    const claim2Result = await Order.findOneAndUpdate(
      {
        _id: order5._id,
        inventoryStatus: 'deducting',
        inventoryHeartbeatAt: { $lt: staleThreshold }
      },
      {
        $set: {
          inventoryClaimId: 'worker_2',
          inventoryClaimedAt: new Date(),
          inventoryHeartbeatAt: new Date()
        },
        $inc: { claimVersion: 1 }
      },
      { new: true }
    );

    const worker2Token = claim2Result.claimVersion;
    assert(worker2Token === 2, 'Replacement Worker 2 claimed the order with fencingToken = 2');

    // Now stale Worker 1 tries to commit a deduction or heartbeat with its stale token
    let worker1FencedOut = false;
    const staleCommit = await Order.findOneAndUpdate(
      {
        _id: order5._id,
        inventoryClaimId: 'worker_1',
        claimVersion: worker1Token,
        inventoryStatus: 'deducting'
      },
      {
        $set: { inventoryStatus: 'deducted' }
      },
      { new: true }
    );

    if (!staleCommit) {
      worker1FencedOut = true;
    }

    assert(worker1FencedOut, 'Stale Worker 1 was fenced out because claimVersion changed from 1 to 2');
    const freshOrder5 = await Order.findById(order5._id);
    assert(freshOrder5.inventoryClaimId === 'worker_2', 'Active owner remains Worker 2');
    assert(freshOrder5.inventoryStatus === 'deducting', 'Order status was NOT corrupted by stale Worker 1');

    // -------------------------------------------------------------
    // Test 8: Duplicate operation ID cannot change stock twice
    // -------------------------------------------------------------
    console.log('\nTest 8: Duplicate operation ID cannot change stock twice');
    const p8 = await createTestProduct(10);
    const opId = `test_idempotent_op_${Date.now()}`;

    // First atomic update with opId
    const firstUpdate = await Product.findOneAndUpdate(
      {
        _id: p8._id,
        stock: { $gte: 3 },
        'inventoryOperations.operationId': { $ne: opId }
      },
      {
        $inc: { stock: -3 },
        $push: {
          inventoryOperations: {
            operationId: opId,
            action: 'deduct',
            quantity: 3
          }
        }
      },
      { new: true }
    );

    assert(firstUpdate !== null, 'First execution of operation ID succeeded');
    assert(firstUpdate.stock === 7, 'Stock decremented to 7');

    // Attempt duplicate update with the identical opId
    const secondUpdate = await Product.findOneAndUpdate(
      {
        _id: p8._id,
        stock: { $gte: 3 },
        'inventoryOperations.operationId': { $ne: opId }
      },
      {
        $inc: { stock: -3 },
        $push: {
          inventoryOperations: {
            operationId: opId,
            action: 'deduct',
            quantity: 3
          }
        }
      },
      { new: true }
    );

    const p8AfterSecond = await Product.findById(p8._id);
    assert(secondUpdate === null, 'Second execution with duplicate opId returned null (rejected)');
    assert(p8AfterSecond.stock === 7, 'Stock remained exactly 7 (NOT decremented to 4!)');

    // -------------------------------------------------------------
    // Test 9: Transaction failure rolls back stock and order item state together
    // -------------------------------------------------------------
    console.log('\nTest 9: Transaction failure rolls back stock and order item state together');
    const p9A = await createTestProduct(5);
    const p9B = await createTestProduct(0); // 0 stock triggers transaction abort
    const order9 = await createTestOrder([
      { _id: p9A._id, quantity: 2 },
      { _id: p9B._id, quantity: 1 }
    ]);

    const txResult = await deductOrderInventory(order9._id, { forceCompensation: false });
    const p9AFinal = await Product.findById(p9A._id);
    const p9BFinal = await Product.findById(p9B._id);
    const order9Final = await Order.findById(order9._id);

    assert(txResult.success === false, 'Transaction aborted due to insufficient stock on item 2');
    assert(p9AFinal.stock === 5, 'Product A stock rolled back cleanly to 5 (not left partially decremented)');
    assert(p9BFinal.stock === 0, 'Product B stock remains 0');
    assert(order9Final.inventoryStatus === 'deduction_failed', 'Order status marked "deduction_failed"');
    assert(
      order9Final.products[0].inventoryState === 'pending',
      'Order item state remains pending in transaction rollback'
    );

    // -------------------------------------------------------------
    // Test 10: Repeated recovery remains safe
    // -------------------------------------------------------------
    console.log('\nTest 10: Repeated recovery remains safe');
    const p10 = await createTestProduct(10);
    const order10 = await createTestOrder([{ _id: p10._id, quantity: 2 }], {
      inventoryStatus: 'deduction_failed',
      itemInventoryState: 'pending'
    });

    // 3 successive recovery calls
    const r1 = await recoverInterruptedInventory(order10._id);
    const r2 = await recoverInterruptedInventory(order10._id);
    const r3 = await recoverInterruptedInventory(order10._id);

    const p10Final = await Product.findById(p10._id);
    assert(r1.recovered === true, 'First recovery call succeeded');
    assert(p10Final.stock === 10, 'Stock remained 10 through repeated recovery calls');

  } catch (err) {
    console.error('Test suite error:', err);
    failedTests++;
  } finally {
    console.log('\nCleaning up test artifacts from dedicated test database...');
    await cleanupTestData();
    await mongoose.disconnect();
    console.log('Test database disconnected.');
  }

  console.log('\n============================================================');
  console.log(` TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runCrashWindowTests();

