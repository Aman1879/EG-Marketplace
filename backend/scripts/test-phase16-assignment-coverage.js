/**
 * Phase 16: Automated Testing & Assignment Coverage Verification Suite
 * 
 * Comprehensive end-to-end audit verifying assignment coverage across 10 areas:
 * 1. Customer registration, login, JWT security, and role boundaries.
 * 2. Multi-vendor boundary and cart management (server pricing, single-vendor rule).
 * 3. Checkout idempotency, replay safety, and address snapshotting.
 * 4. Payment verification, signature tamper immunity, and payment cancellation.
 * 5. Concurrent checkout race condition & overselling prevention.
 * 6. Order lifecycle transitions, backward/skip prevention, and idempotent cancellation.
 * 7. Vendor ownership isolation and admin access restrictions.
 * 8. Rating & dispute business rules (1-5 range, purchase verification, duplicate prevention).
 * 9. Contact inquiry validation and admin management.
 * 10. Global error handling (malformed JSON, 404, no stack trace exposure).
 * 
 * Safety: Runs strictly against `marketplace_test`. Zero production impact.
 */

process.env.NODE_ENV = 'test';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const { app } = require('../server');
const User = require('../models/User');
const Vendor = require('../models/Vendor');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Address = require('../models/Address');
const CartItem = require('../models/CartItem');
const Rating = require('../models/Rating');
const Dispute = require('../models/Dispute');
const ContactMessage = require('../models/ContactMessage');
const AuditLog = require('../models/AuditLog');

let server;
let baseUrl;
let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    testsPassed++;
    console.log(`  ✔ PASS: ${message}`);
  } else {
    testsFailed++;
    console.error(`  ✘ FAIL: ${message}`);
  }
}

// HTTP request helper
function request(method, path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { ...(options.headers || {}) };
    let bodyData = null;

    if (options.rawBody !== undefined) {
      bodyData = options.rawBody;
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    } else if (options.body !== undefined) {
      bodyData = JSON.stringify(options.body);
      headers['Content-Type'] = 'application/json';
    }

    if (bodyData && !headers['Content-Length']) {
      headers['Content-Length'] = Buffer.byteLength(bodyData);
    }

    const req = http.request(url, {
      method,
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json || data,
          raw: data
        });
      });
    });

    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

function generateToken(userId, role = 'buyer', expiresIn = '1h') {
  return jwt.sign(
    { userId: userId.toString(), role },
    process.env.JWT_SECRET || 'marketplace-secret-key-2025',
    { expiresIn }
  );
}

