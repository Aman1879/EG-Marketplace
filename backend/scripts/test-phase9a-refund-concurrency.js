/**
 * PHASE 9A: TARGETED REFUND CONCURRENCY AND TRANSITION AUDIT TEST SUITE
 *
 * Verifies:
 * 1. Concurrent refund protection:
 *    - Two simultaneous refund requests exceeding balance cannot both succeed.
 *    - Atomic reservation prevents total completed + in-progress refunds from exceeding totalAmount.
 *    - Failed gateway refunds release their reservation safely.
 *    - Duplicate refund requests and duplicate refund webhooks cannot double-count.
 * 2. Vendor payout reversal:
 *    - Cancellation/refund when transferStatus is already 'processed' sets transferStatus to 'manual_review'.
 *    - Flags notes.payoutReconciliationRequired = true with descriptive transferError.
 *    - Prevents order from silently appearing settled.
 * 3. Fulfillment status transitions:
 *    - Vendors cannot bypass required states: confirmed -> processing -> shipped -> delivered.
 *    - Vendor confirmed -> shipped rejected with HTTP 400.
 *    - Vendor processing -> delivered rejected with HTTP 400.
 *    - Admin explicit transitions preserved.
 */

const mongoose = require('mongoose');
const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Order = require('../models/Order');
const User = require('../models/User');
const Vendor = require('../models/Vendor');
const Product = require('../models/Product');
const InventoryOperation = require('../models/InventoryOperation');
const ordersRouter = require('../routes/orders');

const TEST_DB_URI = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/marketplace_test';
const JWT_SECRET = process.env.JWT_SECRET || 'marketplace-secret-key-2025';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret';

let server;
let baseUrl;

let buyerUser, vendorUser, adminUser;
let vendorDoc;
let buyerToken, vendorToken, adminToken;

let testCount = 0;
let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  testCount++;
  if (condition) {
    passCount++;
    console.log(`  ✔ PASS: ${message}`);
  } else {
    failCount++;
    console.error(`  ✘ FAIL: ${message}`);
  }
}

async function apiRequest(endpoint, { method = 'GET', body = null, token = null } = {}) {
  const url = `${baseUrl}${endpoint}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, ok: res.ok, body: data };
}

async function sendWebhook(eventPayload) {
  const rawBody = JSON.stringify(eventPayload);
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');

  const res = await fetch(`${baseUrl}/api/orders/webhook/razorpay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': signature
    },
    body: rawBody
  });

  const data = await res.json();
  return { status: res.status, body: data };
}

