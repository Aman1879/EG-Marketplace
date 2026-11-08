/**
 * TASK 3A: INTEGRATION TEST SUITE FOR CONCURRENCY, DYNAMIC STATE TRANSITIONS,
 * RECOVERABILITY, AND PAYMENT/REFUND ORDERING
 *
 * Runs against real MongoDB to verify database-level atomic operations,
 * document write locks, crash recovery, and payment state idempotency.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const {
  deductOrderInventory,
  restoreOrderInventory,
  recoverInterruptedInventory,
  initiateOrderRefund
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

// Helpers to create test fixtures with unique identifiers
const TEST_PREFIX = `TEST_T3A_${Date.now()}_`;
const dummyBuyerId = new mongoose.Types.ObjectId();
const dummyVendorId = new mongoose.Types.ObjectId();

async function createTestProduct(stock, price = 100) {
  return await Product.create({
    title: `${TEST_PREFIX}Product_${Math.random().toString(36).substring(7)}`,
    description: 'Test product for concurrency testing',
    price,
    stock,
    category: 'Electronics',
    imageUrl: 'https://example.com/test-image.jpg',
    vendorId: dummyVendorId,
    isActive: true
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
    shippingAddress: '123 Test Lane',
    paymentStatus: overrides.paymentStatus || 'created',
    inventoryStatus: overrides.inventoryStatus || 'not_deducted',
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

async function runTestSuite() {
  console.log('\n============================================================');
  console.log(' TASK 3A: CONCURRENCY, RECOVERY & PAYMENT INTEGRATION TESTS');
  console.log('============================================================\n');

  try {
    const testDbUri = process.env.TEST_MONGODB_URI || process.env.MONGODB_URI?.replace('/marketplace', '/marketplace_test');
    await mongoose.connect(testDbUri);
    console.log('Connected to dedicated test database:', mongoose.connection.name);
    const topology = mongoose.connection?.client?.topology?.description?.type;
    console.log('Cluster Topology:', topology, '| Replica Set Transactions Supported:', topology === 'ReplicaSetWithPrimary' || topology === 'Sharded');
    console.log('------------------------------------------------------------\n');

    // -------------------------------------------------------------
    // Test 1: Two simultaneous payment-verification requests for one order
    // -------------------------------------------------------------
    console.log('Test 1: Two simultaneous payment-verification requests for one order');
    const p1 = await createTestProduct(10);
    const order1 = await createTestOrder([{ _id: p1._id, quantity: 3 }]);

    // Fire 2 concurrent deduction requests against the exact same order
    const [res1A, res1B] = await Promise.all([
      deductOrderInventory(order1._id),
      deductOrderInventory(order1._id)
    ]);

    const updatedP1 = await Product.findById(p1._id);
    const updatedOrder1 = await Order.findById(order1._id);

    assert(res1A.success && res1B.success, 'Both concurrent calls returned success');
    assert(
      (res1A.alreadyDeducted && !res1B.alreadyDeducted) || (!res1A.alreadyDeducted && res1B.alreadyDeducted),
      'Exactly one caller performed deduction and the other observed alreadyDeducted / claimed state'
    );
    assert(updatedP1.stock === 7, `Product stock decremented exactly once (10 -> ${updatedP1.stock}, expected 7)`);
    assert(updatedOrder1.inventoryStatus === 'deducted', 'Order inventoryStatus transitioned to "deducted"');

    // -------------------------------------------------------------
    // Test 2: Payment verification and webhook arriving simultaneously
    // -------------------------------------------------------------
    console.log('\nTest 2: Payment verification and webhook arriving simultaneously for one order');
    const p2 = await createTestProduct(5);
    const order2 = await createTestOrder([{ _id: p2._id, quantity: 2 }]);

    const [verifyRes, webhookRes] = await Promise.all([
      deductOrderInventory(order2._id),
      deductOrderInventory(order2._id)
    ]);

    const updatedP2 = await Product.findById(p2._id);
    const updatedOrder2 = await Order.findById(order2._id);

    assert(verifyRes.success && webhookRes.success, 'Both verify and webhook succeeded');
    assert(updatedP2.stock === 3, `Stock decremented once from 5 to ${updatedP2.stock} (not twice)`);
    assert(updatedOrder2.inventoryStatus === 'deducted', 'Inventory status is "deducted"');

    // -------------------------------------------------------------
    // Test 3: Two simultaneous cancellation requests
    // -------------------------------------------------------------
    console.log('\nTest 3: Two simultaneous cancellation requests');
    const p3 = await createTestProduct(5);
    const order3 = await createTestOrder([{ _id: p3._id, quantity: 3 }], {
      inventoryStatus: 'deducted',
      itemInventoryState: 'deducted'
    });

    const [cancel1, cancel2] = await Promise.all([
      restoreOrderInventory(order3._id, 'cancellation_request_1'),
      restoreOrderInventory(order3._id, 'cancellation_request_2')
    ]);

    const updatedP3 = await Product.findById(p3._id);
    const updatedOrder3 = await Order.findById(order3._id);

    assert(cancel1.restored && cancel2.restored, 'Both cancellation calls resolved successfully');
    assert(
      (cancel1.alreadyRestored && !cancel2.alreadyRestored) || (!cancel1.alreadyRestored && cancel2.alreadyRestored),
      'Atomic claim prevented duplicate restoration execution'
    );
    assert(updatedP3.stock === 8, `Stock restored exactly once (5 -> ${updatedP3.stock}, expected 8)`);
    assert(updatedOrder3.inventoryStatus === 'restored', 'Order inventoryStatus is "restored"');

    // -------------------------------------------------------------
    // Test 4: Cancellation and refund arriving simultaneously
    // -------------------------------------------------------------
    console.log('\nTest 4: Cancellation and refund arriving simultaneously');
    const p4 = await createTestProduct(10);
    const order4 = await createTestOrder([{ _id: p4._id, quantity: 4 }], {
      inventoryStatus: 'deducted',
      itemInventoryState: 'deducted'
    });

    const [buyerCancel, adminRefund] = await Promise.all([
      restoreOrderInventory(order4._id, 'buyer_cancellation'),
      restoreOrderInventory(order4._id, 'admin_refund')
    ]);

    const updatedP4 = await Product.findById(p4._id);
    const updatedOrder4 = await Order.findById(order4._id);

    assert(buyerCancel.restored && adminRefund.restored, 'Both buyer cancel and admin refund resolved');
    assert(updatedP4.stock === 14, `Stock restored by 4 units exactly (10 -> ${updatedP4.stock}, expected 14)`);
    assert(updatedOrder4.inventoryStatus === 'restored', 'Final inventoryStatus is "restored"');

    // -------------------------------------------------------------
    // Test 5: Simulated failure after the first product deduction in a multi-product order
    // -------------------------------------------------------------
    console.log('\nTest 5: Simulated failure after the first product deduction in a multi-product order');
    const p5A = await createTestProduct(10);
    const p5B = await createTestProduct(0); // Product B out of stock!
    const order5 = await createTestOrder([
      { _id: p5A._id, quantity: 3 },
      { _id: p5B._id, quantity: 1 }
    ]);

    const deductRes5 = await deductOrderInventory(order5._id, { forceCompensation: true });
    const freshP5A = await Product.findById(p5A._id);
    const freshP5B = await Product.findById(p5B._id);
    const freshOrder5 = await Order.findById(order5._id);

    assert(deductRes5.success === false, 'Multi-product deduction rejected due to out-of-stock item');
    assert(freshP5A.stock === 10, `Product A stock safely rolled back to 10 (current: ${freshP5A.stock})`);
    assert(freshP5B.stock === 0, 'Product B stock remained 0');
    assert(freshOrder5.inventoryStatus === 'deduction_failed', 'Order status marked "deduction_failed"');
    assert(freshOrder5.products[0].inventoryState === 'rolled_back', 'First item marked "rolled_back" in DB');

    // -------------------------------------------------------------
    // Test 6: Recovery of an interrupted deduction (server crash midway)
    // -------------------------------------------------------------
    console.log('\nTest 6: Recovery of an interrupted deduction');
    const p6A = await createTestProduct(10);
    const p6B = await createTestProduct(10);
    const order6 = await createTestOrder([
      { _id: p6A._id, quantity: 4 },
      { _id: p6B._id, quantity: 2 }
    ]);

    let crashCaught = false;
    try {
      await deductOrderInventory(order6._id, {
        forceCompensation: true,
        simulateCrashAfterItemIndex: 0
      });
    } catch (err) {
      crashCaught = true;
    }

    assert(crashCaught, 'Simulated server crash occurred after deducting item 0');
    const crashedP6A = await Product.findById(p6A._id);
    const crashedOrder6 = await Order.findById(order6._id);
    assert(crashedP6A.stock === 6, 'Item 0 was deducted before crash (10 -> 6)');
    assert(crashedOrder6.inventoryStatus === 'deducting', 'Order left in "deducting" state');

    // Execute recovery
    const recoveryRes6 = await recoverInterruptedInventory(order6._id);
    const healedP6A = await Product.findById(p6A._id);
    const healedP6B = await Product.findById(p6B._id);
    const healedOrder6 = await Order.findById(order6._id);

    assert(recoveryRes6.recovered === true, 'Recovery executed successfully');
    assert(recoveryRes6.rolledBackCount === 1, 'Recovery identified exactly 1 item to roll back');
    assert(healedP6A.stock === 10, `Item 0 stock restored by recovery (6 -> ${healedP6A.stock})`);
    assert(healedP6B.stock === 10, 'Item 1 stock remained 10 (never deducted)');
    assert(healedOrder6.inventoryStatus === 'not_deducted', 'Order status returned to "not_deducted"');

    // Run recovery again to test idempotency
    const repeatRec6 = await recoverInterruptedInventory(order6._id);
    const p6AAfterRepeat = await Product.findById(p6A._id);
    assert(p6AAfterRepeat.stock === 10, 'Repeated recovery did not increment stock again');

    // -------------------------------------------------------------
    // Test 7: Simulated failure during multi-product stock restoration
    // -------------------------------------------------------------
    console.log('\nTest 7: Simulated failure during multi-product stock restoration');
    const p7A = await createTestProduct(5);
    const p7B = await createTestProduct(5);
    const order7 = await createTestOrder(
      [
        { _id: p7A._id, quantity: 2 },
        { _id: p7B._id, quantity: 3 }
      ],
      {
        inventoryStatus: 'deducted',
        itemInventoryState: 'deducted'
      }
    );

    let restoreCrash = false;
    try {
      await restoreOrderInventory(order7._id, 'simulated_failure', {
        simulateFailureDuringRestore: true,
        simulateFailureDuringRestoreIndex: 1
      });
    } catch (err) {
      restoreCrash = true;
    }

    assert(restoreCrash, 'Simulated crash occurred during restoration at item 1');
    const midP7A = await Product.findById(p7A._id);
    const midP7B = await Product.findById(p7B._id);
    const midOrder7 = await Order.findById(order7._id);

    assert(midP7A.stock === 7, `Item 0 was restored before crash (5 -> ${midP7A.stock})`);
    assert(midP7B.stock === 5, 'Item 1 was NOT yet restored (still 5)');
    assert(midOrder7.inventoryStatus === 'restoration_failed', 'Order marked "restoration_failed"');

    // -------------------------------------------------------------
    // Test 8: Recovery of an interrupted restoration
    // -------------------------------------------------------------
    console.log('\nTest 8: Recovery of an interrupted restoration');
    const recoveryRes8 = await recoverInterruptedInventory(order7._id);
    const healedP7A = await Product.findById(p7A._id);
    const healedP7B = await Product.findById(p7B._id);
    const healedOrder7 = await Order.findById(order7._id);

    assert(recoveryRes8.recovered === true, 'Recovery executed successfully for interrupted restoration');
    assert(recoveryRes8.restoredCount === 1, 'Recovery restored only the remaining unrestored item');
    assert(healedP7A.stock === 7, 'Item 0 was NOT restored a second time (remained 7)');
    assert(healedP7B.stock === 8, `Item 1 was successfully restored (5 -> ${healedP7B.stock})`);
    assert(healedOrder7.inventoryStatus === 'restored', 'Final order status is "restored"');

    // -------------------------------------------------------------
    // Test 9: Duplicate event arriving after successful completion
    // -------------------------------------------------------------
    console.log('\nTest 9: Duplicate event arriving after successful completion');
    const p9 = await createTestProduct(10);
    const order9 = await createTestOrder([{ _id: p9._id, quantity: 2 }]);

    // Initial deduction
    const firstDeduct = await deductOrderInventory(order9._id);
    assert(firstDeduct.success === true, 'First deduction succeeded');

    // Duplicate deduction call
    const dupDeduct = await deductOrderInventory(order9._id);
    const p9AfterDup = await Product.findById(p9._id);
    assert(dupDeduct.success === true && dupDeduct.alreadyDeducted === true, 'Duplicate deduction returned alreadyDeducted');
    assert(p9AfterDup.stock === 8, 'Product stock was not decremented again (remains 8)');

    // Initial restoration
    const firstRestore = await restoreOrderInventory(order9._id, 'cancellation');
    assert(firstRestore.restored === true, 'First restoration succeeded');

    // Duplicate restoration call
    const dupRestore = await restoreOrderInventory(order9._id, 'cancellation');
    const p9AfterDupRestore = await Product.findById(p9._id);
    assert(dupRestore.restored === true && dupRestore.alreadyRestored === true, 'Duplicate restoration returned alreadyRestored');
    assert(p9AfterDupRestore.stock === 10, 'Product stock was not incremented again (remains 10)');

    // -------------------------------------------------------------
    // Test 10: Captured payment with insufficient inventory, refund failure and retry behavior
    // -------------------------------------------------------------
    console.log('\nTest 10: Captured payment with insufficient inventory, refund failure and retry behavior');
    const p10 = await createTestProduct(0); // 0 stock
    const order10 = await createTestOrder([{ _id: p10._id, quantity: 2 }], {
      paymentStatus: 'paid',
      razorpayPaymentId: 'pay_sim_insufficient_stock'
    });

    // Attempt deduction (will fail)
    const deductRes10 = await deductOrderInventory(order10._id);
    assert(deductRes10.success === false, 'Deduction failed due to zero stock');

    // 1. Initial refund attempt fails due to invalid payment id / gateway error
    const failedRefundRes = await initiateOrderRefund(order10._id, {
      amount: order10.totalAmount,
      reason: 'Fulfillment failed'
    });
    const orderAfterFailedRefund = await Order.findById(order10._id);
    assert(failedRefundRes.success === false, 'Refund failure was correctly caught when gateway returned error');
    assert(orderAfterFailedRefund.refundStatus === 'failed', 'Order marked with refundStatus "failed"');
    assert(orderAfterFailedRefund.paymentStatus === 'paid', 'Order paymentStatus remains "paid" (not falsely marked refunded)');

    // 2. Retry behavior: admin or automated retry executes with valid refund response
    const retryRefundRes = await initiateOrderRefund(order10._id, {
      amount: order10.totalAmount,
      reason: 'Retry automated refund after stock failure',
      mockRefundResult: { id: `rfnd_retry_${Date.now()}`, status: 'processed' }
    });
    const orderAfterRetry = await Order.findById(order10._id);
    assert(retryRefundRes.success === true, 'Retry refund succeeded');
    assert(orderAfterRetry.refundStatus === 'completed', 'Order refundStatus transitioned to "completed"');
    assert(orderAfterRetry.paymentStatus === 'refunded', 'Order paymentStatus updated to "refunded" after confirmation');

    // 3. Duplicate refund prevention:
    const dupRefund = await initiateOrderRefund(order10._id);
    assert(dupRefund.alreadyRefunded === true, 'Duplicate refund prevented from sending second refund');

    // -------------------------------------------------------------
    // Test 11: Transactional Deductions (when Replica Set is active)
    // -------------------------------------------------------------
    console.log('\nTest 11: Multi-product deduction behavior under Replica Set transactions vs Compensation');
    const p11A = await createTestProduct(5);
    const p11B = await createTestProduct(5);
    const order11 = await createTestOrder([
      { _id: p11A._id, quantity: 2 },
      { _id: p11B._id, quantity: 2 }
    ]);

    const txDeduct = await deductOrderInventory(order11._id, { forceCompensation: false });
    const p11AFinal = await Product.findById(p11A._id);
    const p11BFinal = await Product.findById(p11B._id);
    assert(txDeduct.success === true, 'Order deduction succeeded');
    assert(p11AFinal.stock === 3 && p11BFinal.stock === 3, 'Both products deducted atomically');

  } catch (err) {
    console.error('Test suite error:', err);
    failedTests++;
  } finally {
    console.log('\nCleaning up test artifacts from MongoDB...');
    await cleanupTestData();
    await mongoose.disconnect();
    console.log('MongoDB disconnected.');
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

runTestSuite();
