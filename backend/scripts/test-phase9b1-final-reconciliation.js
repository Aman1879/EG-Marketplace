/**
 * PHASE 9B.1: FINAL REFUND RECONCILIATION SAFETY CHECK TEST SUITE
 *
 * Verifies:
 * 1. Empty result from razorpay.payments.fetchMultipleRefund(paymentId) is NOT
 *    treated as conclusive absence; reservation is kept held and moved to manual_review.
 * 2. Multiple partial refunds with identical amounts and no unique attempt ID are
 *    detected as ambiguous; system refuses to pick the wrong refund and moves to manual_review.
 * 3. Unique attempt ID matching (refundAttemptId) correctly matches the intended refund
 *    even when multiple identical amount refunds exist on the same payment.
 * 4. Concurrent reconciliation attempts cannot count the same gateway refund twice
 *    via atomic claim fencing and document conditions.
 * 5. Reservation is never released on ambiguous match or empty list.
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
const ordersRouter = require('../routes/orders');

const TEST_DB_URI = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/marketplace_test';
const JWT_SECRET = process.env.JWT_SECRET || 'marketplace-secret-key-2025';

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
  await Order.deleteMany({ shippingAddress: /Phase9B1Test/ });
  await User.deleteMany({ email: /phase9b1_.*@test\.com/ });
  await Vendor.deleteMany({ shopName: /Phase9B1Vendor/ });

  // Create Users
  buyerUser = await User.create({
    username: 'phase9b1_buyer',
    email: 'phase9b1_buyer@test.com',
    password: 'password123',
    role: 'buyer'
  });
  buyerToken = jwt.sign({ userId: buyerUser._id }, JWT_SECRET, { expiresIn: '1h' });

  vendorUser = await User.create({
    username: 'phase9b1_vendor',
    email: 'phase9b1_vendor@test.com',
    password: 'password123',
    role: 'vendor'
  });
  vendorToken = jwt.sign({ userId: vendorUser._id }, JWT_SECRET, { expiresIn: '1h' });

  adminUser = await User.create({
    username: 'phase9b1_admin',
    email: 'phase9b1_admin@test.com',
    password: 'password123',
    role: 'admin'
  });
  adminToken = jwt.sign({ userId: adminUser._id }, JWT_SECRET, { expiresIn: '1h' });

  vendorDoc = await Vendor.create({
    userId: vendorUser._id,
    shopName: 'Phase9B1Vendor Shop',
    shopDescription: 'Phase 9B1 Vendor Shop',
    approvalStatus: 'approved',
    onboardingComplete: true,
    totalEarnings: 0
  });
}

async function runTests() {
  console.log('--- TEST 1: Empty Result From Gateway Lookup Does Not Release Reservation ---');
  {
    const order = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorDoc._id,
      products: [],
      totalAmount: 1200,
      vendorEarning: 1080,
      adminCommission: 120,
      paymentStatus: 'paid',
      razorpayPaymentId: `pay_p9b1_empty_${Date.now()}`,
      status: 'confirmed',
      shippingAddress: 'Phase9B1Test Address 1'
    });

    // 1. Initial refund call encounters an ambiguous network timeout
    await ordersRouter.initiateOrderRefund(order._id, {
      amount: 500,
      reason: 'Network timeout',
      mockRefundResult: { status: 'failed', code: 'ETIMEDOUT', isTimeout: true, error: 'ETIMEDOUT' }
    });

    const orderAfterTimeout = await Order.findById(order._id);
    assert(orderAfterTimeout.reservedRefundAmount === 500, '500 held in reservedRefundAmount');
    assert(orderAfterTimeout.notes?.refundReconciliationRequired === true, 'notes.refundReconciliationRequired is true');

    // 2. Gateway lookup returns empty list ([])
    // Confirm: An empty list is NOT sufficient evidence that a refund was never created
    const reconResult = await ordersRouter.reconcileOrderRefund(order._id, {
      mockGatewayRefunds: []
    });

    assert(reconResult.success === false, 'reconcileOrderRefund does not report success on empty list');
    assert(reconResult.requiresManualReview === true, 'Flagged with requiresManualReview: true');

    const freshOrder = await Order.findById(order._id);
    assert(
      freshOrder.reservedRefundAmount === 500,
      `Reservation ₹500 is KEPT HELD, not released (got: ${freshOrder.reservedRefundAmount})`
    );
    assert(
      freshOrder.refundStatus === 'manual_review',
      `refundStatus moved to 'manual_review' (got: ${freshOrder.refundStatus})`
    );
    assert(freshOrder.notes?.refundManualReviewRequired === true, 'notes.refundManualReviewRequired is true');
    assert(freshOrder.refundAmount === 0, 'refundAmount remained 0');

    // 3. Confirm automated retries are permanently blocked on manual_review order
    const retryAttempt = await ordersRouter.initiateOrderRefund(order._id, { amount: 500 });
    assert(retryAttempt.success === false, 'Automated retry blocked on manual_review order');
    assert(retryAttempt.requiresManualReview === true, 'Requires manual review response returned');
  }

  console.log('\n--- TEST 2: Ambiguous Amount Match Detection Among Multiple Partial Refunds ---');
  {
    const order = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorDoc._id,
      products: [],
      totalAmount: 1000,
      vendorEarning: 900,
      adminCommission: 100,
      paymentStatus: 'paid',
      razorpayPaymentId: `pay_p9b1_multi_${Date.now()}`,
      status: 'confirmed',
      shippingAddress: 'Phase9B1Test Address 2'
    });

    // Ambiguous timeout occurs on a ₹200 refund
    await ordersRouter.initiateOrderRefund(order._id, {
      amount: 200,
      reason: 'Partial refund timeout',
      mockRefundResult: { status: 'failed', code: 'ECONNRESET', isAmbiguous: true, error: 'ECONNRESET' }
    });

    // Simulate gateway having TWO different unrecorded refunds of ₹200 on this payment
    // without matching refundAttemptId
    const ambiguousGatewayRefunds = [
      {
        id: 'rfnd_part_A_200',
        amount: 20000,
        status: 'processed',
        notes: { orderId: order._id.toString() }
      },
      {
        id: 'rfnd_part_B_200',
        amount: 20000,
        status: 'processed',
        notes: { orderId: order._id.toString() }
      }
    ];

    // Reconcile: system must detect that picking either is ambiguous
    const reconResult = await ordersRouter.reconcileOrderRefund(order._id, {
      mockGatewayRefunds: ambiguousGatewayRefunds
    });

    assert(reconResult.success === false, 'Reconciliation does not pick an ambiguous match');
    assert(reconResult.isAmbiguousMatch === true, 'isAmbiguousMatch flagged as true');
    assert(reconResult.requiresManualReview === true, 'Moved to requiresManualReview');

    const freshOrder = await Order.findById(order._id);
    assert(
      freshOrder.reservedRefundAmount === 200,
      `Reservation is KEPT HELD at 200 (got: ${freshOrder.reservedRefundAmount})`
    );
    assert(freshOrder.refundStatus === 'manual_review', 'refundStatus set to manual_review');
    assert(freshOrder.refundAmount === 0, 'No refundAmount recorded on ambiguous match');
    assert(freshOrder.refunds.length === 0, 'No refund added to refunds array on ambiguous match');
  }

  console.log('\n--- TEST 3: Precise Matching via Unique Attempt ID (refundAttemptId) ---');
  {
    const order = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorDoc._id,
      products: [],
      totalAmount: 1000,
      vendorEarning: 900,
      adminCommission: 100,
      paymentStatus: 'paid',
      razorpayPaymentId: `pay_p9b1_att_${Date.now()}`,
      status: 'confirmed',
      shippingAddress: 'Phase9B1Test Address 3'
    });

    // Submit refund that times out
    await ordersRouter.initiateOrderRefund(order._id, {
      amount: 300,
      reason: 'Attempt ID test',
      mockRefundResult: { status: 'failed', isTimeout: true, code: 'ETIMEDOUT', error: 'ETIMEDOUT' }
    });

    const orderWithAttempt = await Order.findById(order._id);
    const recordedAttemptId = orderWithAttempt.notes?.ambiguousRefundAttempt?.refundAttemptId;
    assert(Boolean(recordedAttemptId), 'Unique refundAttemptId was generated and stored on order notes');

    // Simulate gateway having two ₹300 refunds, but only ONE has the exact matching refundAttemptId
    const gatewayItems = [
      {
        id: 'rfnd_other_300',
        amount: 30000,
        status: 'processed',
        notes: { orderId: order._id.toString(), refundAttemptId: 'rfatt_unrelated_123' }
      },
      {
        id: 'rfnd_exact_match_300',
        amount: 30000,
        status: 'processed',
        notes: { orderId: order._id.toString(), refundAttemptId: recordedAttemptId }
      }
    ];

    const reconRes = await ordersRouter.reconcileOrderRefund(order._id, {
      mockGatewayRefunds: gatewayItems
    });

    assert(reconRes.success === true, 'Reconciliation succeeds with exact attempt ID match');
    assert(reconRes.refundId === 'rfnd_exact_match_300', 'Matched the exact intended refund ID');

    const orderFinal = await Order.findById(order._id);
    assert(orderFinal.refundAmount === 300, 'order.refundAmount updated to 300');
    assert(orderFinal.reservedRefundAmount === 0, 'reservedRefundAmount cleanly shifted to 0');
    assert(orderFinal.refunds.length === 1, 'Exactly 1 refund recorded in order.refunds');
    assert(orderFinal.refunds[0].refundId === 'rfnd_exact_match_300', 'Recorded refund matches intended attempt');
  }

  console.log('\n--- TEST 4: Concurrent Reconciliation Attempts Cannot Count Refund Twice ---');
  {
    const order = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorDoc._id,
      products: [],
      totalAmount: 1000,
      vendorEarning: 900,
      adminCommission: 100,
      paymentStatus: 'paid',
      razorpayPaymentId: `pay_p9b1_conc_${Date.now()}`,
      status: 'confirmed',
      shippingAddress: 'Phase9B1Test Address 4'
    });

    // Ambiguous timeout occurs
    await ordersRouter.initiateOrderRefund(order._id, {
      amount: 400,
      mockRefundResult: { status: 'failed', isTimeout: true, code: 'ETIMEDOUT', error: 'ETIMEDOUT' }
    });

    const orderTimeout = await Order.findById(order._id);
    const attemptId = orderTimeout.notes?.ambiguousRefundAttempt?.refundAttemptId;

    const mockAcceptedGatewayRefund = {
      id: 'rfnd_conc_reconcile_999',
      amount: 40000,
      status: 'processed',
      notes: { orderId: order._id.toString(), refundAttemptId: attemptId }
    };

    // Launch two simultaneous concurrent calls to reconcileOrderRefund for the same order
    const [resA, resB] = await Promise.all([
      ordersRouter.reconcileOrderRefund(order._id, { mockGatewayRefunds: [mockAcceptedGatewayRefund] }),
      ordersRouter.reconcileOrderRefund(order._id, { mockGatewayRefunds: [mockAcceptedGatewayRefund] })
    ]);

    // Check responses
    const successfulApplications = [resA, resB].filter(r => r.acceptedByGateway === true);
    assert(
      successfulApplications.length === 1,
      `Exactly one worker applied the gateway refund (got: ${successfulApplications.length})`
    );

    const freshOrder = await Order.findById(order._id);
    assert(
      freshOrder.refundAmount === 400,
      `refundAmount is exactly 400 and NOT double-counted (got: ${freshOrder.refundAmount})`
    );
    assert(
      freshOrder.reservedRefundAmount === 0,
      `reservedRefundAmount is 0 (got: ${freshOrder.reservedRefundAmount})`
    );
    assert(
      freshOrder.refunds.length === 1,
      `refunds array has exactly 1 entry (got: ${freshOrder.refunds.length})`
    );
  }
}

async function cleanup() {
  console.log('\nCleaning up test artifacts...');
  await Order.deleteMany({ shippingAddress: /Phase9B1Test/ });
  await User.deleteMany({ email: /phase9b1_.*@test\.com/ });
  await Vendor.deleteMany({ shopName: /Phase9B1Vendor/ });

  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
  await mongoose.disconnect();
  console.log('Database disconnected.');
}

async function main() {
  console.log('============================================================');
  console.log(' PHASE 9B.1: FINAL REFUND RECONCILIATION SAFETY CHECK');
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

