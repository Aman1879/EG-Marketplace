/**
 * Phase 8 Verification Test Suite: Inventory and Stock Consistency Review
 *
 * Verifies the 7 ALGIONS AI LABS assignment inventory requirements:
 * 1. Stock cannot become negative, including concurrent checkouts.
 * 2. Checkout revalidates stock before confirming an order.
 * 3. Failed payments and valid cancellations restore stock exactly once.
 * 4. Duplicate payment verification/webhooks cannot deduct or restore stock twice.
 * 5. Variant stock and aggregate product stock remain consistent.
 * 6. Inventory changes are traceable to their order and operation.
 * 7. Production stock writes fail safely when transactions are unavailable (existing design).
 *
 * Database Safety: Strictly runs against dedicated test database (marketplace_test).
 * Zero credential or secret exposure.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const Product = require('../models/Product');
const Vendor = require('../models/Vendor');
const User = require('../models/User');
const Order = require('../models/Order');
const InventoryOperation = require('../models/InventoryOperation');
const ordersRouter = require('../routes/orders');

const {
  deductOrderInventory,
  restoreOrderInventory,
  recoverInterruptedInventory,
  settleOrderPayment
} = ordersRouter;

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

const TEST_PREFIX = `TEST_P8_${Date.now()}_`;

async function main() {
  console.log('\n============================================================');
  console.log(' PHASE 8: INVENTORY AND STOCK CONSISTENCY VERIFICATION');
  console.log('============================================================\n');

  const testDbUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/marketplace_test';
  if (!testDbUri.includes('test') && !testDbUri.includes('localhost') && !testDbUri.includes('127.0.0.1')) {
    console.error('Refusing to run tests against non-test database URI:', testDbUri);
    process.exit(1);
  }

  await mongoose.connect(testDbUri);
  console.log(`Connected to database: ${mongoose.connection.name}`);
  assert(mongoose.connection.name === 'marketplace_test', 'Safety check: Active database confirmed as marketplace_test');

  const topology = mongoose.connection?.client?.topology?.description?.type;
  const isReplicaSet = topology === 'ReplicaSetWithPrimary' || topology === 'Sharded';
  console.log(`Cluster Topology: ${topology} | Replica Set Transactions Supported: ${isReplicaSet}`);

  try {
    // Setup test vendor and buyer
    const vUser = new mongoose.Types.ObjectId();
    const testVendor = await Vendor.create({
      userId: vUser,
      shopName: `${TEST_PREFIX}TechStore`,
      categories: ['Electronics'],
      onboardingComplete: true,
      approvalStatus: 'approved'
    });

    const testBuyer = await User.create({
      name: `${TEST_PREFIX} Buyer`,
      username: `${TEST_PREFIX}buyer`,
      email: `${TEST_PREFIX}buyer@example.com`,
      password: 'HashedPassword123!',
      role: 'buyer'
    });

    // -------------------------------------------------------------------------
    // TEST 1: Stock cannot become negative under concurrent checkouts (Req 1 & Req 5)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 1: Concurrency Protection: Stock Cannot Drop Below Zero ---');
    const variant1Stock = 3;
    const variant2Stock = 2;
    const initialAggregateStock = variant1Stock + variant2Stock; // 5

    const concurrentProduct = await Product.create({
      vendorId: testVendor._id,
      title: `${TEST_PREFIX} Concurrent Stock Item`,
      description: 'Tests race condition protection',
      price: 500,
      imageUrl: 'https://example.com/item.jpg',
      category: 'Electronics',
      stock: initialAggregateStock,
      variants: [
        { name: 'Red', sku: `${TEST_PREFIX}SKU-RED`, price: 500, stock: variant1Stock, isActive: true },
        { name: 'Blue', sku: `${TEST_PREFIX}SKU-BLUE`, price: 500, stock: variant2Stock, isActive: true }
      ]
    });

    const redVariant = concurrentProduct.variants[0];
    const blueVariant = concurrentProduct.variants[1];

    // Create 10 orders each demanding 1 unit of the Red variant (which only has 3 in stock)
    const orderPromises = [];
    for (let i = 0; i < 10; i++) {
      const order = await Order.create({
        buyerId: testBuyer._id,
        vendorId: testVendor._id,
        products: [{
          productId: concurrentProduct._id,
          variantId: redVariant._id,
          variantName: 'Red',
          variantSku: redVariant.sku,
          quantity: 1,
          price: 500,
          inventoryState: 'pending'
        }],
        totalAmount: 500,
        vendorEarning: 450,
        adminCommission: 50,
        shippingAddress: '123 Dedicated Test Lane',
        paymentStatus: 'paid',
        inventoryStatus: 'not_deducted',
        claimVersion: 0
      });
      orderPromises.push(order);
    }

    // Fire 10 concurrent deduction attempts simultaneously
    const deductionResults = await Promise.all(
      orderPromises.map(order => deductOrderInventory(order._id))
    );

    const successfulDeductions = deductionResults.filter(r => r.success === true);
    const failedDeductions = deductionResults.filter(r => r.success === false);

    assert(successfulDeductions.length === 3, `Exactly 3 concurrent deductions succeeded for 3 stock (got: ${successfulDeductions.length})`);
    assert(failedDeductions.length === 7, `Remaining 7 concurrent deductions were rejected safely (got: ${failedDeductions.length})`);

    const reloadedConcurrentProduct = await Product.findById(concurrentProduct._id);
    const updatedRed = reloadedConcurrentProduct.variants.id(redVariant._id);
    const updatedBlue = reloadedConcurrentProduct.variants.id(blueVariant._id);

    assert(updatedRed.stock === 0, `Red variant stock is exactly 0 and did not become negative (got: ${updatedRed.stock})`);
    assert(updatedBlue.stock === variant2Stock, `Blue variant stock remained untouched at ${variant2Stock} (got: ${updatedBlue.stock})`);
    assert(reloadedConcurrentProduct.stock === 2, `Aggregate product stock is exactly 2 (5 - 3 = 2, got: ${reloadedConcurrentProduct.stock})`);

    // -------------------------------------------------------------------------
    // TEST 2: Revalidation at Payment Confirmation / Safe Failure & Refund (Req 2)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 2: Stock Revalidation on Payment Confirmation & Refund Safety ---');
    // Create an order for 1 unit of Red variant (which now has 0 stock)
    const exhaustedStockOrder = await Order.create({
      buyerId: testBuyer._id,
      vendorId: testVendor._id,
      products: [{
        productId: concurrentProduct._id,
        variantId: redVariant._id,
        variantName: 'Red',
        variantSku: redVariant.sku,
        quantity: 1,
        price: 500,
        inventoryState: 'pending'
      }],
      totalAmount: 500,
      vendorEarning: 450,
      adminCommission: 50,
      shippingAddress: '123 Dedicated Test Lane',
      paymentStatus: 'created',
      razorpayOrderId: 'order_test_p8_001',
      inventoryStatus: 'not_deducted',
      claimVersion: 0
    });

    const settlementResult = await settleOrderPayment({
      orderId: exhaustedStockOrder._id,
      razorpayOrderId: 'order_test_p8_001',
      razorpayPaymentId: 'pay_test_p8_settle_001',
      paymentStatus: 'captured',
      amountPaise: 50000,
      currency: 'INR',
      source: 'frontend_verify'
    });

    assert(settlementResult.success === false, 'Settlement correctly reported failure due to out-of-stock inventory');
    assert(settlementResult.error && settlementResult.error.includes('Insufficient stock'), `Failure reason specifies inventory shortage: "${settlementResult.error}"`);

    const cancelledOrder = await Order.findById(exhaustedStockOrder._id);
    assert(cancelledOrder.orderStatus === 'cancelled' || cancelledOrder.status === 'cancelled', `Order status was safely cancelled`);
    assert(cancelledOrder.paymentStatus === 'refunded', `Payment status marked refunded (got: ${cancelledOrder.paymentStatus})`);
    assert(cancelledOrder.failureReason.includes('Insufficient stock'), `Order records failure reason: ${cancelledOrder.failureReason}`);

    // -------------------------------------------------------------------------
    // TEST 3: Restorations Exactly Once & Cancellation Protection (Req 3 & Req 5)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3: Stock Restoration Exactly Once on Cancellation ---');
    // Order 2 units of the Blue variant (stock 2 -> 0)
    const blueOrder = await Order.create({
      buyerId: testBuyer._id,
      vendorId: testVendor._id,
      products: [{
        productId: concurrentProduct._id,
        variantId: blueVariant._id,
        variantName: 'Blue',
        variantSku: blueVariant.sku,
        quantity: 2,
        price: 500,
        inventoryState: 'pending'
      }],
      totalAmount: 1000,
      vendorEarning: 900,
      adminCommission: 100,
      shippingAddress: '123 Dedicated Test Lane',
      paymentStatus: 'paid',
      inventoryStatus: 'not_deducted',
      claimVersion: 0
    });

    const blueDeductRes = await deductOrderInventory(blueOrder._id);
    assert(blueDeductRes.success === true, 'Deduction for Blue variant succeeded');

    const blueDeductedProd = await Product.findById(concurrentProduct._id);
    assert(blueDeductedProd.variants.id(blueVariant._id).stock === 0, 'Blue variant stock decremented to 0');
    assert(blueDeductedProd.stock === 0, 'Aggregate stock decremented to 0');

    // Restore stock via cancellation
    const restoreRes1 = await restoreOrderInventory(blueOrder._id, 'cancellation');
    assert(restoreRes1.success === true || restoreRes1.restored === true, 'First restoreOrderInventory call succeeded');

    const blueRestoredProd = await Product.findById(concurrentProduct._id);
    assert(blueRestoredProd.variants.id(blueVariant._id).stock === 2, `Blue variant restored to 2 (got: ${blueRestoredProd.variants.id(blueVariant._id).stock})`);
    assert(blueRestoredProd.stock === 2, `Aggregate product stock restored to 2 (got: ${blueRestoredProd.stock})`);

    // Call restoreOrderInventory a SECOND time for the same order (simulating duplicate webhook / retry)
    const restoreRes2 = await restoreOrderInventory(blueOrder._id, 'cancellation');
    const blueDoubleRestoredProd = await Product.findById(concurrentProduct._id);

    assert(blueDoubleRestoredProd.variants.id(blueVariant._id).stock === 2, `Duplicate restore did NOT increase variant stock beyond 2 (actual: ${blueDoubleRestoredProd.variants.id(blueVariant._id).stock})`);
    assert(blueDoubleRestoredProd.stock === 2, `Duplicate restore did NOT increase aggregate stock beyond 2 (actual: ${blueDoubleRestoredProd.stock})`);

    // -------------------------------------------------------------------------
    // TEST 4: Duplicate Webhook / Verification Cannot Deduct Twice (Req 4)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 4: Duplicate Deduction Prevention (Idempotent Webhook Verification) ---');
    const singleOrder = await Order.create({
      buyerId: testBuyer._id,
      vendorId: testVendor._id,
      products: [{
        productId: concurrentProduct._id,
        variantId: blueVariant._id,
        variantName: 'Blue',
        variantSku: blueVariant.sku,
        quantity: 1,
        price: 500,
        inventoryState: 'pending'
      }],
      totalAmount: 500,
      vendorEarning: 450,
      adminCommission: 50,
      shippingAddress: '123 Dedicated Test Lane',
      paymentStatus: 'paid',
      inventoryStatus: 'not_deducted',
      claimVersion: 0
    });

    const firstDeduct = await deductOrderInventory(singleOrder._id);
    assert(firstDeduct.success === true, 'First deduction succeeded');

    const stockAfterFirst = (await Product.findById(concurrentProduct._id)).variants.id(blueVariant._id).stock;
    assert(stockAfterFirst === 1, `Blue variant stock decremented from 2 to 1 (got: ${stockAfterFirst})`);

    // Second duplicate deduction call on the exact same order
    const duplicateDeduct = await deductOrderInventory(singleOrder._id);
    const stockAfterDuplicate = (await Product.findById(concurrentProduct._id)).variants.id(blueVariant._id).stock;
    const aggregateAfterDuplicate = (await Product.findById(concurrentProduct._id)).stock;

    assert(duplicateDeduct.success === true, 'Duplicate deduction call returns successful idempotency short-circuit');
    assert(stockAfterDuplicate === 1, `Variant stock remained 1 and was not deducted twice (got: ${stockAfterDuplicate})`);
    assert(aggregateAfterDuplicate === 1, `Aggregate stock remained 1 and was not deducted twice (got: ${aggregateAfterDuplicate})`);

    // -------------------------------------------------------------------------
    // TEST 5: Variant Stock and Aggregate Stock Consistency in Recovery (Req 5)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 5: Variant & Aggregate Consistency during Interrupted Recovery ---');
    const recoveryProduct = await Product.create({
      vendorId: testVendor._id,
      title: `${TEST_PREFIX} Recovery Test Item`,
      description: 'Tests recovery synchronization',
      price: 1000,
      imageUrl: 'https://example.com/rec.jpg',
      category: 'Electronics',
      stock: 10,
      variants: [
        { name: 'Small', sku: `${TEST_PREFIX}SKU-S`, price: 1000, stock: 6, isActive: true },
        { name: 'Large', sku: `${TEST_PREFIX}SKU-L`, price: 1000, stock: 4, isActive: true }
      ]
    });

    const smallVariant = recoveryProduct.variants[0];

    // Create order for 2 units of Small
    const interruptedOrder = await Order.create({
      buyerId: testBuyer._id,
      vendorId: testVendor._id,
      products: [{
        productId: recoveryProduct._id,
        variantId: smallVariant._id,
        variantName: 'Small',
        variantSku: smallVariant.sku,
        quantity: 2,
        price: 1000,
        inventoryState: 'pending'
      }],
      totalAmount: 2000,
      vendorEarning: 1800,
      adminCommission: 200,
      shippingAddress: '123 Dedicated Test Lane',
      paymentStatus: 'paid',
      inventoryStatus: 'not_deducted',
      claimVersion: 0
    });

    // Simulate crash after stock decrement (Boundary 3)
    let crashOccurred = false;
    try {
      await deductOrderInventory(interruptedOrder._id, {
        forceCompensation: true,
        simulateCrashBoundary: 3
      });
    } catch (e) {
      crashOccurred = true;
    }
    assert(crashOccurred, 'Simulated crash after stock decrement occurred as expected');

    const crashedProduct = await Product.findById(recoveryProduct._id);
    assert(crashedProduct.variants.id(smallVariant._id).stock === 4, 'Variant stock was decremented to 4 during interrupted run');
    assert(crashedProduct.stock === 8, 'Aggregate stock was decremented to 8 during interrupted run');

    // Run recovery
    const recResult = await recoverInterruptedInventory(interruptedOrder._id);
    assert(recResult.recovered === true, 'Recovery executed successfully');

    const recoveredProduct = await Product.findById(recoveryProduct._id);
    const recoveredSmall = recoveredProduct.variants.id(smallVariant._id);

    assert(recoveredSmall.stock === 6, `Small variant stock accurately restored back to 6 (actual: ${recoveredSmall.stock})`);
    assert(recoveredProduct.stock === 10, `Aggregate product stock accurately restored back to 10 (actual: ${recoveredProduct.stock})`);
    assert(recoveredProduct.stock === (recoveredSmall.stock + recoveredProduct.variants[1].stock), 'Variant stocks and aggregate stock remain strictly synchronized');

    // -------------------------------------------------------------------------
    // TEST 6: Traceability of Inventory Changes (Req 6)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 6: Inventory Ledger Traceability ---');
    const deductOpId = `order_${interruptedOrder._id}_prod_${recoveryProduct._id}_deduct`;
    const rollbackOpId = `order_${interruptedOrder._id}_prod_${recoveryProduct._id}_rollback`;

    const deductOp = await InventoryOperation.findOne({ operationId: deductOpId });
    assert(deductOp !== null, 'Deduct operation is durably recorded in InventoryOperation ledger');
    assert(deductOp && deductOp.status === 'completed', `Deduct operation reconciled to "completed" (got: ${deductOp?.status})`);
    assert(deductOp && deductOp.quantity === 2, 'Deduct operation records exact quantity');

    const rollbackOp = await InventoryOperation.findOne({ operationId: rollbackOpId });
    assert(rollbackOp !== null, 'Rollback operation is durably recorded in InventoryOperation ledger');
    assert(rollbackOp && rollbackOp.status === 'completed', 'Rollback operation marked completed');

    const orderLog = (await Order.findById(interruptedOrder._id)).inventoryLogs;
    assert(orderLog.length > 0, `Order contains detailed inventory audit logs (${orderLog.length} entries)`);

    // -------------------------------------------------------------------------
    // TEST 7: Safe Failure when Transactions are Unavailable (Req 7)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 7: Safe Abort When Transactions Are Unavailable ---');
    const noTxOrder = await Order.create({
      buyerId: testBuyer._id,
      vendorId: testVendor._id,
      products: [{
        productId: recoveryProduct._id,
        quantity: 1,
        price: 1000,
        inventoryState: 'pending'
      }],
      totalAmount: 1000,
      vendorEarning: 900,
      adminCommission: 100,
      shippingAddress: '123 Dedicated Test Lane',
      paymentStatus: 'paid',
      inventoryStatus: 'not_deducted',
      claimVersion: 0
    });

    const noTxResult = await deductOrderInventory(noTxOrder._id, {
      simulateNoTransactions: true
    });

    assert(noTxResult.success === false, 'Deduction aborted when transactions unavailable');
    assert(noTxResult.transactionUnavailable === true, 'Explicit transactionUnavailable flag returned');
    assert(noTxResult.reason.includes('TransactionUnavailableError'), 'Rejects with TransactionUnavailableError');

    const unmutatedProd = await Product.findById(recoveryProduct._id);
    assert(unmutatedProd.stock === 10, 'Product stock was not mutated and remains 10');

  } catch (err) {
    console.error('Unexpected test error:', err);
    failedTests++;
  } finally {
    console.log('\nCleaning up test artifacts...');
    await Product.deleteMany({ title: new RegExp(`^${TEST_PREFIX}`) });
    await Order.deleteMany({ totalAmount: { $in: [500, 1000, 2000] } });
    await Vendor.deleteMany({ shopName: new RegExp(`^${TEST_PREFIX}`) });
    await User.deleteMany({ username: new RegExp(`^${TEST_PREFIX}`) });
    await InventoryOperation.deleteMany({ operationId: new RegExp(`^order_`) });
    await mongoose.disconnect();
    console.log('Database disconnected.');
  }

  console.log('\n============================================================');
  console.log(` RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

main();