async function setup() {
  await mongoose.connect(TEST_DB_URI);
  console.log(`Connected to database: ${mongoose.connection.name}`);
  if (mongoose.connection.name !== 'marketplace_test') {
    throw new Error('ABORT: Test suite must only run against marketplace_test database!');
  }

  // Setup express test app
  const app = express();
  app.use(express.json());
  app.use('/api/orders', ordersRouter);

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server listening on port ${port}\n`);

  // Clean test collections
  await Order.deleteMany({ shippingAddress: /Phase9ATest/ });
  await User.deleteMany({ email: /phase9a_.*@test\.com/ });
  await Vendor.deleteMany({ shopName: /Phase9AVendor/ });
  await Product.deleteMany({ title: /Phase9AProduct/ });

  // Create Users
  buyerUser = await User.create({
    username: 'phase9a_buyer',
    email: 'phase9a_buyer@test.com',
    password: 'password123',
    role: 'buyer'
  });
  buyerToken = jwt.sign({ userId: buyerUser._id }, JWT_SECRET, { expiresIn: '1h' });

  vendorUser = await User.create({
    username: 'phase9a_vendor',
    email: 'phase9a_vendor@test.com',
    password: 'password123',
    role: 'vendor'
  });
  vendorToken = jwt.sign({ userId: vendorUser._id }, JWT_SECRET, { expiresIn: '1h' });

  adminUser = await User.create({
    username: 'phase9a_admin',
    email: 'phase9a_admin@test.com',
    password: 'password123',
    role: 'admin'
  });
  adminToken = jwt.sign({ userId: adminUser._id }, JWT_SECRET, { expiresIn: '1h' });

  vendorDoc = await Vendor.create({
    userId: vendorUser._id,
    shopName: 'Phase9AVendor Shop',
    shopDescription: 'Phase 9A Vendor Shop',
    approvalStatus: 'approved',
    onboardingComplete: true,
    totalEarnings: 0
  });
}

async function runTests() {
  console.log('--- TEST 1: Concurrent Refund Protection & Atomic Reservation ---');
  {
    // Create a paid order of ₹1000
    const testProduct = await Product.create({
      title: 'Phase9AProduct 1',
      description: 'Test product for concurrent refund',
      price: 1000,
      stock: 10,
      imageUrl: 'https://example.com/test.jpg',
      category: 'Electronics',
      vendorId: vendorDoc._id
    });

    const order = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorDoc._id,
      products: [{
        productId: testProduct._id,
        title: testProduct.title,
        price: 1000,
        quantity: 1
      }],
      totalAmount: 1000,
      vendorEarning: 900,
      adminCommission: 100,
      paymentStatus: 'paid',
      razorpayPaymentId: `pay_p9a_conc_${Date.now()}`,
      status: 'confirmed',
      inventoryStatus: 'deducted',
      shippingAddress: 'Phase9ATest Address 1'
    });

    // Launch two simultaneous refund requests for ₹600 each (600 + 600 = 1200 > 1000)
    const [res1, res2] = await Promise.all([
      ordersRouter.initiateOrderRefund(order._id, { amount: 600, reason: 'Concurrent refund 1' }),
      ordersRouter.initiateOrderRefund(order._id, { amount: 600, reason: 'Concurrent refund 2' })
    ]);

    const successes = [res1, res2].filter(r => r.success);
    const failures = [res1, res2].filter(r => !r.success);

    assert(successes.length === 1, `Exactly one concurrent refund succeeded (got: ${successes.length})`);
    assert(failures.length === 1, `Exactly one concurrent refund was rejected (got: ${failures.length})`);
    assert(
      failures[0].reason.includes('exceeds remaining refundable balance') || failures[0].reason.includes('already in progress'),
      `Failure reason identifies balance exhaustion or concurrency (${failures[0].reason})`
    );

    const freshOrder = await Order.findById(order._id);
    assert(freshOrder.refundAmount === 600, `order.refundAmount is exactly 600 (got: ${freshOrder.refundAmount})`);
    assert(freshOrder.reservedRefundAmount === 0, `order.reservedRefundAmount is cleanly released to 0 (got: ${freshOrder.reservedRefundAmount})`);
    assert(freshOrder.paymentStatus === 'paid', `paymentStatus remains "paid" for partial refund`);

    // Now attempt another refund for ₹500 (600 + 500 = 1100 > 1000)
    const resOver = await ordersRouter.initiateOrderRefund(order._id, { amount: 500, reason: 'Exceeding remaining' });
    assert(resOver.success === false, 'Subsequent refund for ₹500 exceeding remaining ₹400 is rejected');
    assert(resOver.reason.includes('exceeds remaining refundable balance ₹400'), 'Mentions exact remaining balance of ₹400');

    // Attempt refund for exactly remaining ₹400
    const resExact = await ordersRouter.initiateOrderRefund(order._id, { amount: 400, reason: 'Final remaining balance' });
    assert(resExact.success === true, 'Refund for exact remaining ₹400 succeeds');

    const fullyRefundedOrder = await Order.findById(order._id);
    assert(fullyRefundedOrder.refundAmount === 1000, 'order.refundAmount reached full 1000');
    assert(fullyRefundedOrder.paymentStatus === 'refunded', 'paymentStatus transitioned to "refunded"');
    assert(fullyRefundedOrder.status === 'refunded', 'order.status transitioned to "refunded"');
  }

  console.log('\n--- TEST 2: Failed Gateway Refund Releases Reservation Safely ---');
  {
    const order = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorDoc._id,
      products: [],
      totalAmount: 800,
      vendorEarning: 720,
      adminCommission: 80,
      paymentStatus: 'paid',
      razorpayPaymentId: `pay_p9a_fail_${Date.now()}`,
      status: 'confirmed',
      shippingAddress: 'Phase9ATest Address 2'
    });

    // Simulate definite gateway rejection via mockRefundResult
    const failRes = await ordersRouter.initiateOrderRefund(order._id, {
      amount: 500,
      reason: 'Should fail at gateway',
      mockRefundResult: { status: 'failed', error: 'Payment not in captured state', isDefiniteRejection: true, statusCode: 400 }
    });

    assert(failRes.success === false, 'Failed gateway refund returns success: false');
    assert(failRes.reason.includes('Payment not in captured state'), 'Error message from gateway preserved');

    const freshOrder = await Order.findById(order._id);
    assert(freshOrder.refundStatus === 'failed', 'order.refundStatus is set to "failed"');
    assert(freshOrder.reservedRefundAmount === 0, `reservedRefundAmount safely released back to 0 (got: ${freshOrder.reservedRefundAmount})`);
    assert(freshOrder.refundAmount === 0, 'refundAmount remained 0');

    // Verify the available balance is intact and a new refund can succeed
    const retryRes = await ordersRouter.initiateOrderRefund(order._id, {
      amount: 500,
      reason: 'Retry after failure',
      mockRefundResult: { id: 'rfnd_retry_ok', status: 'processed' }
    });

    assert(retryRes.success === true, 'Retry refund succeeds after failed reservation was released');
    const retryOrder = await Order.findById(order._id);
    assert(retryOrder.refundAmount === 500, 'order.refundAmount updated to 500 after retry');
    assert(retryOrder.reservedRefundAmount === 0, 'reservedRefundAmount is 0 after successful completion');
  }

  console.log('\n--- TEST 3: Duplicate Webhook Idempotency ---');
  {
    const order = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorDoc._id,
      products: [],
      totalAmount: 1000,
      vendorEarning: 900,
      adminCommission: 100,
      paymentStatus: 'paid',
      razorpayPaymentId: `pay_p9a_wh_${Date.now()}`,
      status: 'confirmed',
      shippingAddress: 'Phase9ATest Address 3'
    });

    const refundId = `rfnd_wh_dup_${Date.now()}`;
    const webhookPayload = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: refundId,
            payment_id: order.razorpayPaymentId,
            amount: 50000, // ₹500 in paise
            status: 'processed',
            notes: { reason: 'Webhook partial refund' }
          }
        }
      }
    };

    // First delivery of webhook
    const whRes1 = await sendWebhook(webhookPayload);
    assert(whRes1.status === 200, 'First webhook delivery returned 200 OK');

    const orderAfterWh1 = await Order.findById(order._id);
    assert(orderAfterWh1.refundAmount === 500, 'Refund amount is 500 after first webhook');
    assert(orderAfterWh1.refunds.length === 1, 'Exactly 1 refund record stored in refunds array');

    // Duplicate delivery of identical webhook
    const whRes2 = await sendWebhook(webhookPayload);
    assert(whRes2.status === 200, 'Duplicate webhook delivery returned 200 OK');
    assert(whRes2.body.alreadyProcessed === true, 'Duplicate webhook acknowledged with alreadyProcessed: true');

    const orderAfterWh2 = await Order.findById(order._id);
    assert(orderAfterWh2.refundAmount === 500, 'Refund amount NOT double-counted on duplicate webhook (remains 500)');
    assert(orderAfterWh2.refunds.length === 1, 'Refunds array still contains exactly 1 record');
  }

  console.log('\n--- TEST 4: Vendor Payout Reversal & Manual Review Quarantine ---');
  {
    // Case 4A: Order cancelled when transferStatus is already 'processed'
    const processedOrder = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorDoc._id,
      products: [],
      totalAmount: 1200,
      vendorEarning: 1080,
      adminCommission: 120,
      paymentStatus: 'paid',
      razorpayPaymentId: `pay_p9a_trf_${Date.now()}`,
      transferId: 'trf_p9a_processed_123',
      transferStatus: 'processed',
      vendorEarningsCredited: true,
      status: 'confirmed',
      shippingAddress: 'Phase9ATest Address 4A'
    });

    // Admin cancels the order via PUT /api/orders/:id/status
    const cancelRes = await apiRequest(`/api/orders/${processedOrder._id}/status`, {
      method: 'PUT',
      token: adminToken,
      body: { status: 'cancelled', reason: 'Customer requested cancellation after payout' }
    });

    if (cancelRes.status !== 200) {
      console.log('DEBUG cancelRes:', cancelRes.status, cancelRes.body);
    }
    assert(cancelRes.status === 200, 'Admin cancel request returned 200 OK');

    const cancelledOrderDoc = await Order.findById(processedOrder._id);
    assert(cancelledOrderDoc.status === 'cancelled', 'Order status transitioned to "cancelled"');
    assert(
      cancelledOrderDoc.transferStatus === 'manual_review',
      `transferStatus transitioned from 'processed' to 'manual_review' (got: ${cancelledOrderDoc.transferStatus})`
    );
    assert(
      cancelledOrderDoc.notes?.payoutReconciliationRequired === true,
      'notes.payoutReconciliationRequired is set to true'
    );
    assert(
      cancelledOrderDoc.transferError.includes('Manual financial reconciliation or clawback required'),
      'transferError explicitly notes that manual financial reconciliation or clawback is required'
    );

    // Verify createVendorTransfer ignores and refuses to auto-retry an order in manual_review
    const retryTransfer = await ordersRouter.createVendorTransfer({
      razorpayPaymentId: cancelledOrderDoc.razorpayPaymentId,
      order: cancelledOrderDoc
    });
    assert(
      retryTransfer && retryTransfer.requiresManualReview === true,
      'createVendorTransfer refuses automated retry and returns requiresManualReview: true'
    );

    // Case 4B: Full refund on an order with processed transfer via POST /api/orders/:id/refund
    const processedOrder2 = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorDoc._id,
      products: [],
      totalAmount: 1500,
      vendorEarning: 1350,
      adminCommission: 150,
      paymentStatus: 'paid',
      razorpayPaymentId: `pay_p9a_trf2_${Date.now()}`,
      transferId: 'trf_p9a_processed_456',
      transferStatus: 'processed',
      vendorEarningsCredited: true,
      status: 'confirmed',
      shippingAddress: 'Phase9ATest Address 4B'
    });

    const refundRes = await apiRequest(`/api/orders/${processedOrder2._id}/refund`, {
      method: 'POST',
      token: adminToken,
      body: { amount: 1500, reason: 'Full refund after vendor transfer' }
    });

    if (refundRes.status !== 200) {
      console.log('DEBUG refundRes:', refundRes.status, refundRes.body);
    }
    assert(refundRes.status === 200, 'Full refund API call returned 200 OK');
    const refundedOrderDoc = await Order.findById(processedOrder2._id);
    assert(refundedOrderDoc.status === 'refunded', 'Order status updated to "refunded"');
    assert(
      refundedOrderDoc.transferStatus === 'manual_review',
      `transferStatus quarantined as 'manual_review' after refund (got: ${refundedOrderDoc.transferStatus})`
    );
    assert(
      refundedOrderDoc.notes?.payoutReconciliationRequired === true,
      'notes.payoutReconciliationRequired is true'
    );
  }

  console.log('\n--- TEST 5: Vendor Fulfillment State Enforcement ---');
  {
    // Create an order in "confirmed" status
    const order = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorDoc._id,
      products: [],
      totalAmount: 500,
      vendorEarning: 450,
      adminCommission: 50,
      paymentStatus: 'paid',
      razorpayPaymentId: `pay_p9a_trans_${Date.now()}`,
      status: 'confirmed',
      shippingAddress: 'Phase9ATest Address 5'
    });

    // 1. Vendor tries to jump directly from confirmed -> shipped (bypass processing)
    const bypassRes1 = await apiRequest(`/api/orders/${order._id}/status`, {
      method: 'PUT',
      token: vendorToken,
      body: { status: 'shipped' }
    });

    if (bypassRes1.status !== 400) {
      console.log('DEBUG bypassRes1:', bypassRes1.status, bypassRes1.body);
    }
    assert(bypassRes1.status === 400, 'Vendor jumping confirmed -> shipped rejected with HTTP 400');
    assert(
      bypassRes1.body.message.includes('confirmed -> processing -> shipped -> delivered'),
      'Rejection specifies vendor must follow required sequence'
    );

    // 2. Vendor tries to jump directly from confirmed -> delivered (bypass processing and shipped)
    const bypassRes2 = await apiRequest(`/api/orders/${order._id}/status`, {
      method: 'PUT',
      token: vendorToken,
      body: { status: 'delivered' }
    });

    assert(bypassRes2.status === 400, 'Vendor jumping confirmed -> delivered rejected with HTTP 400');

    // 3. Vendor follows proper step: confirmed -> processing
    const step1 = await apiRequest(`/api/orders/${order._id}/status`, {
      method: 'PUT',
      token: vendorToken,
      body: { status: 'processing' }
    });
    assert(step1.status === 200, 'Vendor transitioning confirmed -> processing allowed (HTTP 200)');

    // 4. Vendor tries to jump directly from processing -> delivered (bypass shipped)
    const bypassRes3 = await apiRequest(`/api/orders/${order._id}/status`, {
      method: 'PUT',
      token: vendorToken,
      body: { status: 'delivered' }
    });
    assert(bypassRes3.status === 400, 'Vendor jumping processing -> delivered without shipping rejected with HTTP 400');

    // 5. Vendor follows proper step: processing -> shipped
    const step2 = await apiRequest(`/api/orders/${order._id}/status`, {
      method: 'PUT',
      token: vendorToken,
      body: { status: 'shipped' }
    });
    assert(step2.status === 200, 'Vendor transitioning processing -> shipped allowed (HTTP 200)');

    // 6. Vendor follows proper step: shipped -> delivered
    const step3 = await apiRequest(`/api/orders/${order._id}/status`, {
      method: 'PUT',
      token: vendorToken,
      body: { status: 'delivered' }
    });
    assert(step3.status === 200, 'Vendor transitioning shipped -> delivered allowed (HTTP 200)');

    // 7. Verify Admin retains explicit override permissions (e.g. confirmed -> shipped)
    const adminOrder = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorDoc._id,
      products: [],
      totalAmount: 600,
      vendorEarning: 540,
      adminCommission: 60,
      paymentStatus: 'paid',
      razorpayPaymentId: `pay_p9a_admin_${Date.now()}`,
      status: 'confirmed',
      shippingAddress: 'Phase9ATest Address Admin Override'
    });

    const adminOverride = await apiRequest(`/api/orders/${adminOrder._id}/status`, {
      method: 'PUT',
      token: adminToken,
      body: { status: 'shipped', reason: 'Admin manual expedited shipment' }
    });
    assert(adminOverride.status === 200, 'Admin explicit override confirmed -> shipped permitted (HTTP 200)');
  }
}

async function cleanup() {
  console.log('\nCleaning up test artifacts...');
  await Order.deleteMany({ shippingAddress: /Phase9ATest/ });
  await User.deleteMany({ email: /phase9a_.*@test\.com/ });
  await Vendor.deleteMany({ shopName: /Phase9AVendor/ });
  await Product.deleteMany({ title: /Phase9AProduct/ });

  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
  await mongoose.disconnect();
  console.log('Database disconnected.');
}

async function main() {
  console.log('============================================================');
  console.log(' PHASE 9A: TARGETED REFUND CONCURRENCY & TRANSITION AUDIT');
  console.log('============================================================\n');

  try {
    await setup();
    await runTests();
  } catch (error) {
    console.error('Test execution failed with error:', error);
    failCount++;
  } finally {
    await cleanup();
  }

  console.log('\n============================================================');
  console.log(` RESULTS: ${passCount} PASSED, ${failCount} FAILED (TOTAL: ${testCount})`);
  console.log('============================================================');

  process.exit(failCount > 0 ? 1 : 0);
}

main();
