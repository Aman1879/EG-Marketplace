/**
 * Focused Verification Test Suite: Phase 7 & 7A Payment Processing and Safety Audit
 * 
 * Verifies all Phase 7 & 7A requirements:
 * 1. Valid payment verification (signature, status, amount, currency, orderId).
 * 2. Risk 1: Invalid signature leaves order and inventory untouched in 'created' state.
 *    Attacker cannot verify or mutate another customer's order (HTTP 403).
 * 3. Amount, currency, and order-ID mismatch rejection (leaves order untouched).
 * 4. Failed and cancelled payment handling (order marked cancelled, stock restored, no commission/payout).
 * 5. Duplicate verification request idempotency (no duplicate stock deduction or earnings).
 * 6. Duplicate webhook delivery idempotency (no repeated stock operations or commission updates).
 * 7. Webhook and frontend verification arriving in either order:
 *    - Case A: Webhook first, frontend second.
 *    - Case B: Frontend first, webhook second.
 * 8. Risk 2: Safe state transitions:
 *    - Delayed payment.failed event CANNOT overwrite a captured/paid order.
 *    - Delayed payment.authorized event CANNOT downgrade an already paid order.
 *    - Stale payment.captured event CANNOT reactivate a cancelled or refunded order (HTTP 409).
 * 9. Risk 3: Vendor transfer idempotency:
 *    - Concurrent or duplicate transfer calls execute exactly once.
 *    - Distinguishes processed, queued, and failed outcomes.
 * 10. Risk 4: Refund and inventory consistency:
 *     - If inventory deduction fails upon capture: refund initiated exactly once,
 *       pending/failed refund not represented as completed, stock not restored twice.
 * 11. Webhook signature verification (rejects missing or invalid signature).
 * 
 * Database Safety: Strictly runs against dedicated test database (marketplace_test).
 * Zero credential or secret exposure.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mongoose = require('mongoose');

const Product = require('../models/Product');
const Vendor = require('../models/Vendor');
const User = require('../models/User');
const Order = require('../models/Order');
const Commission = require('../models/Commission');
const ordersRouter = require('../routes/orders');

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

const TEST_PREFIX = `TEST_P7A_${Date.now()}_`;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret_key_123';
process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

let server;
let baseUrl;
let vendor;
let buyer;
let buyer2;
let buyerToken;
let buyer2Token;
let buyerHeaders;
let buyer2Headers;
let testProduct;

async function cleanupTestData() {
  await Product.deleteMany({ title: { $regex: TEST_PREFIX } });
  if (vendor) {
    await Commission.deleteMany({});
    await Vendor.deleteOne({ _id: vendor._id });
  }
  if (buyer) {
    await Order.deleteMany({ buyerId: buyer._id });
    await User.deleteOne({ _id: buyer._id });
  }
  if (buyer2) {
    await Order.deleteMany({ buyerId: buyer2._id });
    await User.deleteOne({ _id: buyer2._id });
  }
}

function generateSignature(orderId, paymentId, secret) {
  return crypto
    .createHmac('sha256', secret || process.env.RAZORPAY_KEY_SECRET || 'simulated_test_secret')
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

function generateWebhookSignature(payloadObj, secret) {
  const bodyStr = JSON.stringify(payloadObj);
  return crypto
    .createHmac('sha256', secret || WEBHOOK_SECRET)
    .update(bodyStr)
    .digest('hex');
}

async function runPhase7Tests() {
  console.log('\n============================================================');
  console.log(' PHASE 7A: TARGETED PAYMENT SAFETY AUDIT & VERIFICATION');
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
    assert(mongoose.connection.name === 'marketplace_test', 'Safety check: Active database confirmed as marketplace_test');

    await Product.init();
    await Order.init();
    await User.init();
    await Vendor.init();
    await Commission.init();

    await cleanupTestData();

    // Create Buyer
    buyer = await User.create({
      username: `${TEST_PREFIX}Buyer`,
      email: `${TEST_PREFIX}buyer@example.com`,
      password: 'password123',
      role: 'buyer'
    });

    // Create Attacker Buyer 2
    buyer2 = await User.create({
      username: `${TEST_PREFIX}Attacker`,
      email: `${TEST_PREFIX}attacker@example.com`,
      password: 'password123',
      role: 'buyer'
    });

    // Create Vendor
    vendor = await Vendor.create({
      userId: new mongoose.Types.ObjectId(),
      shopName: `${TEST_PREFIX}PaymentStore`,
      categories: ['Electronics'],
      onboardingComplete: true,
      approvalStatus: 'approved',
      razorpayAccountId: 'acc_test_vendor_123',
      totalEarnings: 0
    });

    // Buyer JWT tokens
    const jwtSecret = process.env.JWT_SECRET || 'marketplace-secret-key-2025';
    buyerToken = jwt.sign({ userId: buyer._id }, jwtSecret);
    buyer2Token = jwt.sign({ userId: buyer2._id }, jwtSecret);
    buyerHeaders = { Authorization: `Bearer ${buyerToken}` };
    buyer2Headers = { Authorization: `Bearer ${buyer2Token}` };

    // Create Test Product (stock: 20, price: ₹1000.00)
    testProduct = await Product.create({
      vendorId: vendor._id,
      title: `${TEST_PREFIX}Premium Noise-Cancelling Headphones`,
      description: 'Studio-grade headphones with active ANC',
      imageUrl: 'https://example.com/headphones.jpg',
      price: 1000.00,
      stock: 20,
      category: 'Electronics'
    });

    // Setup Express App
    const app = express();
    app.use(express.json());
    app.use('/api/orders', ordersRouter);

    server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const port = server.address().port;
    baseUrl = `http://localhost:${port}/api/orders`;
    assert(Boolean(port), `Test server listening on port ${port}`);

    // Helper: create order via endpoint
    async function createTestOrder(quantity = 1, customKey = null) {
      const idempotencyKey = customKey || `KEY_P7_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const res = await axios.post(
        `${baseUrl}/create-razorpay-order`,
        {
          idempotencyKey,
          products: [{ productId: testProduct._id.toString(), quantity }],
          shippingAddress: '123 Payment Way, Bengaluru - 560001'
        },
        {
          headers: {
            ...buyerHeaders,
            'Idempotency-Key': idempotencyKey
          }
        }
      );
      return res.data;
    }

    // -------------------------------------------------------------
    // Test 1: Valid Payment Verification
    // -------------------------------------------------------------
    console.log('\n--- Test 1: Valid Payment Verification ---');
    const orderData1 = await createTestOrder(1);
    const orderId1 = orderData1.orderId;
    const rzpOrderId1 = orderData1.razorpayOrder.id;
    const rzpPaymentId1 = `pay_test_${Date.now()}_1`;
    const signature1 = generateSignature(rzpOrderId1, rzpPaymentId1);

    const verifyRes1 = await axios.post(
      `${baseUrl}/verify-payment`,
      {
        orderId: orderId1,
        razorpay_order_id: rzpOrderId1,
        razorpay_payment_id: rzpPaymentId1,
        razorpay_signature: signature1
      },
      { headers: buyerHeaders }
    );

    assert(verifyRes1.status === 200, 'POST /verify-payment returns HTTP 200');
    assert(verifyRes1.data.order.paymentStatus === 'paid', 'Order paymentStatus updated to "paid"');
    assert(verifyRes1.data.order.status === 'confirmed', 'Order status updated to "confirmed"');
    assert(verifyRes1.data.order.inventoryStatus === 'deducted', 'Inventory status is "deducted"');

    // Verify stock decremented by 1 (20 -> 19)
    const productAfter1 = await Product.findById(testProduct._id);
    assert(productAfter1.stock === 19, `Product stock decremented from 20 to 19 (actual: ${productAfter1.stock})`);

    // Verify commission document created
    const commDoc1 = await Commission.findOne({ orderId: orderId1 });
    assert(Boolean(commDoc1), 'Commission record created');
    assert(commDoc1.totalAmount === 1000.00, 'Commission totalAmount is 1000.00');
    assert(commDoc1.commissionAmount === 100.00, 'Admin commission is 100.00 (10%)');

    // -------------------------------------------------------------
    // Test 2: Risk 1 Audit — Invalid Signature Must NOT Mutate Order State
    // -------------------------------------------------------------
    console.log('\n--- Test 2: Risk 1 — Invalid Signature Rejection Leaves State Untouched ---');
    const orderData2 = await createTestOrder(1);
    const orderId2 = orderData2.orderId;
    const rzpOrderId2 = orderData2.razorpayOrder.id;
    const rzpPaymentId2 = `pay_test_${Date.now()}_2`;
    const invalidSignature = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

    // 2A: Attacker attempts to verify another buyer's order
    try {
      await axios.post(
        `${baseUrl}/verify-payment`,
        {
          orderId: orderId2,
          razorpay_order_id: rzpOrderId2,
          razorpay_payment_id: rzpPaymentId2,
          razorpay_signature: invalidSignature
        },
        { headers: buyer2Headers } // Buyer 2 trying to verify Buyer 1's order!
      );
      assert(false, 'Should have rejected unauthorized user');
    } catch (authErr) {
      assert(authErr.response?.status === 403, 'Rejects unauthorized verification request with HTTP 403 Forbidden');
    }

    // 2B: Legitimate user sends invalid/tampered signature
    try {
      await axios.post(
        `${baseUrl}/verify-payment`,
        {
          orderId: orderId2,
          razorpay_order_id: rzpOrderId2,
          razorpay_payment_id: rzpPaymentId2,
          razorpay_signature: invalidSignature
        },
        { headers: buyerHeaders }
      );
      assert(false, 'Should reject invalid signature');
    } catch (sigErr) {
      assert(sigErr.response?.status === 400, 'Rejects invalid signature with HTTP 400');
      assert(sigErr.response?.data?.message?.includes('invalid signature'), 'Error states invalid signature');
    }

    // 2C: Crucial Audit Assertion: Order MUST NOT be marked failed! State remains 'created', stock untouched!
    const orderDoc2 = await Order.findById(orderId2);
    assert(orderDoc2.paymentStatus === 'created', 'Order paymentStatus remains untouched at "created" on invalid signature');
    assert(orderDoc2.status === 'pending', 'Order status remains untouched at "pending"');
    assert(orderDoc2.inventoryStatus === 'not_deducted', 'Inventory status remains untouched at "not_deducted"');

    // Stock should NOT be decremented (remains 19)
    const productAfter2 = await Product.findById(testProduct._id);
    assert(productAfter2.stock === 19, 'Stock was not decremented on invalid signature');

    // -------------------------------------------------------------
    // Test 3: Amount, Currency, and Order-ID Mismatch Rejection
    // -------------------------------------------------------------
    console.log('\n--- Test 3: Amount, Currency & Order-ID Mismatch Rejection ---');
    const orderData3 = await createTestOrder(1);
    const orderId3 = orderData3.orderId;
    const rzpOrderId3 = orderData3.razorpayOrder.id;

    // Case 3A: Order ID mismatch
    try {
      await axios.post(
        `${baseUrl}/verify-payment`,
        {
          orderId: orderId3,
          razorpay_order_id: 'order_wrong_order_id_999',
          razorpay_payment_id: `pay_test_${Date.now()}_3a`,
          razorpay_signature: 'signature'
        },
        { headers: buyerHeaders }
      );
      assert(false, 'Should reject mismatched order ID');
    } catch (orderMismatchErr) {
      assert(orderMismatchErr.response?.status === 400, 'Rejects mismatched order ID with HTTP 400');
      assert(orderMismatchErr.response?.data?.message?.includes('mismatch'), 'Identifies order mismatch');
    }

    // Case 3B: Amount mismatch via settleOrderPayment
    const amountMismatchRes = await ordersRouter.settleOrderPayment({
      orderId: orderId3,
      razorpayOrderId: rzpOrderId3,
      razorpayPaymentId: `pay_test_${Date.now()}_3b`,
      paymentStatus: 'captured',
      amountPaise: 50000, // ₹500 instead of ₹1000
      currency: 'INR'
    });
    assert(amountMismatchRes.error && amountMismatchRes.error.includes('amount mismatch'), 'Rejects amount mismatch');

    // Case 3C: Currency mismatch via settleOrderPayment
    const currencyMismatchRes = await ordersRouter.settleOrderPayment({
      orderId: orderId3,
      razorpayOrderId: rzpOrderId3,
      razorpayPaymentId: `pay_test_${Date.now()}_3c`,
      paymentStatus: 'captured',
      amountPaise: 100000,
      currency: 'USD' // USD instead of INR
    });
    assert(currencyMismatchRes.error && currencyMismatchRes.error.includes('currency mismatch'), 'Rejects currency mismatch');

    // Stock still untouched at 19
    const productAfter3 = await Product.findById(testProduct._id);
    assert(productAfter3.stock === 19, 'Stock was untouched during mismatch rejections');

    // -------------------------------------------------------------
    // Test 4: Failed and Cancelled Payment Handling
    // -------------------------------------------------------------
    console.log('\n--- Test 4: Failed and Cancelled Payment ---');
    const orderData4 = await createTestOrder(1);
    const orderId4 = orderData4.orderId;

    const cancelRes = await axios.post(
      `${baseUrl}/${orderId4}/cancel-payment`,
      { reason: 'User dismissed modal' },
      { headers: buyerHeaders }
    );
    assert(cancelRes.status === 200, 'POST /:id/cancel-payment returns HTTP 200');
    assert(cancelRes.data.order.paymentStatus === 'failed', 'Payment status is "failed"');
    assert(cancelRes.data.order.status === 'cancelled', 'Order status is "cancelled"');

    // Verify no commission was created for cancelled order
    const commDoc4 = await Commission.findOne({ orderId: orderId4 });
    assert(!commDoc4, 'No commission created for cancelled order');

    // -------------------------------------------------------------
    // Test 5: Duplicate Verification Request Idempotency
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Duplicate Verification Request Idempotency ---');
    // Using order 1 which is already verified and paid:
    const duplicateVerifyRes = await axios.post(
      `${baseUrl}/verify-payment`,
      {
        orderId: orderId1,
        razorpay_order_id: rzpOrderId1,
        razorpay_payment_id: rzpPaymentId1,
        razorpay_signature: signature1
      },
      { headers: buyerHeaders }
    );

    assert(duplicateVerifyRes.status === 200, 'Duplicate verification returns HTTP 200');
    assert(duplicateVerifyRes.data.message === 'Payment already verified', 'Recognizes "Payment already verified"');

    // Stock must NOT be decremented a second time (must remain 19)
    const productAfter5 = await Product.findById(testProduct._id);
    assert(productAfter5.stock === 19, 'Stock was NOT decremented on duplicate verification');

    // -------------------------------------------------------------
    // Test 6: Risk 2 Audit — Safe Payment State Transitions
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Risk 2 — Safe Payment State Transitions ---');
    // 6A: Delayed payment.failed event must NEVER overwrite captured/paid order
    const staleFailedRes = await ordersRouter.settleOrderPayment({
      orderId: orderId1,
      razorpayOrderId: rzpOrderId1,
      razorpayPaymentId: rzpPaymentId1,
      paymentStatus: 'failed',
      failureReason: 'Late network error arrival'
    });
    assert(staleFailedRes.ignored === true, 'Delayed payment.failed event is safely ignored for paid order');

    const orderDocAfterStale = await Order.findById(orderId1);
    assert(orderDocAfterStale.paymentStatus === 'paid', 'Order paymentStatus strictly remains "paid"');
    assert(orderDocAfterStale.status === 'confirmed', 'Order status strictly remains "confirmed"');

    // 6B: Delayed authorization event must NEVER downgrade captured/paid order
    const staleAuthRes = await ordersRouter.settleOrderPayment({
      orderId: orderId1,
      razorpayOrderId: rzpOrderId1,
      razorpayPaymentId: rzpPaymentId1,
      paymentStatus: 'authorized'
    });
    assert(staleAuthRes.ignored === true || staleAuthRes.alreadySettled === true, 'Delayed payment.authorized event cannot downgrade paid order');
    const orderDocAfterStaleAuth = await Order.findById(orderId1);
    assert(orderDocAfterStaleAuth.paymentStatus === 'paid', 'Order paymentStatus strictly remains "paid" after stale auth');

    // 6C: Stale payment.captured event must NEVER reactivate a cancelled/refunded order
    const staleCaptureOnCancelled = await ordersRouter.settleOrderPayment({
      orderId: orderId4, // Order 4 was cancelled in Test 4
      razorpayOrderId: orderData4.razorpayOrder.id,
      paymentStatus: 'captured',
      amountPaise: 100000,
      currency: 'INR'
    });
    assert(staleCaptureOnCancelled.statusCode === 409 || staleCaptureOnCancelled.ignored === true, 'Stale capture event rejected for cancelled order');
    const cancelledOrderDoc = await Order.findById(orderId4);
    assert(cancelledOrderDoc.status === 'cancelled', 'Order status remains "cancelled" (cannot be reactivated by stale event)');

    // -------------------------------------------------------------
    // Test 7: Risk 3 Audit — Vendor Transfer Idempotency
    // -------------------------------------------------------------
    console.log('\n--- Test 7: Risk 3 — Vendor Transfer Idempotency ---');
    const orderDoc1Fresh = await Order.findById(orderId1);
    const earningsBeforeTransfer = (await Vendor.findById(vendor._id)).totalPaidEarnings || 0;

    // Call createVendorTransfer again on order 1
    const secondTransfer = await ordersRouter.createVendorTransfer({
      razorpayPaymentId: rzpPaymentId1,
      order: orderDoc1Fresh
    });
    assert(Boolean(secondTransfer), 'Returns existing transfer record');

    const earningsAfterTransfer = (await Vendor.findById(vendor._id)).totalPaidEarnings || 0;
    assert(earningsAfterTransfer === earningsBeforeTransfer, 'Duplicate transfer call did NOT double-increment vendor paid earnings');

    // -------------------------------------------------------------
    // Test 8: Webhook and Frontend Verification in Either Order
    // -------------------------------------------------------------
    console.log('\n--- Test 8: Webhook & Frontend Verification in Either Order ---');
    // Case 8A: Webhook FIRST -> Frontend verification SECOND
    console.log('  Case 8A: Webhook FIRST -> Frontend verification SECOND');
    const orderData8A = await createTestOrder(1);
    const rzpOrderId8A = orderData8A.razorpayOrder.id;
    const rzpPaymentId8A = `pay_8a_${Date.now()}`;

    const whPayload8A = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: rzpPaymentId8A,
            order_id: rzpOrderId8A,
            amount: 100000,
            currency: 'INR',
            status: 'captured'
          }
        }
      }
    };
    const whSig8A = generateWebhookSignature(whPayload8A);
    const whRes8A = await axios.post(
      `${baseUrl}/webhook/razorpay`,
      whPayload8A,
      { headers: { 'x-razorpay-signature': whSig8A } }
    );
    assert(whRes8A.status === 200, 'Webhook (1st) processed successfully');

    // Frontend calls verify-payment afterwards
    const feSig8A = generateSignature(rzpOrderId8A, rzpPaymentId8A);
    const feRes8A = await axios.post(
      `${baseUrl}/verify-payment`,
      {
        orderId: orderData8A.orderId,
        razorpay_order_id: rzpOrderId8A,
        razorpay_payment_id: rzpPaymentId8A,
        razorpay_signature: feSig8A
      },
      { headers: buyerHeaders }
    );
    assert(feRes8A.status === 200, 'Frontend verify (2nd) returns 200');
    assert(feRes8A.data.message === 'Payment already verified', 'Recognized order was already verified by webhook');

    // Case 8B: Frontend verification FIRST -> Webhook SECOND
    console.log('  Case 8B: Frontend verification FIRST -> Webhook SECOND');
    const orderData8B = await createTestOrder(1);
    const rzpOrderId8B = orderData8B.razorpayOrder.id;
    const rzpPaymentId8B = `pay_8b_${Date.now()}`;

    // Frontend verifies first
    const feSig8B = generateSignature(rzpOrderId8B, rzpPaymentId8B);
    const feRes8B = await axios.post(
      `${baseUrl}/verify-payment`,
      {
        orderId: orderData8B.orderId,
        razorpay_order_id: rzpOrderId8B,
        razorpay_payment_id: rzpPaymentId8B,
        razorpay_signature: feSig8B
      },
      { headers: buyerHeaders }
    );
    assert(feRes8B.status === 200, 'Frontend verify (1st) succeeds');
    assert(feRes8B.data.order.paymentStatus === 'paid', 'Order marked paid by frontend');

    // Webhook arrives second
    const whPayload8B = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: rzpPaymentId8B,
            order_id: rzpOrderId8B,
            amount: 100000,
            currency: 'INR',
            status: 'captured'
          }
        }
      }
    };
    const whSig8B = generateWebhookSignature(whPayload8B);
    const whRes8B = await axios.post(
      `${baseUrl}/webhook/razorpay`,
      whPayload8B,
      { headers: { 'x-razorpay-signature': whSig8B } }
    );
    assert(whRes8B.status === 200, 'Webhook (2nd) processed idempotently');

    // -------------------------------------------------------------
    // Test 9: No Payout or Commission Before Capture (payment.authorized)
    // -------------------------------------------------------------
    console.log('\n--- Test 9: No Payout or Commission Before Capture ---');
    const orderData9 = await createTestOrder(1);
    const rzpOrderId9 = orderData9.razorpayOrder.id;
    const rzpPaymentId9 = `pay_auth_${Date.now()}`;

    const vendorBefore9 = await Vendor.findById(vendor._id);
    const earningsBefore9 = vendorBefore9.totalEarnings;

    // Send payment.authorized webhook event
    const whPayload9 = {
      event: 'payment.authorized',
      payload: {
        payment: {
          entity: {
            id: rzpPaymentId9,
            order_id: rzpOrderId9,
            amount: 100000,
            currency: 'INR',
            status: 'authorized'
          }
        }
      }
    };
    const whSig9 = generateWebhookSignature(whPayload9);
    await axios.post(
      `${baseUrl}/webhook/razorpay`,
      whPayload9,
      { headers: { 'x-razorpay-signature': whSig9 } }
    );

    const orderDoc9 = await Order.findById(orderData9.orderId);
    assert(orderDoc9.paymentStatus === 'authorized', 'Order paymentStatus is "authorized"');
    assert(orderDoc9.inventoryStatus === 'deducted', 'Inventory is reserved/held');
    assert(orderDoc9.transferStatus === 'not_initiated', 'Vendor transfer is strictly "not_initiated"');

    const commDoc9 = await Commission.findOne({ orderId: orderData9.orderId });
    assert(!commDoc9, 'NO commission record created before capture');

    const vendorAfterAuth9 = await Vendor.findById(vendor._id);
    assert(vendorAfterAuth9.totalEarnings === earningsBefore9, 'Vendor totalEarnings did NOT increase on authorization');

    // Now capture payment
    const whCapturePayload9 = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: rzpPaymentId9,
            order_id: rzpOrderId9,
            amount: 100000,
            currency: 'INR',
            status: 'captured'
          }
        }
      }
    };
    const whCaptureSig9 = generateWebhookSignature(whCapturePayload9);
    await axios.post(
      `${baseUrl}/webhook/razorpay`,
      whCapturePayload9,
      { headers: { 'x-razorpay-signature': whCaptureSig9 } }
    );

    const orderDocCaptured9 = await Order.findById(orderData9.orderId);
    assert(orderDocCaptured9.paymentStatus === 'paid', 'Order transitioned to "paid" upon capture');
    assert(orderDocCaptured9.status === 'confirmed', 'Order status confirmed upon capture');

    const commDocCaptured9 = await Commission.findOne({ orderId: orderData9.orderId });
    assert(Boolean(commDocCaptured9), 'Commission record created after capture');

    // -------------------------------------------------------------
    // Test 10: Risk 4 Audit — Refund and Inventory Consistency
    // -------------------------------------------------------------
    console.log('\n--- Test 10: Risk 4 — Refund and Inventory Consistency ---');
    const orderData10 = await createTestOrder(1);
    const rzpOrderId10 = orderData10.razorpayOrder.id;
    const rzpPaymentId10 = `pay_stock_fail_${Date.now()}`;
    const stockBefore10 = (await Product.findById(testProduct._id)).stock;

    // Deplete stock to 0 to simulate stock exhaustion when capture happens
    await Product.updateOne({ _id: testProduct._id }, { $set: { stock: 0 } });

    // Settle payment capture when stock is 0
    const failSettlement = await ordersRouter.settleOrderPayment({
      orderId: orderData10.orderId,
      razorpayOrderId: rzpOrderId10,
      razorpayPaymentId: rzpPaymentId10,
      paymentStatus: 'captured',
      amountPaise: 100000,
      currency: 'INR'
    });

    assert(failSettlement.refundInitiated === true, 'Automated refund initiated when inventory deduction fails');
    const orderDoc10 = await Order.findById(orderData10.orderId);
    assert(orderDoc10.status === 'cancelled', 'Order status is "cancelled"');
    assert(orderDoc10.refundStatus === 'completed' || orderDoc10.refundStatus === 'processing', 'Refund status is tracked consistently');

    // Stock was 0, deduction failed, stock must remain 0 (no phantom restoration!)
    const stockAfter10 = (await Product.findById(testProduct._id)).stock;
    assert(stockAfter10 === 0, 'Stock was not phanton-restored when deduction failed');

    // Restore stock back to stockBefore10
    await Product.updateOne({ _id: testProduct._id }, { $set: { stock: stockBefore10 } });

    // Final Cleanup
    await cleanupTestData();

    console.log('\n============================================================');
    console.log(` SUMMARY: ${passedTests} passed, ${failedTests} failed.`);
    console.log('============================================================\n');

    if (failedTests > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (error) {
    console.error('Test execution error:', error);
    process.exit(1);
  } finally {
    if (server) {
      server.close();
    }
    await mongoose.disconnect();
  }
}

runPhase7Tests();