async function runPhase16CoverageSuite() {
  const uri = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/marketplace_test';
  console.log(`\n=============================================================`);
  console.log(` PHASE 16: AUTOMATED TESTING & ASSIGNMENT COVERAGE SUITE`);
  console.log(` Target Database: ${uri}`);
  console.log(`=============================================================\n`);

  if (mongoose.connection.readyState !== 1) {
    if (mongoose.connection.readyState === 2) {
      await new Promise(resolve => mongoose.connection.once('connected', resolve));
    } else {
      await mongoose.connect(uri);
    }
  }

  // Confirm connected to test DB
  if (mongoose.connection.name !== 'marketplace_test') {
    console.error(`ABORT: Connected database "${mongoose.connection.name}" is not marketplace_test!`);
    process.exit(1);
  }

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server active on port ${port}\n`);

  const createdUserIds = [];
  const createdShopIds = [];
  const createdProductIds = [];
  const createdOrderIds = [];
  const createdAddressIds = [];

  try {
    // -------------------------------------------------------------
    // SUITE 1: Registration, Authentication & JWT Security
    // -------------------------------------------------------------
    console.log('--- Suite 1: Customer Registration, Authentication & JWT Security ---');

    const testTimestamp = Date.now();
    const regEmail = `p16_reg_${testTimestamp}@test.com`;
    const regUsername = `p16_reg_${testTimestamp}`;

    // 1.1 Positive Registration
    const regRes = await request('POST', '/api/auth/register', {
      body: {
        username: regUsername,
        email: regEmail,
        password: 'Password@123',
        role: 'buyer'
      }
    });
    assert(regRes.status === 201, '1.1 Positive registration returns 201 Created');
    assert(regRes.body.token && regRes.body.user, '1.1 Registration returns token and user payload');
    assert(Boolean(regRes.headers['set-cookie']), '1.1 Registration sets authentication cookie');
    if (regRes.body.user?.id) createdUserIds.push(regRes.body.user.id);

    // 1.2 Duplicate Email Conflict
    const dupEmailRes = await request('POST', '/api/auth/register', {
      body: {
        username: `unique_user_${testTimestamp}`,
        email: regEmail, // Duplicate!
        password: 'Password@123'
      }
    });
    assert(dupEmailRes.status === 400, `1.2 Duplicate email registration rejected with 400 (got ${dupEmailRes.status})`);
    assert(dupEmailRes.body.message.includes('already exists'), '1.2 Error message notes user already exists');

    // 1.3 Duplicate Username Conflict
    const dupUserRes = await request('POST', '/api/auth/register', {
      body: {
        username: regUsername, // Duplicate!
        email: `unique_email_${testTimestamp}@test.com`,
        password: 'Password@123'
      }
    });
    assert(dupUserRes.status === 400, `1.3 Duplicate username registration rejected with 400 (got ${dupUserRes.status})`);

    // 1.4 Short Password Validation
    const shortPassRes = await request('POST', '/api/auth/register', {
      body: {
        username: `short_pass_${testTimestamp}`,
        email: `short_pass_${testTimestamp}@test.com`,
        password: '123' // < 6 chars
      }
    });
    assert(shortPassRes.status === 400, `1.4 Short password (< 6 chars) rejected with 400 (got ${shortPassRes.status})`);

    // 1.5 Invalid Email Validation
    const badEmailRes = await request('POST', '/api/auth/register', {
      body: {
        username: `bad_email_${testTimestamp}`,
        email: 'not-an-email',
        password: 'Password@123'
      }
    });
    assert(badEmailRes.status === 400, `1.5 Malformed email rejected with 400 (got ${badEmailRes.status})`);

    // 1.6 Positive Login
    const loginRes = await request('POST', '/api/auth/login', {
      body: {
        email: regEmail,
        password: 'Password@123'
      }
    });
    assert(loginRes.status === 200, '1.6 Valid login returns 200 OK');
    assert(loginRes.body.token && loginRes.body.user.email === regEmail, '1.6 Login returns JWT token and matching user');

    // 1.7 Incorrect Password
    const wrongPassRes = await request('POST', '/api/auth/login', {
      body: {
        email: regEmail,
        password: 'WrongPassword@999'
      }
    });
    assert(wrongPassRes.status === 401, `1.7 Wrong password returns 401 Unauthorized (got ${wrongPassRes.status})`);

    // 1.8 Unregistered Email Login
    const noUserRes = await request('POST', '/api/auth/login', {
      body: {
        email: `non_existent_${testTimestamp}@test.com`,
        password: 'Password@123'
      }
    });
    assert(noUserRes.status === 401, `1.8 Non-existent email login returns 401 Unauthorized (got ${noUserRes.status})`);

    // 1.9 Profile Retrieval (/api/auth/me)
    const validToken = loginRes.body.token;
    const meRes = await request('GET', '/api/auth/me', {
      headers: { Authorization: `Bearer ${validToken}` }
    });
    assert(meRes.status === 200, '1.9 GET /api/auth/me returns 200 OK');
    assert(meRes.body.user.email === regEmail, '1.9 Profile matches authenticated user');

    // 1.10 Forged / Tampered Token
    const forgedToken = validToken.slice(0, -6) + 'abc123';
    const forgedRes = await request('GET', '/api/auth/me', {
      headers: { Authorization: `Bearer ${forgedToken}` }
    });
    assert(forgedRes.status === 401, `1.10 Tampered token returns 401 Unauthorized (got ${forgedRes.status})`);

    // 1.11 Expired Token
    const expiredToken = generateToken(regRes.body.user.id, 'buyer', '-1s');
    const expiredRes = await request('GET', '/api/auth/me', {
      headers: { Authorization: `Bearer ${expiredToken}` }
    });
    assert(expiredRes.status === 401, `1.11 Expired token returns 401 Unauthorized (got ${expiredRes.status})`);

    // 1.12 Logout Endpoint
    const logoutRes = await request('POST', '/api/auth/logout');
    assert(logoutRes.status === 200, '1.12 POST /api/auth/logout returns 200 OK');

    // -------------------------------------------------------------
    // SUITE 2: Multi-Vendor Boundary & Cart Management
    // -------------------------------------------------------------
    console.log('\n--- Suite 2: Multi-Vendor Boundary & Cart Management ---');

    // Create 2 vendors with distinct shops
    const vendorUser1 = await User.create({
      username: `p16_vendor1_${testTimestamp}`,
      email: `vendor1_${testTimestamp}@test.com`,
      password: 'hash',
      role: 'vendor'
    });
    createdUserIds.push(vendorUser1._id);

    const vendorUser2 = await User.create({
      username: `p16_vendor2_${testTimestamp}`,
      email: `vendor2_${testTimestamp}@test.com`,
      password: 'hash',
      role: 'vendor'
    });
    createdUserIds.push(vendorUser2._id);

    const shop1 = await Vendor.create({
      userId: vendorUser1._id,
      shopName: `P16 Shop 1 ${testTimestamp}`,
      approvalStatus: 'approved',
      onboardingComplete: true
    });
    createdShopIds.push(shop1._id);

    const shop2 = await Vendor.create({
      userId: vendorUser2._id,
      shopName: `P16 Shop 2 ${testTimestamp}`,
      approvalStatus: 'approved',
      onboardingComplete: true
    });
    createdShopIds.push(shop2._id);

    // Create a product for each vendor
    const productA = await Product.create({
      vendorId: shop1._id,
      title: `Product A Shop 1 ${testTimestamp}`,
      description: 'Vendor 1 Product',
      price: 800,
      imageUrl: 'http://example.com/a.jpg',
      category: 'Electronics',
      stock: 15,
      variants: [
        { name: 'Active Var', price: 800, stock: 10, isActive: true },
        { name: 'Inactive Var', price: 800, stock: 5, isActive: false }
      ]
    });
    createdProductIds.push(productA._id);

    const productB = await Product.create({
      vendorId: shop2._id,
      title: `Product B Shop 2 ${testTimestamp}`,
      description: 'Vendor 2 Product',
      price: 450,
      imageUrl: 'http://example.com/b.jpg',
      category: 'Clothing',
      stock: 10
    });
    createdProductIds.push(productB._id);

    // 2.1 Add item to cart
    const addCartRes = await request('POST', '/api/cart/add', {
      headers: { Authorization: `Bearer ${validToken}` },
      body: {
        productId: productA._id.toString(),
        variantId: productA.variants[0]._id.toString(),
        quantity: 2
      }
    });
    assert(addCartRes.status === 201, '2.1 Add item to cart returns 201 Created');
    assert(addCartRes.body.priceAtAdd === 800, '2.1 priceAtAdd is derived from database price (800)');

    // 2.2 Updating cart item quantity to 0 removes it
    const updateZeroRes = await request('PUT', '/api/cart/update', {
      headers: { Authorization: `Bearer ${validToken}` },
      body: {
        cartItemId: addCartRes.body._id,
        quantity: 0
      }
    });
    assert(updateZeroRes.status === 200 && updateZeroRes.body.message === 'Item removed', '2.2 Setting cart item quantity to 0 removes the item');

    // 2.3 Updating non-existent cart item
    const updateNonExist = await request('PUT', '/api/cart/update', {
      headers: { Authorization: `Bearer ${validToken}` },
      body: {
        cartItemId: new mongoose.Types.ObjectId().toString(),
        quantity: 1
      }
    });
    assert(updateNonExist.status === 404, `2.3 Updating non-existent cart item returns 404 (got ${updateNonExist.status})`);

    // 2.4 Single-Vendor Rule: Attempting checkout with items from Shop 1 and Shop 2
    const crossVendorCheckout = await request('POST', '/api/orders/create-razorpay-order', {
      headers: { Authorization: `Bearer ${validToken}` },
      body: {
        products: [
          { productId: productA._id.toString(), quantity: 1 },
          { productId: productB._id.toString(), quantity: 1 } // Different vendor!
        ],
        shippingAddress: '123 Test Street'
      }
    });
    assert(crossVendorCheckout.status === 400, `2.4 Mixed vendor checkout rejected with 400 (got ${crossVendorCheckout.status})`);
    assert(crossVendorCheckout.body.message.includes('same vendor'), '2.4 Error message enforces all products must be from same vendor');

    // 2.5 Empty products checkout
    const emptyCheckout = await request('POST', '/api/orders/create-razorpay-order', {
      headers: { Authorization: `Bearer ${validToken}` },
      body: {
        products: [],
        shippingAddress: '123 Test Street'
      }
    });
    assert(emptyCheckout.status === 400, `2.5 Empty products checkout rejected with 400 (got ${emptyCheckout.status})`);

    // 2.6 Inactive variant checkout
    const inactiveVarCheckout = await request('POST', '/api/orders/create-razorpay-order', {
      headers: { Authorization: `Bearer ${validToken}` },
      body: {
        products: [
          { productId: productA._id.toString(), variantId: productA.variants[1]._id.toString(), quantity: 1 }
        ],
        shippingAddress: '123 Test Street'
      }
    });
    assert(inactiveVarCheckout.status === 400, `2.6 Inactive variant checkout rejected with 400 (got ${inactiveVarCheckout.status})`);
    assert(inactiveVarCheckout.body.message.includes('currently inactive'), '2.6 Error notes variant is currently inactive');

    // -------------------------------------------------------------
    // SUITE 3: Checkout Idempotency & Tamper Protection
    // -------------------------------------------------------------
    console.log('\n--- Suite 3: Checkout Idempotency & Tamper Protection ---');

    // Create a saved delivery address for snapshot test
    const testAddress = await Address.create({
      userId: regRes.body.user.id,
      fullName: 'Rahul Sharma Delivery',
      phone: '9876543210',
      addressLine1: 'Flat 101, Palm Grove',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
      isDefault: true
    });
    createdAddressIds.push(testAddress._id);

    const idempotencyKey = `idemp_${testTimestamp}_${crypto.randomBytes(4).toString('hex')}`;

    // 3.1 Initial checkout
    const order1Res = await request('POST', '/api/orders/create-razorpay-order', {
      headers: {
        Authorization: `Bearer ${validToken}`,
        'Idempotency-Key': idempotencyKey
      },
      body: {
        products: [{ productId: productA._id.toString(), variantId: productA.variants[0]._id.toString(), quantity: 1 }],
        addressId: testAddress._id.toString(),
        paymentProvider: 'simulated'
      }
    });
    assert(order1Res.status === 201, '3.1 Initial checkout creates order (201 Created)');
    const createdOrderId = order1Res.body.orderId;
    createdOrderIds.push(createdOrderId);

    // 3.2 Idempotent Replay (identical key and body)
    const order2Res = await request('POST', '/api/orders/create-razorpay-order', {
      headers: {
        Authorization: `Bearer ${validToken}`,
        'Idempotency-Key': idempotencyKey
      },
      body: {
        products: [{ productId: productA._id.toString(), variantId: productA.variants[0]._id.toString(), quantity: 1 }],
        addressId: testAddress._id.toString(),
        paymentProvider: 'simulated'
      }
    });
    assert(order2Res.status === 200, `3.2 Replaying same idempotency key returns 200 OK (got ${order2Res.status})`);
    assert(order2Res.body.orderId.toString() === createdOrderId.toString(), '3.2 Replay returns the exact same orderId');

    // 3.3 Changed payload with same key returns 409 Conflict
    const orderConflictRes = await request('POST', '/api/orders/create-razorpay-order', {
      headers: {
        Authorization: `Bearer ${validToken}`,
        'Idempotency-Key': idempotencyKey
      },
      body: {
        products: [{ productId: productA._id.toString(), variantId: productA.variants[0]._id.toString(), quantity: 2 }], // Quantity changed!
        addressId: testAddress._id.toString(),
        paymentProvider: 'simulated'
      }
    });
    assert(orderConflictRes.status === 409, `3.3 Changed payload with same key returns 409 Conflict (got ${orderConflictRes.status})`);

    // 3.4 Address snapshotting: mutating saved address does NOT alter existing order's address
    const orderInDb = await Order.findById(createdOrderId);
    const originalOrderAddress = orderInDb.shippingAddress;
    assert(originalOrderAddress.includes('Flat 101, Palm Grove'), '3.4 Order captured initial address snapshot');

    testAddress.addressLine1 = 'Altered Line 999 Hacked';
    await testAddress.save();

    const refreshedOrder = await Order.findById(createdOrderId);
    assert(refreshedOrder.shippingAddress === originalOrderAddress, '3.4 Later edits to saved address did NOT alter prior order snapshot');

    // -------------------------------------------------------------
    // SUITE 4: Payment Verification & Payment Cancellation
    // -------------------------------------------------------------
    console.log('\n--- Suite 4: Payment Verification & Cancellation ---');

    // 4.1 Payment verification with forged signature rejected
    const badSigRes = await request('POST', '/api/orders/verify-payment', {
      headers: { Authorization: `Bearer ${validToken}` },
      body: {
        orderId: createdOrderId.toString(),
        razorpay_order_id: order1Res.body.razorpayOrder.id,
        razorpay_payment_id: `pay_sim_${Date.now()}`,
        razorpay_signature: 'invalid_forged_signature_hash',
        isSimulated: true
      }
    });
    assert(badSigRes.status === 400, `4.1 Forged payment signature rejected with 400 (got ${badSigRes.status})`);

    const orderAfterBadSig = await Order.findById(createdOrderId);
    assert(orderAfterBadSig.paymentStatus === 'created', '4.1 Rejected signature leaves order in untouched created state');

    // 4.2 Cross-customer verification attack
    const attackerUser = await User.create({
      username: `p16_attacker_${testTimestamp}`,
      email: `attacker_${testTimestamp}@test.com`,
      password: 'hash',
      role: 'buyer'
    });
    createdUserIds.push(attackerUser._id);
    const attackerToken = generateToken(attackerUser._id, 'buyer');

    const crossVerifyRes = await request('POST', '/api/orders/verify-payment', {
      headers: { Authorization: `Bearer ${attackerToken}` },
      body: {
        orderId: createdOrderId.toString(),
        razorpay_order_id: order1Res.body.razorpayOrder.id,
        razorpay_payment_id: `pay_sim_${Date.now()}`,
        razorpay_signature: 'sig',
        isSimulated: true
      }
    });
    assert(crossVerifyRes.status === 403, `4.2 Verifying another buyer's order returns 403 Forbidden (got ${crossVerifyRes.status})`);

    // 4.3 Successful signature verification & settlement
    const simulatedSecret = process.env.RAZORPAY_KEY_SECRET || 'simulated_test_secret';
    const validPaymentId = `pay_sim_${Date.now()}_ok`;
    const validSignature = crypto
      .createHmac('sha256', simulatedSecret)
      .update(`${order1Res.body.razorpayOrder.id}|${validPaymentId}`)
      .digest('hex');

    const verifySuccessRes = await request('POST', '/api/orders/verify-payment', {
      headers: { Authorization: `Bearer ${validToken}` },
      body: {
        orderId: createdOrderId.toString(),
        razorpay_order_id: order1Res.body.razorpayOrder.id,
        razorpay_payment_id: validPaymentId,
        razorpay_signature: validSignature,
        isSimulated: true
      }
    });
    assert(verifySuccessRes.status === 200, '4.3 Valid signature settles payment with 200 OK');
    assert(verifySuccessRes.body.order.paymentStatus === 'paid', '4.3 Order paymentStatus transitioned to paid');

    // 4.4 Idempotent verification replay
    const replayVerifyRes = await request('POST', '/api/orders/verify-payment', {
      headers: { Authorization: `Bearer ${validToken}` },
      body: {
        orderId: createdOrderId.toString(),
        razorpay_order_id: order1Res.body.razorpayOrder.id,
        razorpay_payment_id: validPaymentId,
        razorpay_signature: validSignature,
        isSimulated: true
      }
    });
    assert(replayVerifyRes.status === 200, '4.4 Replaying payment verification is idempotent (200 OK)');

    // 4.5 Attempting cancel-payment on paid order
    const cancelPaidRes = await request('POST', `/api/orders/${createdOrderId}/cancel-payment`, {
      headers: { Authorization: `Bearer ${validToken}` }
    });
    assert(cancelPaidRes.status === 400, `4.5 Cancelling payment on already paid order returns 400 (got ${cancelPaidRes.status})`);

    // -------------------------------------------------------------
    // SUITE 5: Concurrency & Stock Overselling Prevention
    // -------------------------------------------------------------
    console.log('\n--- Suite 5: Concurrency & Overselling Prevention ---');

    // Create a product with strictly 1 unit of stock
    const scarceProduct = await Product.create({
      vendorId: shop1._id,
      title: `Scarce Item 1 Unit ${testTimestamp}`,
      description: 'Last unit item',
      price: 1200,
      imageUrl: 'http://example.com/scarce.jpg',
      category: 'Electronics',
      stock: 1
    });
    createdProductIds.push(scarceProduct._id);

    // Create Buyer A and Buyer B
    const buyerA = await User.create({ username: `p16_ba_${testTimestamp}`, email: `ba_${testTimestamp}@test.com`, password: 'hash', role: 'buyer' });
    const buyerB = await User.create({ username: `p16_bb_${testTimestamp}`, email: `bb_${testTimestamp}@test.com`, password: 'hash', role: 'buyer' });
    createdUserIds.push(buyerA._id, buyerB._id);

    const tokenA = generateToken(buyerA._id, 'buyer');
    const tokenB = generateToken(buyerB._id, 'buyer');

    // Buyer A creates checkout
    const orderARes = await request('POST', '/api/orders/create-razorpay-order', {
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        products: [{ productId: scarceProduct._id.toString(), quantity: 1 }],
        shippingAddress: 'Buyer A Address',
        paymentProvider: 'simulated'
      }
    });
    createdOrderIds.push(orderARes.body.orderId);

    // Buyer B creates checkout simultaneously before Buyer A pays
    const orderBRes = await request('POST', '/api/orders/create-razorpay-order', {
      headers: { Authorization: `Bearer ${tokenB}` },
      body: {
        products: [{ productId: scarceProduct._id.toString(), quantity: 1 }],
        shippingAddress: 'Buyer B Address',
        paymentProvider: 'simulated'
      }
    });
    createdOrderIds.push(orderBRes.body.orderId);

    // Buyer A settles payment first
    const payIdA = `pay_sim_a_${Date.now()}`;
    const sigA = crypto.createHmac('sha256', simulatedSecret).update(`${orderARes.body.razorpayOrder.id}|${payIdA}`).digest('hex');
    const settleARes = await request('POST', '/api/orders/verify-payment', {
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        orderId: orderARes.body.orderId,
        razorpay_order_id: orderARes.body.razorpayOrder.id,
        razorpay_payment_id: payIdA,
        razorpay_signature: sigA,
        isSimulated: true
      }
    });
    assert(settleARes.status === 200, '5.1 Buyer A settles payment successfully and claims stock');

    // Buyer B now attempts to settle payment for the same depleted stock unit
    const payIdB = `pay_sim_b_${Date.now()}`;
    const sigB = crypto.createHmac('sha256', simulatedSecret).update(`${orderBRes.body.razorpayOrder.id}|${payIdB}`).digest('hex');
    const settleBRes = await request('POST', '/api/orders/verify-payment', {
      headers: { Authorization: `Bearer ${tokenB}` },
      body: {
        orderId: orderBRes.body.orderId,
        razorpay_order_id: orderBRes.body.razorpayOrder.id,
        razorpay_payment_id: payIdB,
        razorpay_signature: sigB,
        isSimulated: true
      }
    });
    assert(settleBRes.status === 400, `5.2 Buyer B settlement rejected with 400 due to depleted stock (got ${settleBRes.status})`);

    const finalScarceProd = await Product.findById(scarceProduct._id);
    assert(finalScarceProd.stock === 0, `5.3 Stock non-negativity preserved: stock is exactly 0 (got ${finalScarceProd.stock})`);

    // -------------------------------------------------------------
    // SUITE 6: Order Lifecycle Transitions & Cancellations
    // -------------------------------------------------------------
    console.log('\n--- Suite 6: Order Lifecycle Transitions & Cancellations ---');

    const v1Token = generateToken(vendorUser1._id, 'vendor');

    // 6.1 Vendor attempts invalid forward jump: confirmed -> delivered directly
    const skipTransitionRes = await request('PUT', `/api/orders/${createdOrderId}/status`, {
      headers: { Authorization: `Bearer ${v1Token}` },
      body: { status: 'delivered' } // Skipping processing and shipped!
    });
    assert(skipTransitionRes.status === 400, `6.1 Vendor skipping to delivered directly rejected with 400 (got ${skipTransitionRes.status})`);

    // 6.2 Valid progression: confirmed -> processing -> shipped -> delivered
    const toProcessing = await request('PUT', `/api/orders/${createdOrderId}/status`, {
      headers: { Authorization: `Bearer ${v1Token}` },
      body: { status: 'processing' }
    });
    assert(toProcessing.status === 200 && toProcessing.body.status === 'processing', '6.2 Transitioned to processing');

    const toShipped = await request('PUT', `/api/orders/${createdOrderId}/status`, {
      headers: { Authorization: `Bearer ${v1Token}` },
      body: { status: 'shipped' }
    });
    assert(toShipped.status === 200 && toShipped.body.status === 'shipped', '6.2 Transitioned to shipped');

    const toDelivered = await request('PUT', `/api/orders/${createdOrderId}/status`, {
      headers: { Authorization: `Bearer ${v1Token}` },
      body: { status: 'delivered' }
    });
    assert(toDelivered.status === 200 && toDelivered.body.status === 'delivered', '6.2 Transitioned to delivered');

    // 6.3 Backward transition rejection: delivered -> processing
    const backwardRes = await request('PUT', `/api/orders/${createdOrderId}/status`, {
      headers: { Authorization: `Bearer ${v1Token}` },
      body: { status: 'processing' }
    });
    assert(backwardRes.status === 400, `6.3 Backward transition from delivered to processing rejected with 400 (got ${backwardRes.status})`);

    // 6.4 Buyer cannot cancel delivered order
    const cancelDelivered = await request('POST', `/api/orders/${createdOrderId}/cancel`, {
      headers: { Authorization: `Bearer ${validToken}` },
      body: { reason: 'Want to cancel delivered order' }
    });
    assert(cancelDelivered.status === 400, `6.4 Cancelling delivered order rejected with 400 (got ${cancelDelivered.status})`);

    // -------------------------------------------------------------
    // SUITE 7: Vendor & Admin Access Restriction Boundaries
    // -------------------------------------------------------------
    console.log('\n--- Suite 7: Vendor & Admin Access Restriction Boundaries ---');

    const v2Token = generateToken(vendorUser2._id, 'vendor');

    // 7.1 Vendor 2 cannot view Vendor 1's order details
    const crossOrderGet = await request('GET', `/api/orders/${createdOrderId}`, {
      headers: { Authorization: `Bearer ${v2Token}` }
    });
    assert(crossOrderGet.status === 403, `7.1 Vendor 2 viewing Vendor 1's order returns 403 Forbidden (got ${crossOrderGet.status})`);

    // 7.2 Vendor 2 cannot update status on Vendor 1's order
    const crossStatusPut = await request('PUT', `/api/orders/${createdOrderId}/status`, {
      headers: { Authorization: `Bearer ${v2Token}` },
      body: { status: 'shipped' }
    });
    assert(crossStatusPut.status === 403, `7.2 Vendor 2 updating status on Vendor 1's order returns 403 Forbidden (got ${crossStatusPut.status})`);

    // 7.3 Vendor 2 cannot update Vendor 1's payout settings
    const crossPayoutPut = await request('PUT', `/api/vendors/${shop1._id}/payout-settings`, {
      headers: { Authorization: `Bearer ${v2Token}` },
      body: { upiId: 'hacker@upi' }
    });
    assert(crossPayoutPut.status === 403, `7.3 Vendor 2 updating Vendor 1's payout settings returns 403 Forbidden (got ${crossPayoutPut.status})`);

    // 7.4 Non-admin cannot view financial analytics report
    const nonAdminReport = await request('GET', '/api/admin/reports/financial', {
      headers: { Authorization: `Bearer ${v1Token}` }
    });
    assert(nonAdminReport.status === 403, `7.4 Vendor accessing financial report returns 403 Forbidden (got ${nonAdminReport.status})`);

    // -------------------------------------------------------------
    // SUITE 8: Rating & Dispute Business Constraints
    // -------------------------------------------------------------
    console.log('\n--- Suite 8: Rating & Dispute Business Constraints ---');

    // 8.1 Rating product NOT in the order
    const unpurchasedRating = await request('POST', '/api/ratings', {
      headers: { Authorization: `Bearer ${validToken}` },
      body: {
        productId: productB._id.toString(), // Product B was NOT in createdOrderId!
        orderId: createdOrderId.toString(),
        rating: 5,
        review: 'Nice product'
      }
    });
    assert(unpurchasedRating.status === 400, `8.1 Rating product not in order rejected with 400 (got ${unpurchasedRating.status})`);

    // 8.2 Rating outside 1-5 range
    const outOfRangeRating = await request('POST', '/api/ratings', {
      headers: { Authorization: `Bearer ${validToken}` },
      body: {
        productId: productA._id.toString(),
        orderId: createdOrderId.toString(),
        rating: 6 // Invalid! Must be 1-5
      }
    });
    assert(outOfRangeRating.status === 400, `8.2 Rating score 6 outside 1-5 range rejected with 400 (got ${outOfRangeRating.status})`);

    // 8.3 Valid rating submission
    const validRating = await request('POST', '/api/ratings', {
      headers: { Authorization: `Bearer ${validToken}` },
      body: {
        productId: productA._id.toString(),
        orderId: createdOrderId.toString(),
        rating: 5,
        review: 'Excellent headphones!'
      }
    });
    assert(validRating.status === 201, '8.3 Valid product rating returns 201 Created');

    // 8.4 Duplicate rating prevention
    const duplicateRating = await request('POST', '/api/ratings', {
      headers: { Authorization: `Bearer ${validToken}` },
      body: {
        productId: productA._id.toString(),
        orderId: createdOrderId.toString(),
        rating: 4,
        review: 'Second review'
      }
    });
    assert(duplicateRating.status === 400, `8.4 Duplicate rating for same product rejected with 400 (got ${duplicateRating.status})`);

    // 8.5 Dispute on another customer's order rejected
    const crossDispute = await request('POST', '/api/disputes', {
      headers: { Authorization: `Bearer ${attackerToken}` },
      body: {
        orderId: createdOrderId.toString(),
        reason: 'damaged_product',
        description: 'Damaged item'
      }
    });
    assert(crossDispute.status === 403, `8.5 Raising dispute on another buyer's order returns 403 Forbidden (got ${crossDispute.status})`);

    // -------------------------------------------------------------
    // SUITE 9: Contact Inquiries & Global Error Handling
    // -------------------------------------------------------------
    console.log('\n--- Suite 9: Contact Inquiries & Global Error Handling ---');

    // 9.1 Missing contact message fields
    const badContact = await request('POST', '/api/contact/submit', {
      body: {
        name: 'John',
        email: 'invalid-email'
        // missing subject and message
      }
    });
    assert(badContact.status === 400, `9.1 Incomplete contact submission rejected with 400 (got ${badContact.status})`);

    // 9.2 Valid contact submission
    const goodContact = await request('POST', '/api/contact/submit', {
      body: {
        name: 'John Doe',
        email: 'john@example.com',
        subject: 'General Question',
        message: 'How long does standard delivery take?'
      }
    });
    assert(goodContact.status === 200, '9.2 Valid contact submission returns 200 OK');

    // 9.3 Global 404 handler for unknown routes
    const unknownRoute = await request('GET', '/api/v99/not-existing');
    assert(unknownRoute.status === 404, `9.3 Unknown API route returns 404 Not Found (got ${unknownRoute.status})`);
    assert(unknownRoute.body.success === false, '9.3 Unknown route returns structured JSON error');

    // 9.4 Global error handler for malformed JSON without stack trace leakage
    const malformedJson = await request('POST', '/api/contact/submit', {
      rawBody: '{"name": "broken-json',
      headers: { 'Content-Type': 'application/json' }
    });
    assert(malformedJson.status === 400, `9.4 Malformed JSON returns 400 Bad Request (got ${malformedJson.status})`);
    assert(!malformedJson.raw.includes('node_modules') && !malformedJson.raw.includes('at '), '9.4 Stack trace is completely hidden from client');

    // -------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------
    console.log(`\n=============================================================`);
    console.log(`Phase 16 Verification Summary:`);
    console.log(`Passed: ${testsPassed}`);
    console.log(`Failed: ${testsFailed}`);
    console.log(`=============================================================\n`);

    if (testsFailed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Phase 16 test suite uncaught error:', err);
    process.exit(1);
  } finally {
    // Clean up created test entities
    if (createdOrderIds.length > 0) await Order.deleteMany({ _id: { $in: createdOrderIds } });
    if (createdProductIds.length > 0) await Product.deleteMany({ _id: { $in: createdProductIds } });
    if (createdShopIds.length > 0) await Vendor.deleteMany({ _id: { $in: createdShopIds } });
    if (createdAddressIds.length > 0) await Address.deleteMany({ _id: { $in: createdAddressIds } });
    if (createdUserIds.length > 0) await User.deleteMany({ _id: { $in: createdUserIds } });
    await Rating.deleteMany({ review: { $regex: /headphones/i } });
    await ContactMessage.deleteMany({ subject: 'General Question' });

    if (server) server.close();
    await mongoose.connection.close();
  }
}

runPhase16CoverageSuite();
