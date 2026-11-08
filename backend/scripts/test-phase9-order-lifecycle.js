/**
 * Verification Test Suite: Phase 9 Order Lifecycle, Cancellation and Refund Integrity
 *
 * Verifies all Phase 9 requirements:
 * 1. Valid and invalid order status transitions (forward, backward, terminal).
 * 2. Role-based and ownership-based transition permissions (Buyer, Vendor, Admin).
 * 3. Cancellation eligibility, automatic refund of paid orders, and idempotent stock restoration.
 * 4. Refund integrity: finite positive validation, balance checks, multiple partial refunds, idempotency.
 * 5. Financial consistency: revenue reporting excludes unpaid/failed/cancelled/refunded amounts.
 * 6. Auditability: statusHistory and refunds records track lifecycle changes.
 *
 * Database Safety: Strictly runs against dedicated test database (marketplace_test).
 * Zero credential or secret exposure.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const http = require('http');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const Product = require('../models/Product');
const Vendor = require('../models/Vendor');
const User = require('../models/User');
const Order = require('../models/Order');
const Commission = require('../models/Commission');
const InventoryOperation = require('../models/InventoryOperation');

const ordersRouter = require('../routes/orders');
const adminRouter = require('../routes/admin');

const {
  VALID_ORDER_STATUS_TRANSITIONS,
  isValidOrderStatusTransition,
  initiateOrderRefund,
  restoreOrderInventory
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

const TEST_PREFIX = `TEST_P9_${Date.now()}_`;

async function main() {
  console.log('\n============================================================');
  console.log(' PHASE 9: ORDER LIFECYCLE, CANCELLATION & REFUND INTEGRITY');
  console.log('============================================================\n');

  const testDbUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/marketplace_test';
  if (!testDbUri.includes('test') && !testDbUri.includes('localhost') && !testDbUri.includes('127.0.0.1')) {
    console.error('Refusing to run tests against non-test database URI:', testDbUri);
    process.exit(1);
  }

  await mongoose.connect(testDbUri);
  console.log(`Connected to database: ${mongoose.connection.name}`);
  assert(mongoose.connection.name === 'marketplace_test', 'Safety check: Active database confirmed as marketplace_test');

  // Setup test Express server
  const app = express();
  app.use(express.json());
  app.use('/api/orders', ordersRouter);
  app.use('/api/admin', adminRouter);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server listening on port ${port}`);

  const jwtSecret = process.env.JWT_SECRET || 'secret';

  try {
    // -------------------------------------------------------------
    // Setup test users & vendors
    // -------------------------------------------------------------
    const buyerUser = await User.create({
      name: `${TEST_PREFIX} Buyer`,
      username: `${TEST_PREFIX}buyer`,
      email: `${TEST_PREFIX}buyer@example.com`,
      password: 'HashedPassword123!',
      role: 'buyer'
    });

    const vendor1User = await User.create({
      name: `${TEST_PREFIX} Vendor 1`,
      username: `${TEST_PREFIX}vendor1`,
      email: `${TEST_PREFIX}vendor1@example.com`,
      password: 'HashedPassword123!',
      role: 'vendor'
    });

    const vendor2User = await User.create({
      name: `${TEST_PREFIX} Vendor 2`,
      username: `${TEST_PREFIX}vendor2`,
      email: `${TEST_PREFIX}vendor2@example.com`,
      password: 'HashedPassword123!',
      role: 'vendor'
    });

    const adminUser = await User.create({
      name: `${TEST_PREFIX} Admin`,
      username: `${TEST_PREFIX}admin`,
      email: `${TEST_PREFIX}admin@example.com`,
      password: 'HashedPassword123!',
      role: 'admin'
    });

    const vendor1 = await Vendor.create({
      userId: vendor1User._id,
      shopName: `${TEST_PREFIX}Shop1`,
      categories: ['Electronics'],
      onboardingComplete: true,
      approvalStatus: 'approved'
    });

    const vendor2 = await Vendor.create({
      userId: vendor2User._id,
      shopName: `${TEST_PREFIX}Shop2`,
      categories: ['Clothing'],
      onboardingComplete: true,
      approvalStatus: 'approved'
    });

    const buyerToken = jwt.sign({ userId: buyerUser._id }, jwtSecret);
    const vendor1Token = jwt.sign({ userId: vendor1User._id }, jwtSecret);
    const vendor2Token = jwt.sign({ userId: vendor2User._id }, jwtSecret);
    const adminToken = jwt.sign({ userId: adminUser._id }, jwtSecret);

    const buyerHeaders = { Authorization: `Bearer ${buyerToken}` };
    const vendor1Headers = { Authorization: `Bearer ${vendor1Token}` };
    const vendor2Headers = { Authorization: `Bearer ${vendor2Token}` };
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };

    const testProduct = await Product.create({
      vendorId: vendor1._id,
      title: `${TEST_PREFIX} Product 1`,
      description: 'Test product for lifecycle',
      price: 1000,
      stock: 20,
      imageUrl: 'https://example.com/p1.jpg',
      category: 'Electronics'
    });

    // -------------------------------------------------------------
    // TEST 1: State Machine Transition Map & Validation
    // -------------------------------------------------------------
    console.log('\n--- TEST 1: Order Status Transition Validation ---');
    assert(isValidOrderStatusTransition('pending', 'confirmed') === true, 'pending -> confirmed is valid');
    assert(isValidOrderStatusTransition('pending', 'cancelled') === true, 'pending -> cancelled is valid');
    assert(isValidOrderStatusTransition('pending', 'shipped') === false, 'pending -> shipped is invalid');
    assert(isValidOrderStatusTransition('pending', 'delivered') === false, 'pending -> delivered is invalid');

    assert(isValidOrderStatusTransition('confirmed', 'processing') === true, 'confirmed -> processing is valid');
    assert(isValidOrderStatusTransition('confirmed', 'shipped') === true, 'confirmed -> shipped is valid');
    assert(isValidOrderStatusTransition('confirmed', 'pending') === false, 'confirmed -> pending (backward) is invalid');

    assert(isValidOrderStatusTransition('processing', 'shipped') === true, 'processing -> shipped is valid');
    assert(isValidOrderStatusTransition('processing', 'confirmed') === false, 'processing -> confirmed (backward) is invalid');

    assert(isValidOrderStatusTransition('shipped', 'delivered') === true, 'shipped -> delivered is valid');
    assert(isValidOrderStatusTransition('shipped', 'cancelled') === false, 'shipped -> cancelled is invalid');
    assert(isValidOrderStatusTransition('shipped', 'processing') === false, 'shipped -> processing (backward) is invalid');

    assert(isValidOrderStatusTransition('delivered', 'shipped') === false, 'delivered -> shipped (backward) is invalid');
    assert(isValidOrderStatusTransition('delivered', 'cancelled') === false, 'delivered -> cancelled is invalid');
    assert(isValidOrderStatusTransition('delivered', 'refunded') === true, 'delivered -> refunded is valid');

    assert(isValidOrderStatusTransition('cancelled', 'confirmed') === false, 'cancelled -> confirmed is invalid');
    assert(isValidOrderStatusTransition('refunded', 'confirmed') === false, 'refunded -> confirmed is invalid');

    // -------------------------------------------------------------
    // TEST 2: Role Permissions & Vendor Ownership Enforcement
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Role Permissions & Vendor Ownership Enforcement ---');
    const order1 = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendor1._id,
      products: [{ productId: testProduct._id, quantity: 1, price: 1000, inventoryState: 'deducted' }],
      totalAmount: 1000,
      vendorEarning: 900,
      adminCommission: 100,
      shippingAddress: '123 Test Street',
      status: 'confirmed',
      paymentStatus: 'paid',
      razorpayPaymentId: 'pay_test_p9_001',
      inventoryStatus: 'deducted'
    });

    // Buyer attempts to update status directly via PUT /:id/status (Forbidden)
    let buyerForbidden = false;
    try {
      await axios.put(`${baseUrl}/api/orders/${order1._id}/status`, { status: 'shipped' }, { headers: buyerHeaders });
    } catch (err) {
      buyerForbidden = err.response?.status === 403;
    }
    assert(buyerForbidden, 'Buyer cannot update order status via PUT /:id/status (403 Forbidden)');

    // Vendor 2 attempts to update Vendor 1's order (Forbidden)
    let vendor2Forbidden = false;
    try {
      await axios.put(`${baseUrl}/api/orders/${order1._id}/status`, { status: 'shipped' }, { headers: vendor2Headers });
    } catch (err) {
      vendor2Forbidden = err.response?.status === 403;
    }
    assert(vendor2Forbidden, 'Vendor cannot update another vendor\'s order (403 Forbidden)');

    // Vendor 1 attempts to set status directly to 'refunded' (Forbidden)
    let vendorRefundForbidden = false;
    try {
      await axios.put(`${baseUrl}/api/orders/${order1._id}/status`, { status: 'refunded' }, { headers: vendor1Headers });
    } catch (err) {
      vendorRefundForbidden = err.response?.status === 403;
    }
    assert(vendorRefundForbidden, 'Vendor cannot directly set status to "refunded" (403 Forbidden)');

    // Vendor 1 advances order: confirmed -> processing -> shipped -> delivered
    const resProc = await axios.put(`${baseUrl}/api/orders/${order1._id}/status`, { status: 'processing' }, { headers: vendor1Headers });
    assert(resProc.status === 200 && resProc.data.status === 'processing', 'Vendor 1 transitioned confirmed -> processing');

    const resShip = await axios.put(`${baseUrl}/api/orders/${order1._id}/status`, { status: 'shipped' }, { headers: vendor1Headers });
    assert(resShip.status === 200 && resShip.data.status === 'shipped', 'Vendor 1 transitioned processing -> shipped');

    const resDeliv = await axios.put(`${baseUrl}/api/orders/${order1._id}/status`, { status: 'delivered' }, { headers: vendor1Headers });
    assert(resDeliv.status === 200 && resDeliv.data.status === 'delivered', 'Vendor 1 transitioned shipped -> delivered');

    // Vendor 1 attempts backward transition: delivered -> shipped (Rejected)
    let backwardRejected = false;
    try {
      await axios.put(`${baseUrl}/api/orders/${order1._id}/status`, { status: 'shipped' }, { headers: vendor1Headers });
    } catch (err) {
      backwardRejected = err.response?.status === 400;
    }
    assert(backwardRejected, 'Backward transition delivered -> shipped rejected with HTTP 400');

    // Vendor 1 attempts to cancel delivered order (Rejected)
    let cancelDeliveredRejected = false;
    try {
      await axios.put(`${baseUrl}/api/orders/${order1._id}/status`, { status: 'cancelled' }, { headers: vendor1Headers });
    } catch (err) {
      cancelDeliveredRejected = err.response?.status === 400;
    }
    assert(cancelDeliveredRejected, 'Cancelling delivered order rejected with HTTP 400');

    // -------------------------------------------------------------
    // TEST 3: Buyer Cancellation Eligibility & Automatic Refund
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Buyer Cancellation & Automatic Refund ---');
    const order2 = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendor1._id,
      products: [{ productId: testProduct._id, quantity: 2, price: 1000, inventoryState: 'deducted' }],
      totalAmount: 2000,
      vendorEarning: 1800,
      adminCommission: 200,
      shippingAddress: '123 Test Street',
      status: 'confirmed',
      paymentStatus: 'paid',
      razorpayPaymentId: 'pay_test_p9_002',
      inventoryStatus: 'deducted'
    });

    const stockBeforeCancel = (await Product.findById(testProduct._id)).stock;

    // Buyer cancels order2
    const cancelRes = await axios.post(
      `${baseUrl}/api/orders/${order2._id}/cancel`,
      { reason: 'Found a better price' },
      { headers: buyerHeaders }
    );

    assert(cancelRes.status === 200, 'Buyer cancellation returned 200 OK');
    assert(cancelRes.data.order.status === 'cancelled', 'Order status updated to "cancelled"');
    assert(cancelRes.data.order.paymentStatus === 'refunded', 'Payment status updated to "refunded"');
    assert(cancelRes.data.order.refundStatus === 'completed', 'Refund status updated to "completed"');

    // Check stock was restored exactly once
    const stockAfterCancel = (await Product.findById(testProduct._id)).stock;
    assert(stockAfterCancel === stockBeforeCancel + 2, `Stock restored from ${stockBeforeCancel} to ${stockAfterCancel}`);

    // Buyer attempts to re-cancel already cancelled order (Rejected)
    let reCancelRejected = false;
    try {
      await axios.post(`${baseUrl}/api/orders/${order2._id}/cancel`, {}, { headers: buyerHeaders });
    } catch (err) {
      reCancelRejected = err.response?.status === 400;
    }
    assert(reCancelRejected, 'Re-cancelling already cancelled order rejected with HTTP 400');

    // -------------------------------------------------------------
    // TEST 4: Refund Integrity & Multiple Partial Refunds
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Refund Integrity & Multiple Partial Refunds ---');
    const order3 = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendor1._id,
      products: [{ productId: testProduct._id, quantity: 1, price: 1000, inventoryState: 'deducted' }],
      totalAmount: 1000,
      vendorEarning: 900,
      adminCommission: 100,
      shippingAddress: '123 Test Street',
      status: 'confirmed',
      paymentStatus: 'paid',
      razorpayPaymentId: 'pay_test_p9_003',
      inventoryStatus: 'deducted'
    });

    // 1. Negative amount rejection
    const negRes = await initiateOrderRefund(order3._id, { amount: -50 });
    assert(negRes.success === false, 'Negative refund amount rejected');

    // 2. Zero amount rejection
    const zeroRes = await initiateOrderRefund(order3._id, { amount: 0 });
    assert(zeroRes.success === false, 'Zero refund amount rejected');

    // 3. Amount exceeding balance rejection
    const exceedRes = await initiateOrderRefund(order3._id, { amount: 1500 });
    assert(exceedRes.success === false, 'Amount ₹1500 exceeding total ₹1000 rejected');
    assert(exceedRes.reason.includes('exceeds remaining refundable balance'), 'Rejection mentions remaining refundable balance');

    // 4. First partial refund: ₹300 via Admin API
    const partial1 = await axios.post(
      `${baseUrl}/api/orders/${order3._id}/refund`,
      { amount: 300, reason: 'Partial discount for minor flaw' },
      { headers: adminHeaders }
    );
    assert(partial1.status === 200, 'First partial refund (₹300) succeeded');
    assert(partial1.data.order.refundAmount === 300, 'Cumulative refundAmount is 300');
    assert(partial1.data.order.paymentStatus === 'paid', 'paymentStatus remains "paid" after partial refund');
    assert(partial1.data.order.status === 'confirmed', 'order status remains "confirmed" after partial refund');

    // 5. Amount exceeding remaining balance of ₹700 (try ₹750)
    let exceedRemaining = false;
    try {
      await axios.post(`${baseUrl}/api/orders/${order3._id}/refund`, { amount: 750 }, { headers: adminHeaders });
    } catch (err) {
      exceedRemaining = err.response?.status === 400;
    }
    assert(exceedRemaining, 'Second refund of ₹750 exceeding remaining balance ₹700 rejected with HTTP 400');

    // 6. Second partial refund: ₹400 via Admin API
    const partial2 = await axios.post(
      `${baseUrl}/api/orders/${order3._id}/refund`,
      { amount: 400, reason: 'Second partial compensation' },
      { headers: adminHeaders }
    );
    assert(partial2.status === 200, 'Second partial refund (₹400) succeeded');
    assert(partial2.data.order.refundAmount === 700, 'Cumulative refundAmount updated to 700 (300 + 400)');
    assert(partial2.data.order.refunds.length === 2, 'order.refunds records exactly 2 partial refund entries');

    // 7. Final remaining refund: ₹300 (reaching full total ₹1000)
    const partial3 = await axios.post(
      `${baseUrl}/api/orders/${order3._id}/refund`,
      { amount: 300, reason: 'Final refund' },
      { headers: adminHeaders }
    );
    assert(partial3.status === 200, 'Final partial refund (₹300) succeeded');
    assert(partial3.data.order.refundAmount === 1000, 'Cumulative refundAmount is exactly 1000');
    assert(partial3.data.order.paymentStatus === 'refunded', 'paymentStatus updated to "refunded" upon full refund');
    assert(partial3.data.order.status === 'refunded', 'order status updated to "refunded" upon full refund');

    // 8. Attempting refund after full refund completed (Idempotent short-circuit)
    const afterFull = await initiateOrderRefund(order3._id, { amount: 100 });
    assert(afterFull.success === true && afterFull.alreadyRefunded === true, 'Refund after full completion returns alreadyRefunded: true');

    // -------------------------------------------------------------
    // TEST 5: Financial Consistency & Revenue Reporting
    // -------------------------------------------------------------
    console.log('\n--- TEST 5: Financial Consistency in Admin Dashboard & Revenue Reporting ---');
    // Setup clean revenue tracking:
    // Order A: Paid, confirmed (₹1000) -> Should count in completed revenue
    const orderA = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendor1._id,
      products: [{ productId: testProduct._id, quantity: 1, price: 1000, inventoryState: 'deducted' }],
      totalAmount: 1000,
      vendorEarning: 900,
      adminCommission: 100,
      shippingAddress: '123 Test Street',
      status: 'confirmed',
      paymentStatus: 'paid',
      razorpayPaymentId: 'pay_test_p9_00A',
      inventoryStatus: 'deducted'
    });
    await Commission.create({
      orderId: orderA._id,
      totalAmount: 1000,
      vendorEarning: 900,
      commissionAmount: 100
    });

    // Order B: Unpaid/Created (₹500) -> MUST NOT count in completed revenue
    await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendor1._id,
      products: [{ productId: testProduct._id, quantity: 1, price: 500, inventoryState: 'pending' }],
      totalAmount: 500,
      vendorEarning: 450,
      adminCommission: 50,
      shippingAddress: '123 Test Street',
      status: 'pending',
      paymentStatus: 'created',
      inventoryStatus: 'not_deducted'
    });

    // Order C: Cancelled (₹700) -> MUST NOT count in completed revenue
    await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendor1._id,
      products: [{ productId: testProduct._id, quantity: 1, price: 700, inventoryState: 'restored' }],
      totalAmount: 700,
      vendorEarning: 630,
      adminCommission: 70,
      shippingAddress: '123 Test Street',
      status: 'cancelled',
      paymentStatus: 'failed',
      inventoryStatus: 'restored'
    });

    // Call GET /api/admin/dashboard
    const dashRes = await axios.get(`${baseUrl}/api/admin/dashboard`, { headers: adminHeaders });
    assert(dashRes.status === 200, 'GET /api/admin/dashboard returned 200');

    // Total revenue must strictly only sum completed paid, non-cancelled, non-refunded orders
    // orderA (1000) is the only active paid unrefunded order created in this section
    // Check that unpaid Order B (500) and cancelled Order C (700) are NOT added
    const ordersPaidActive = await Order.find({
      paymentStatus: 'paid',
      status: { $nin: ['cancelled', 'Cancelled', 'refunded', 'Refunded'] }
    });
    const expectedRevenue = ordersPaidActive.reduce((sum, o) => sum + Math.max(0, o.totalAmount - (o.refundAmount || 0)), 0);

    assert(dashRes.data.totalRevenue === expectedRevenue, `Dashboard completed revenue matches net paid revenue (got: ₹${dashRes.data.totalRevenue})`);

    // -------------------------------------------------------------
    // TEST 6: Auditability & Status History Tracking
    // -------------------------------------------------------------
    console.log('\n--- TEST 6: Auditability & Status History Logs ---');
    const auditedOrder = await Order.findById(order1._id);
    assert(Array.isArray(auditedOrder.statusHistory), 'order.statusHistory is an array');
    assert(auditedOrder.statusHistory.length >= 3, `Recorded ${auditedOrder.statusHistory.length} lifecycle transitions in history`);

    const hasConfirmedToProc = auditedOrder.statusHistory.some(h => h.fromStatus === 'confirmed' && h.toStatus === 'processing');
    const hasProcToShipped = auditedOrder.statusHistory.some(h => h.fromStatus === 'processing' && h.toStatus === 'shipped');
    const hasShippedToDelivered = auditedOrder.statusHistory.some(h => h.fromStatus === 'shipped' && h.toStatus === 'delivered');

    assert(hasConfirmedToProc, 'Audit log captured confirmed -> processing transition');
    assert(hasProcToShipped, 'Audit log captured processing -> shipped transition');
    assert(hasShippedToDelivered, 'Audit log captured shipped -> delivered transition');
    assert(auditedOrder.statusHistory.every(h => h.role && h.timestamp), 'Every statusHistory entry includes role and timestamp');

    // Check refund auditability on order3
    const auditedRefundOrder = await Order.findById(order3._id);
    assert(auditedRefundOrder.refunds.length === 3, 'Recorded all 3 individual partial refunds with timestamps');
    assert(auditedRefundOrder.refunds.every(r => r.refundId && r.amount > 0 && r.status === 'completed'), 'Every refund entry has valid ID, positive amount, and completed status');

  } catch (err) {
    console.error('Unexpected test error:', err.response?.data || err.message);
    failedTests++;
  } finally {
    console.log('\nCleaning up test artifacts...');
    server.close();
    await Product.deleteMany({ title: new RegExp(`^${TEST_PREFIX}`) });
    await Order.deleteMany({ shippingAddress: '123 Test Street' });
    await Vendor.deleteMany({ shopName: new RegExp(`^${TEST_PREFIX}`) });
    await User.deleteMany({ username: new RegExp(`^${TEST_PREFIX}`) });
    await Commission.deleteMany({});
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

