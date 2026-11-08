/**
 * PHASE 9B: AMBIGUOUS REFUND OUTCOME SAFETY CHECK TEST SUITE
 *
 * Verifies:
 * 1. Definite gateway rejection and safe reservation release:
 *    - Definite rejection (4xx, BAD_REQUEST_ERROR) immediately releases reservedRefundAmount.
 * 2. Timeout after gateway acceptance:
 *    - Ambiguous network timeout (ETIMEDOUT, ECONNRESET, socket hangup) keeps reservation held.
 *    - Order placed in pending reconciliation state (refundStatus: 'processing', notes.refundReconciliationRequired: true).
 *    - Reconciles using gateway lookup (razorpay.payments.fetchMultipleRefund).
 * 3. Retry after ambiguous response:
 *    - Caller retries: pre-flight gate reconciles with gateway first.
 *    - If accepted by gateway, completes existing refund without creating a duplicate gateway call.
 * 4. Duplicate webhook delivery after reconciliation:
 *    - refund.processed webhook delivered after reconciliation acknowledges idempotently without double-counting.
 * 5. Cumulative refunds never exceed captured amount:
 *    - Held reservations + completed refunds can never exceed order.totalAmount.
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

  const app = express();
  app.use(express.json());
  app.use('/api/orders', ordersRouter);

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server listening on port ${port}\n`);

  // Clean test collections
  await Order.deleteMany({ shippingAddress: /Phase9BTest/ });
  await User.deleteMany({ email: /phase9b_.*@test\.com/ });
  await Vendor.deleteMany({ shopName: /Phase9BVendor/ });
  await Product.deleteMany({ title: /Phase9BProduct/ });

  // Create Users
  buyerUser = await User.create({
    username: 'phase9b_buyer',
    email: 'phase9b_buyer@test.com',
    password: 'password123',
    role: 'buyer'
  });
  buyerToken = jwt.sign({ userId: buyerUser._id }, JWT_SECRET, { expiresIn: '1h' });

  vendorUser = await User.create({
    username: 'phase9b_vendor',
    email: 'phase9b_vendor@test.com',
    password: 'password123',
    role: 'vendor'
  });
  vendorToken = jwt.sign({ userId: vendorUser._id }, JWT_SECRET, { expiresIn: '1h' });

  adminUser = await User.create({
    username: 'phase9b_admin',
    email: 'phase9b_admin@test.com',
    password: 'password123',
    role: 'admin'
  });
  adminToken = jwt.sign({ userId: adminUser._id }, JWT_SECRET, { expiresIn: '1h' });

  vendorDoc = await Vendor.create({
    userId: vendorUser._id,
    shopName: 'Phase9BVendor Shop',
    shopDescription: 'Phase 9B Vendor Shop',
    approvalStatus: 'approved',
    onboardingComplete: true,
    totalEarnings: 0
  });
}

async function runTests() {
  console.log('--- TEST 1: Definite Gateway Rejection and Safe Reservation Release ---');
  {
    // 1. Create a paid order of ₹1000
    const order = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorDoc._id,
      products: [],
      totalAmount: 1000,
      vendorEarning: 900,
      adminCommission: 100,
      paymentStatus: 'paid',
      razorpayPaymentId: `pay_p9b_def_${Date.now()}`,
      status: 'confirmed',
      shippingAddress: 'Phase9BTest Address 1'
    });

    // 2. Submit refund with a definite gateway rejection (HTTP 400 Bad Request)
    const definiteError = {
      status: 'failed',
      statusCode: 400,
      isDefiniteRejection: true,
      error: 'BAD_REQUEST_ERROR: Payment has not been captured yet'
    };

    const res = await ordersRouter.initiateOrderRefund(order._id, {
      amount: 400,
      reason: 'Definite rejection test',
      mockRefundResult: definiteError
    });

    assert(res.success === false, 'Definite gateway rejection returns success: false');
    assert(res.definiteRejection === true, 'Response classified as definiteRejection: true');

    const freshOrder = await Order.findById(order._id);
    assert(freshOrder.refundStatus === 'failed', 'order.refundStatus set to "failed"');
    assert(freshOrder.reservedRefundAmount === 0, `reservedRefundAmount safely released back to 0 (got: ${freshOrder.reservedRefundAmount})`);
    assert(freshOrder.refundAmount === 0, 'refundAmount remains 0');
    assert(!freshOrder.notes?.refundReconciliationRequired, 'notes.refundReconciliationRequired is not set');

    // 3. Confirm available balance is intact and a new valid refund can reserve and proceed
    const validRes = await ordersRouter.initiateOrderRefund(order._id, {
      amount: 400,
      reason: 'Valid refund after definite failure',
      mockRefundResult: { id: 'rfnd_after_definite_ok', status: 'processed' }
    });

    assert(validRes.success === true, 'Valid refund succeeds after definite rejection reservation was released');
    const orderAfterSuccess = await Order.findById(order._id);
    assert(orderAfterSuccess.refundAmount === 400, 'order.refundAmount is 400');
    assert(orderAfterSuccess.reservedRefundAmount === 0, 'order.reservedRefundAmount is 0');
  }

  console.log('\n--- TEST 2: Timeout After Gateway Acceptance ---');
  {
    // 1. Create a paid order of ₹1000
    const order = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorDoc._id,
      products: [],
      totalAmount: 1000,
      vendorEarning: 900,
      adminCommission: 100,
      paymentStatus: 'paid',
      razorpayPaymentId: `pay_p9b_timeout_${Date.now()}`,
      status: 'confirmed',
      shippingAddress: 'Phase9BTest Address 2'
    });

    // 2. Submit refund for ₹600 that experiences a connection timeout
    const timeoutError = {
      status: 'failed',
      code: 'ETIMEDOUT',
      isTimeout: true,
      error: 'connect ETIMEDOUT 13.234.39.22:443'
    };

    const timeoutRes = await ordersRouter.initiateOrderRefund(order._id, {
      amount: 600,
      reason: 'Timeout test',
      mockRefundResult: timeoutError
    });

    assert(timeoutRes.success === false, 'Timeout returns success: false');
    assert(timeoutRes.ambiguousOutcome === true, 'Response classified as ambiguousOutcome: true');
    assert(timeoutRes.requiresReconciliation === true, 'Response requiresReconciliation: true');

    const orderAfterTimeout = await Order.findById(order._id);
    assert(
      orderAfterTimeout.reservedRefundAmount === 600,
      `reservedRefundAmount is HELD at 600 (got: ${orderAfterTimeout.reservedRefundAmount})`
    );
    assert(
      orderAfterTimeout.refundStatus === 'processing',
      `refundStatus remains "processing" pending reconciliation (got: ${orderAfterTimeout.refundStatus})`
    );
    assert(
      orderAfterTimeout.notes?.refundReconciliationRequired === true,
      'notes.refundReconciliationRequired is set to true'
    );

    // 3. Verify balance protection: another refund for ₹500 cannot be submitted because (600 held + 500 = 1100 > 1000)
    // Note: this will also hit pre-flight reconciliation or balance check!
    const overAttempt = await ordersRouter.initiateOrderRefund(order._id, {
      amount: 500,
      reason: 'Attempt during timeout'
    });
    assert(overAttempt.success === false, 'Cannot over-refund while timeout reservation is held');

    // 4. Reconcile with gateway where Razorpay accepted the refund
    const mockAcceptedGatewayRefund = {
      id: `rfnd_timeout_accepted_${Date.now()}`,
      amount: 60000, // ₹600 in paise
      status: 'processed',
      notes: { orderId: order._id.toString() }
    };

    const reconResult = await ordersRouter.reconcileOrderRefund(order._id, {
      mockGatewayRefunds: [mockAcceptedGatewayRefund]
    });

    assert(reconResult.success === true, 'reconcileOrderRefund returns success: true');
    assert(reconResult.acceptedByGateway === true, 'Gateway acceptance confirmed');

    const orderAfterRecon = await Order.findById(order._id);
    assert(orderAfterRecon.refundAmount === 600, `order.refundAmount updated to 600 (got: ${orderAfterRecon.refundAmount})`);
    assert(
      orderAfterRecon.reservedRefundAmount === 0,
      `reservedRefundAmount shifted to completed and is now 0 (got: ${orderAfterRecon.reservedRefundAmount})`
    );
    assert(orderAfterRecon.refundStatus === 'completed', 'refundStatus transitioned to "completed"');
    assert(
      orderAfterRecon.notes?.refundReconciliationRequired === false,
      'notes.refundReconciliationRequired cleared to false'
    );
  }

  console.log('\n--- TEST 3: Retry After Ambiguous Response ---');
  {
    // 1. Create a paid order of ₹1000
    const order = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorDoc._id,
      products: [],
      totalAmount: 1000,
      vendorEarning: 900,
      adminCommission: 100,
      paymentStatus: 'paid',
      razorpayPaymentId: `pay_p9b_retry_${Date.now()}`,
      status: 'confirmed',
      shippingAddress: 'Phase9BTest Address 3'
    });

    // 2. Initial attempt times out
    const timeoutError = {
      status: 'failed',
      code: 'ECONNRESET',
      isAmbiguous: true,
      error: 'read ECONNRESET'
    };

    await ordersRouter.initiateOrderRefund(order._id, {
      amount: 400,
      reason: 'Initial ambiguous call',
      mockRefundResult: timeoutError
    });

    const orderMid = await Order.findById(order._id);
    assert(orderMid.reservedRefundAmount === 400, '400 held in reservedRefundAmount');
    assert(orderMid.notes?.refundReconciliationRequired === true, 'Reconciliation required flag set');

    // 3. Caller retries initiateOrderRefund.
    // The gateway actually created the refund during the timeout.
    const gatewayAcceptedId = `rfnd_retry_reconciled_${Date.now()}`;
    const mockGatewayItems = [{
      id: gatewayAcceptedId,
      amount: 40000,
      status: 'processed',
      notes: { orderId: order._id.toString() }
    }];

    const retryRes = await ordersRouter.initiateOrderRefund(order._id, {
      amount: 400,
      reason: 'Retry call',
      mockGatewayRefunds: mockGatewayItems
    });

    assert(retryRes.success === true, 'Retry succeeded via pre-flight reconciliation');
    assert(retryRes.reconciled === true, 'Retry identified as reconciled');
    assert(retryRes.alreadyProcessed === true, 'alreadyProcessed: true prevents duplicate gateway submission');
    assert(retryRes.refundId === gatewayAcceptedId, 'Returns existing gateway refund ID');

    const orderFinal = await Order.findById(order._id);
    assert(orderFinal.refundAmount === 400, `order.refundAmount is exactly 400 (got: ${orderFinal.refundAmount})`);
    assert(orderFinal.reservedRefundAmount === 0, 'reservedRefundAmount is 0');
    assert(orderFinal.refunds.length === 1, `refunds array has exactly 1 entry (got: ${orderFinal.refunds.length})`);
  }

  console.log('\n--- TEST 4: Duplicate Webhook Delivery After Reconciliation ---');
  {
    // Using the order from Test 3 where refundId was gatewayAcceptedId
    const order = await Order.findOne({ shippingAddress: 'Phase9BTest Address 3' });
    const existingRefundId = order.refundId;

    const webhookPayload = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: existingRefundId,
            payment_id: order.razorpayPaymentId,
            amount: 40000,
            status: 'processed',
            notes: { orderId: order._id.toString() }
          }
        }
      }
    };

    const whRes = await sendWebhook(webhookPayload);
    assert(whRes.status === 200, 'Webhook delivery returned 200 OK');
    assert(whRes.body.alreadyProcessed === true, 'Webhook acknowledged as alreadyProcessed: true');

    const orderAfterWh = await Order.findById(order._id);
    assert(orderAfterWh.refundAmount === 400, 'refundAmount not double-counted (remains exactly 400)');
    assert(orderAfterWh.refunds.length === 1, 'refunds array still contains exactly 1 entry');
  }

  console.log('\n--- TEST 5: Gateway Absence Cannot Be Established Reliably (Manual Review) ---');
  {
    // Create an order of ₹1000
    const order = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorDoc._id,
      products: [],
      totalAmount: 1000,
      vendorEarning: 900,
      adminCommission: 100,
      paymentStatus: 'paid',
      razorpayPaymentId: `pay_p9b_failrecon_${Date.now()}`,
      status: 'confirmed',
      shippingAddress: 'Phase9BTest Address 5'
    });

    // Ambiguous network abort occurs
    await ordersRouter.initiateOrderRefund(order._id, {
      amount: 700,
      reason: 'Socket hang up test',
      mockRefundResult: { status: 'failed', code: 'ECONNRESET', isAmbiguous: true, error: 'socket hang up' }
    });

    const orderPending = await Order.findById(order._id);
    assert(orderPending.reservedRefundAmount === 700, '700 held in reservation');
    assert(orderPending.notes?.refundReconciliationRequired === true, 'Reconciliation required flag set');

    // Reconcile: Gateway returns empty list ([]).
    // Per Phase 9B.1, an empty list is NOT sufficient evidence that the refund was never created.
    // The reservation must remain HELD and order moved to manual_review.
    const reconResult = await ordersRouter.reconcileOrderRefund(order._id, {
      mockGatewayRefunds: [] // empty list
    });

    assert(reconResult.success === false, 'Reconciliation returns success: false for unverified absence');
    assert(reconResult.requiresManualReview === true, 'Flagged with requiresManualReview: true');

    const orderAfterRecon = await Order.findById(order._id);
    assert(orderAfterRecon.reservedRefundAmount === 700, `Held reservation 700 NOT released (got: ${orderAfterRecon.reservedRefundAmount})`);
    assert(orderAfterRecon.refundStatus === 'manual_review', 'refundStatus quarantined as "manual_review"');
    assert(orderAfterRecon.notes?.refundManualReviewRequired === true, 'refundManualReviewRequired flag set');

    // Confirm that automated retry on a manual_review order is blocked
    const retryAttempt = await ordersRouter.initiateOrderRefund(order._id, {
      amount: 700,
      reason: 'Automated retry attempt'
    });
    assert(retryAttempt.success === false, 'Automated retry blocked on manual_review order');
    assert(retryAttempt.requiresManualReview === true, 'Retry informs manual review is required');
  }

  console.log('\n--- TEST 6: Cumulative Refunds Never Exceed Captured Amount ---');
  {
    const order = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorDoc._id,
      products: [],
      totalAmount: 1000,
      vendorEarning: 900,
      adminCommission: 100,
      paymentStatus: 'paid',
      razorpayPaymentId: `pay_p9b_invar_${Date.now()}`,
      status: 'confirmed',
      shippingAddress: 'Phase9BTest Address 6'
    });

    // 1. Partial refund of ₹300
    await ordersRouter.initiateOrderRefund(order._id, {
      amount: 300,
      mockRefundResult: { id: 'rfnd_inv_1', status: 'processed' }
    });

    // 2. Ambiguous timeout on ₹500
    await ordersRouter.initiateOrderRefund(order._id, {
      amount: 500,
      mockRefundResult: { status: 'failed', isTimeout: true, code: 'ETIMEDOUT', error: 'ETIMEDOUT' }
    });

    const state1 = await Order.findById(order._id);
    assert(state1.refundAmount === 300, 'Completed refundAmount is 300');
    assert(state1.reservedRefundAmount === 500, 'Reserved refundAmount is 500');
    assert(state1.refundAmount + state1.reservedRefundAmount <= 1000, 'Sum (300 + 500 = 800) <= 1000');

    // 3. Attempting another refund of ₹300 fails because (800 + 300 = 1100 > 1000)
    const overAttempt = await ordersRouter.initiateOrderRefund(order._id, {
      amount: 300,
      reason: 'Exceeding limit'
    });
    assert(overAttempt.success === false, 'Refund exceeding available ₹200 rejected');

    // 4. Reconcile the ₹500 as accepted by gateway
    await ordersRouter.reconcileOrderRefund(order._id, {
      mockGatewayRefunds: [{
        id: 'rfnd_inv_2',
        amount: 50000,
        status: 'processed',
        notes: { orderId: order._id.toString() }
      }]
    });

    const state2 = await Order.findById(order._id);
    assert(state2.refundAmount === 800, 'Completed refundAmount is 800');
    assert(state2.reservedRefundAmount === 0, 'Reserved refundAmount is 0');
    assert(state2.refundAmount <= 1000, '800 <= 1000');

    // 5. Final refund for remaining ₹200
    const finalRes = await ordersRouter.initiateOrderRefund(order._id, {
      amount: 200,
      mockRefundResult: { id: 'rfnd_inv_3', status: 'processed' }
    });
    assert(finalRes.success === true, 'Final remaining ₹200 succeeds');

    const state3 = await Order.findById(order._id);
    assert(state3.refundAmount === 1000, 'Completed refundAmount is exactly 1000');
    assert(state3.reservedRefundAmount === 0, 'Reserved is 0');
    assert(state3.paymentStatus === 'refunded', 'Payment status is refunded');

    // 6. Any further refund rejected
    const excess = await ordersRouter.initiateOrderRefund(order._id, { amount: 50 });
    assert(excess.alreadyRefunded === true || excess.success === false, 'Further refund on fully refunded order rejected');
  }
}

async function cleanup() {
  console.log('\nCleaning up test artifacts...');
  await Order.deleteMany({ shippingAddress: /Phase9BTest/ });
  await User.deleteMany({ email: /phase9b_.*@test\.com/ });
  await Vendor.deleteMany({ shopName: /Phase9BVendor/ });
  await Product.deleteMany({ title: /Phase9BProduct/ });

  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
  await mongoose.disconnect();
  console.log('Database disconnected.');
}

async function main() {
  console.log('============================================================');
  console.log(' PHASE 9B: AMBIGUOUS REFUND OUTCOME SAFETY CHECK');
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

