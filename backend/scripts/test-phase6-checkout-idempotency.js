/**
 * Verification Test Suite: Phase 6 Secure Checkout and Idempotency
 * 
 * Verifies all Phase 6 requirements:
 * 1. First checkout succeeds (creates order and payment order).
 * 2. Same customer + same idempotency key + same payload returns existing order (idempotent replay).
 * 3. Retrying does NOT create another payment order (reuses existing Razorpay order).
 * 4. Same customer + same key + changed payload returns HTTP 409 (Conflict).
 * 5. Concurrent requests with same key create only one order and return the same order.
 * 6. Different customers can independently use the same idempotency key without collision.
 * 7. Genuinely new intentional checkout with a new key creates a new order.
 * 8. Database unique index on { buyerId: 1, idempotencyKey: 1 } enforces uniqueness in MongoDB.
 * 9. Price manipulation immunity: client-submitted prices are ignored; calculated from DB.
 * 10. Quantity & stock limits: excessive quantity or stock depletion is rejected with HTTP 400.
 * 
 * Database Safety: Strictly runs against dedicated test database (marketplace_test).
 * Zero credential or secret exposure.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const Product = require('../models/Product');
const Vendor = require('../models/Vendor');
const User = require('../models/User');
const Order = require('../models/Order');
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

const TEST_PREFIX = `TEST_P6_${Date.now()}_`;
let server;
let baseUrl;
let vendor;
let buyer1;
let buyer2;
let buyer1Token;
let buyer2Token;
let buyer1Headers;
let buyer2Headers;
let testProduct1;
let testProduct2;

async function cleanupTestData() {
  await Product.deleteMany({ title: { $regex: TEST_PREFIX } });
  if (vendor) await Vendor.deleteOne({ _id: vendor._id });
  if (buyer1) {
    await Order.deleteMany({ buyerId: buyer1._id });
    await User.deleteOne({ _id: buyer1._id });
  }
  if (buyer2) {
    await Order.deleteMany({ buyerId: buyer2._id });
    await User.deleteOne({ _id: buyer2._id });
  }
}

async function runPhase6Tests() {
  console.log('\n============================================================');
  console.log(' PHASE 6: SECURE CHECKOUT AND IDEMPOTENCY VERIFICATION');
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

    // Ensure models and indexes are built in MongoDB
    await Product.init();
    await Order.init();
    await User.init();
    await Vendor.init();

    await cleanupTestData();

    // Create Buyer 1
    buyer1 = await User.create({
      username: `${TEST_PREFIX}Buyer1`,
      email: `${TEST_PREFIX}buyer1@example.com`,
      password: 'password123',
      role: 'buyer'
    });

    // Create Buyer 2
    buyer2 = await User.create({
      username: `${TEST_PREFIX}Buyer2`,
      email: `${TEST_PREFIX}buyer2@example.com`,
      password: 'password123',
      role: 'buyer'
    });

    // Create Vendor
    vendor = await Vendor.create({
      userId: new mongoose.Types.ObjectId(),
      shopName: `${TEST_PREFIX}TechZone`,
      categories: ['Electronics'],
      onboardingComplete: true,
      approvalStatus: 'approved'
    });

    // Generate JWT tokens
    const jwtSecret = process.env.JWT_SECRET || 'marketplace-secret-key-2025';
    buyer1Token = jwt.sign({ userId: buyer1._id }, jwtSecret);
    buyer2Token = jwt.sign({ userId: buyer2._id }, jwtSecret);

    buyer1Headers = { Authorization: `Bearer ${buyer1Token}` };
    buyer2Headers = { Authorization: `Bearer ${buyer2Token}` };

    // Create Test Products
    testProduct1 = await Product.create({
      vendorId: vendor._id,
      title: `${TEST_PREFIX}Ergonomic Wireless Keyboard`,
      description: 'Split mechanical ergonomic keyboard',
      imageUrl: 'https://example.com/keyboard.jpg',
      price: 1499.00,
      stock: 30,
      category: 'Electronics'
    });

    testProduct2 = await Product.create({
      vendorId: vendor._id,
      title: `${TEST_PREFIX}Precision Wireless Trackball`,
      description: 'Ergonomic trackball mouse',
      imageUrl: 'https://example.com/trackball.jpg',
      price: 899.00,
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

    // -------------------------------------------------------------
    // Test 1: Verify MongoDB Partial Compound Unique Index
    // -------------------------------------------------------------
    console.log('\n--- Test 1: MongoDB Unique Index on { buyerId: 1, idempotencyKey: 1 } ---');
    const indexes = await Order.collection.indexes();
    const hasCompoundIndex = indexes.some(idx => {
      return idx.key && idx.key.buyerId === 1 && idx.key.idempotencyKey === 1 && idx.unique === true;
    });
    assert(hasCompoundIndex, 'Compound unique index on { buyerId: 1, idempotencyKey: 1 } exists in MongoDB');

    // -------------------------------------------------------------
    // Test 2: First Checkout Succeeds (Order & Razorpay Creation)
    // -------------------------------------------------------------
    console.log('\n--- Test 2: First Checkout Succeeds ---');
    const idempotencyKey1 = `KEY_P6_ORDER_${Date.now()}_1`;
    const checkoutPayload1 = {
      idempotencyKey: idempotencyKey1,
      products: [
        { productId: testProduct1._id.toString(), quantity: 1 }
      ],
      shippingAddress: '123 MG Road, Bengaluru, Karnataka - 560001'
    };

    const firstRes = await axios.post(
      `${baseUrl}/create-razorpay-order`,
      checkoutPayload1,
      {
        headers: {
          ...buyer1Headers,
          'Idempotency-Key': idempotencyKey1
        }
      }
    );

    assert(firstRes.status === 201, 'First checkout returns HTTP 201 Created');
    assert(Boolean(firstRes.data.orderId), 'Returns valid orderId');
    assert(Boolean(firstRes.data.razorpayOrder?.id), 'Returns valid razorpayOrder.id');
    assert(firstRes.data.amount === 1499.00, 'Calculated total amount is 1499.00 (from DB)');

    const initialOrderId = firstRes.data.orderId;
    const initialRazorpayOrderId = firstRes.data.razorpayOrder.id;

    // Verify stored document in MongoDB
    const storedOrder1 = await Order.findById(initialOrderId);
    assert(Boolean(storedOrder1), 'Order document persists in MongoDB');
    assert(storedOrder1.buyerId.toString() === buyer1._id.toString(), 'Order buyerId matches Buyer 1');
    assert(storedOrder1.idempotencyKey === idempotencyKey1, 'Order idempotencyKey matches submitted key');
    assert(Boolean(storedOrder1.payloadHash), 'Order payloadHash was computed and stored');
    assert(storedOrder1.razorpayOrderId === initialRazorpayOrderId, 'Order razorpayOrderId saved on document');

    // -------------------------------------------------------------
    // Test 3: Same Customer + Same Key + Same Payload Returns Existing Order (Idempotent Replay)
    // -------------------------------------------------------------
    console.log('\n--- Test 3: Same Key + Same Payload Returns Existing Order ---');
    const replayRes = await axios.post(
      `${baseUrl}/create-razorpay-order`,
      checkoutPayload1,
      {
        headers: {
          ...buyer1Headers,
          'Idempotency-Key': idempotencyKey1
        }
      }
    );

    assert(replayRes.status === 200, 'Idempotent replay returns HTTP 200 OK');
    assert(replayRes.data.idempotent === true, 'Response contains idempotent: true flag');
    assert(replayRes.data.orderId.toString() === initialOrderId.toString(), 'Returns identical orderId');
    assert(replayRes.data.amount === 1499.00, 'Returns identical total amount');

    // Check database count
    const buyer1OrderCount = await Order.countDocuments({ buyerId: buyer1._id });
    assert(buyer1OrderCount === 1, 'Strictly 1 order exists for Buyer 1 in database (no duplicate order created)');

    // -------------------------------------------------------------
    // Test 4: Retrying Does NOT Create Another Payment Order
    // -------------------------------------------------------------
    console.log('\n--- Test 4: Retrying Does Not Create Another Payment Order ---');
    assert(
      replayRes.data.razorpayOrder.id === initialRazorpayOrderId,
      `Razorpay order ID is strictly preserved: ${replayRes.data.razorpayOrder.id} === ${initialRazorpayOrderId}`
    );
    assert(
      replayRes.data.razorpayOrder.amount === Math.round(1499.00 * 100),
      'Razorpay order amount in paise strictly matches'
    );

    // -------------------------------------------------------------
    // Test 5: Same Customer + Same Key + Changed Payload Returns HTTP 409 Conflict
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Same Key + Changed Payload Returns HTTP 409 Conflict ---');
    const conflictingPayload = {
      idempotencyKey: idempotencyKey1,
      products: [
        { productId: testProduct1._id.toString(), quantity: 2 } // Changed quantity from 1 to 2!
      ],
      shippingAddress: '123 MG Road, Bengaluru, Karnataka - 560001'
    };

    try {
      await axios.post(
        `${baseUrl}/create-razorpay-order`,
        conflictingPayload,
        {
          headers: {
            ...buyer1Headers,
            'Idempotency-Key': idempotencyKey1
          }
        }
      );
      assert(false, 'Should have rejected conflicting payload with HTTP 409');
    } catch (conflictErr) {
      assert(conflictErr.response?.status === 409, 'Returns HTTP 409 Conflict on payload mismatch');
      assert(conflictErr.response?.data?.code === 'IDEMPOTENCY_CONFLICT', 'Response code is "IDEMPOTENCY_CONFLICT"');
      assert(
        conflictErr.response?.data?.message?.includes('conflict'),
        'Message clearly identifies idempotency conflict'
      );
    }

    // Verify order in database was not mutated by conflicting attempt
    const unchangedOrder = await Order.findById(initialOrderId);
    assert(unchangedOrder.products[0].quantity === 1, 'Original order quantity remains strictly 1');
    assert(unchangedOrder.totalAmount === 1499.00, 'Original order total remains strictly 1499.00');

    // -------------------------------------------------------------
    // Test 6: Concurrent Requests with Same Key Create Only One Order
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Concurrent Race with Same Key ---');
    const concurrentKey = `KEY_P6_CONCURRENT_${Date.now()}`;
    const concurrentPayload = {
      idempotencyKey: concurrentKey,
      products: [
        { productId: testProduct2._id.toString(), quantity: 1 }
      ],
      shippingAddress: '456 Residency Road, Bengaluru - 560025'
    };

    // Fire 5 requests in parallel at the exact same millisecond
    const concurrentRequests = Array.from({ length: 5 }, () =>
      axios.post(
        `${baseUrl}/create-razorpay-order`,
        concurrentPayload,
        {
          headers: {
            ...buyer1Headers,
            'Idempotency-Key': concurrentKey
          }
        }
      )
    );

    const concurrentResults = await Promise.all(concurrentRequests);
    assert(concurrentResults.length === 5, 'All 5 concurrent requests completed');

    const createdResponses = concurrentResults.filter(r => r.status === 201);
    const resolvedResponses = concurrentResults.filter(r => r.status === 200);

    assert(createdResponses.length === 1, 'Exactly 1 request resulted in HTTP 201 (initial creation)');
    assert(resolvedResponses.length === 4, 'Remaining 4 requests resolved idempotently with HTTP 200');

    const concurrentOrderIds = concurrentResults.map(r => r.data.orderId.toString());
    const allSameOrderId = concurrentOrderIds.every(id => id === concurrentOrderIds[0]);
    assert(allSameOrderId, `All 5 concurrent responses returned the identical order ID (${concurrentOrderIds[0]})`);

    const concurrentRzpIds = concurrentResults.map(r => r.data.razorpayOrder.id);
    const allSameRzpId = concurrentRzpIds.every(id => id === concurrentRzpIds[0]);
    assert(allSameRzpId, `All 5 concurrent responses returned the identical Razorpay order ID (${concurrentRzpIds[0]})`);

    // Verify strictly 1 order was created in MongoDB for concurrentKey
    const dbConcurrentCount = await Order.countDocuments({ buyerId: buyer1._id, idempotencyKey: concurrentKey });
    assert(dbConcurrentCount === 1, 'MongoDB contains strictly 1 order document for the concurrent key');

    // -------------------------------------------------------------
    // Test 7: Different Customers Can Independently Use the Same Key
    // -------------------------------------------------------------
    console.log('\n--- Test 7: Different Customers Independent Key Scoping ---');
    // Buyer 2 submits checkout using idempotencyKey1 (the same key Buyer 1 used)
    const buyer2Payload = {
      idempotencyKey: idempotencyKey1,
      products: [
        { productId: testProduct1._id.toString(), quantity: 1 }
      ],
      shippingAddress: '789 Marine Drive, Mumbai, Maharashtra - 400020'
    };

    const buyer2Res = await axios.post(
      `${baseUrl}/create-razorpay-order`,
      buyer2Payload,
      {
        headers: {
          ...buyer2Headers,
          'Idempotency-Key': idempotencyKey1
        }
      }
    );

    assert(buyer2Res.status === 201, 'Buyer 2 checkout succeeds with HTTP 201 using same key name');
    assert(
      buyer2Res.data.orderId.toString() !== initialOrderId.toString(),
      'Buyer 2 receives their own distinct orderId (scoped to customer ID)'
    );

    const buyer2Order = await Order.findById(buyer2Res.data.orderId);
    assert(buyer2Order.buyerId.toString() === buyer2._id.toString(), 'Order belongs to Buyer 2');
    assert(buyer2Order.idempotencyKey === idempotencyKey1, 'Order has idempotencyKey1');

    // Verify both orders coexist peacefully in MongoDB
    const buyer1Key1Order = await Order.findOne({ buyerId: buyer1._id, idempotencyKey: idempotencyKey1 });
    const buyer2Key1Order = await Order.findOne({ buyerId: buyer2._id, idempotencyKey: idempotencyKey1 });
    assert(Boolean(buyer1Key1Order) && Boolean(buyer2Key1Order), 'Both buyer orders exist in DB without collision');
    assert(buyer1Key1Order._id.toString() !== buyer2Key1Order._id.toString(), 'Distinct order documents');

    // -------------------------------------------------------------
    // Test 8: Price Manipulation Immunity & Server-Side Calculation
    // -------------------------------------------------------------
    console.log('\n--- Test 8: Price Manipulation Immunity ---');
    const manipulatedKey = `KEY_P6_MANIPULATED_${Date.now()}`;
    const manipulatedPayload = {
      idempotencyKey: manipulatedKey,
      products: [
        {
          productId: testProduct1._id.toString(),
          quantity: 2,
          price: 0.01 // Attacker claims price is 1 paisa instead of ₹1499!
        }
      ],
      shippingAddress: '100 Security Blvd, Bengaluru - 560001'
    };

    const manipulatedRes = await axios.post(
      `${baseUrl}/create-razorpay-order`,
      manipulatedPayload,
      {
        headers: {
          ...buyer1Headers,
          'Idempotency-Key': manipulatedKey
        }
      }
    );

    assert(manipulatedRes.status === 201, 'Order created successfully');
    assert(
      manipulatedRes.data.amount === 2998.00,
      `Price tampering completely ignored: expected 2998.00, got ${manipulatedRes.data.amount}`
    );
    assert(
      manipulatedRes.data.razorpayOrder.amount === 299800,
      'Razorpay order amount in paise recalculated correctly from DB (299800 paise)'
    );

    // -------------------------------------------------------------
    // Test 9: Quantity Validation & Stock Limit Checks
    // -------------------------------------------------------------
    console.log('\n--- Test 9: Quantity and Stock Limit Rejection ---');
    // Test negative/zero quantity
    try {
      await axios.post(
        `${baseUrl}/create-razorpay-order`,
        {
          idempotencyKey: `KEY_INV_${Date.now()}`,
          products: [{ productId: testProduct1._id.toString(), quantity: 0 }],
          shippingAddress: 'Test Address'
        },
        { headers: buyer1Headers }
      );
      assert(false, 'Should reject quantity 0');
    } catch (zeroErr) {
      assert(zeroErr.response?.status === 400, 'Rejects quantity 0 with HTTP 400');
    }

    // Test quantity exceeding stock (testProduct2 stock is 20)
    try {
      await axios.post(
        `${baseUrl}/create-razorpay-order`,
        {
          idempotencyKey: `KEY_EXCESS_${Date.now()}`,
          products: [{ productId: testProduct2._id.toString(), quantity: 50 }],
          shippingAddress: 'Test Address'
        },
        { headers: buyer1Headers }
      );
      assert(false, 'Should reject excessive quantity');
    } catch (excessErr) {
      assert(excessErr.response?.status === 400, 'Rejects excessive quantity with HTTP 400');
      assert(
        excessErr.response?.data?.message?.includes('Insufficient stock'),
        'Identifies insufficient stock in error message'
      );
    }

    // -------------------------------------------------------------
    // Test 10: Genuinely New Purchase Uses a New Key
    // -------------------------------------------------------------
    console.log('\n--- Test 10: Genuinely New Purchase with New Key ---');
    const newKey = `KEY_P6_GENUINE_NEW_${Date.now()}`;
    const newPayload = {
      idempotencyKey: newKey,
      products: [
        { productId: testProduct2._id.toString(), quantity: 1 }
      ],
      shippingAddress: '999 New Street, Bengaluru - 560001'
    };

    const newRes = await axios.post(
      `${baseUrl}/create-razorpay-order`,
      newPayload,
      {
        headers: {
          ...buyer1Headers,
          'Idempotency-Key': newKey
        }
      }
    );

    assert(newRes.status === 201, 'New purchase with new key returns HTTP 201');
    assert(
      newRes.data.orderId.toString() !== initialOrderId.toString(),
      'New purchase has distinct new orderId'
    );
    assert(
      newRes.data.razorpayOrder.id !== initialRazorpayOrderId,
      'New purchase creates distinct new Razorpay order'
    );

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

runPhase6Tests();

