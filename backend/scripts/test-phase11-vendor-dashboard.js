/**
 * PHASE 11: VENDOR DASHBOARD AND PRODUCT MANAGEMENT TEST SUITE
 *
 * Verifies:
 * 1. Product CRUD with full fields (name/title, description, category, price, images, variants, SKU, stock).
 * 2. Variant-level and aggregate stock validation (non-negative, variant sum consistency).
 * 3. Strict vendor ownership: Vendor B cannot view, edit, or delete Vendor A's products (403 Forbidden).
 * 4. Immutable vendorId & system fields: Vendors cannot hijack products or overwrite inventory ledgers.
 * 5. Order visibility & isolation: Vendor B cannot view Vendor A's orders via list or by ID.
 * 6. Order lifecycle fulfillment transitions: enforces confirmed -> processing -> shipped -> delivered.
 *    Rejects invalid/jumping transitions and backward transitions.
 * 7. Financial isolation & completed-payment data: sales and earnings calculate only from paymentStatus: 'paid'.
 *    Vendor B cannot access or modify Vendor A's payout settings (403 Forbidden).
 */

const mongoose = require('mongoose');
const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Order = require('../models/Order');
const User = require('../models/User');
const Vendor = require('../models/Vendor');
const Product = require('../models/Product');
const productRouter = require('../routes/products');
const vendorRouter = require('../routes/vendors');
const orderRouter = require('../routes/orders');

const TEST_DB_URI = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/marketplace_test';
const JWT_SECRET = process.env.JWT_SECRET || 'marketplace-secret-key-2025';

let server;
let baseUrl;

let vendorUserA, vendorUserB, buyerUser;
let vendorShopA, vendorShopB;
let tokenA, tokenB, tokenBuyer;

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

async function request(method, path, options = {}) {
  const url = `${baseUrl}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(url, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  let data;
  try {
    data = await response.json();
  } catch (e) {
    data = null;
  }

  return { status: response.status, data };
}

async function setup() {
  await mongoose.connect(TEST_DB_URI);
  console.log(`Connected to database: ${mongoose.connection.name}`);
  if (mongoose.connection.name !== 'marketplace_test') {
    throw new Error('ABORT: Test suite must only run against marketplace_test database!');
  }

  const app = express();
  app.use(express.json());
  app.use('/api/products', productRouter);
  app.use('/api/vendors', vendorRouter);
  app.use('/api/orders', orderRouter);

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Phase 11 test server listening on port ${port}\n`);

  // Cleanup existing test records
  await Product.deleteMany({ title: /Phase11/ });
  await Order.deleteMany({ shippingAddress: /Phase11/ });
  await Vendor.deleteMany({ shopName: /Phase11/ });
  await User.deleteMany({ email: /phase11_.*@test\.com/ });

  // 1. Create Users
  vendorUserA = await User.create({
    username: 'phase11_vendorA',
    email: 'phase11_vendorA@test.com',
    password: 'password123',
    role: 'vendor'
  });
  tokenA = jwt.sign({ userId: vendorUserA._id }, JWT_SECRET, { expiresIn: '1h' });

  vendorUserB = await User.create({
    username: 'phase11_vendorB',
    email: 'phase11_vendorB@test.com',
    password: 'password123',
    role: 'vendor'
  });
  tokenB = jwt.sign({ userId: vendorUserB._id }, JWT_SECRET, { expiresIn: '1h' });

  buyerUser = await User.create({
    username: 'phase11_buyer',
    email: 'phase11_buyer@test.com',
    password: 'password123',
    role: 'buyer'
  });
  tokenBuyer = jwt.sign({ userId: buyerUser._id }, JWT_SECRET, { expiresIn: '1h' });

  // 2. Create Approved Vendor Shops
  vendorShopA = await Vendor.create({
    userId: vendorUserA._id,
    shopName: 'Phase11 Shop A',
    shopDescription: 'Quality electronics and accessories',
    approvalStatus: 'approved',
    onboardingComplete: true,
    totalEarnings: 0,
    totalPaidEarnings: 0
  });

  vendorShopB = await Vendor.create({
    userId: vendorUserB._id,
    shopName: 'Phase11 Shop B',
    shopDescription: 'Handmade crafts and home decor',
    approvalStatus: 'approved',
    onboardingComplete: true,
    totalEarnings: 0,
    totalPaidEarnings: 0
  });
}

async function runTests() {
  console.log('=== TEST SUITE: Vendor Dashboard and Product Management ===\n');

  let prodAId, prodAVariantsId;

  // -------------------------------------------------------------
  console.log('--- TEST 1: Product Creation with Full Fields & Validation ---');
  // -------------------------------------------------------------
  {
    // 1. Negative price validation
    const resNegPrice = await request('POST', '/api/products', {
      token: tokenA,
      body: {
        title: 'Phase11 Invalid Product',
        description: 'Test product',
        price: -50,
        imageUrl: 'https://example.com/test.jpg',
        category: 'Electronics'
      }
    });
    assert(resNegPrice.status === 400, 'Rejects negative product price with 400 Bad Request');

    // 2. Negative stock validation
    const resNegStock = await request('POST', '/api/products', {
      token: tokenA,
      body: {
        title: 'Phase11 Invalid Stock',
        description: 'Test product',
        price: 100,
        stock: -10,
        imageUrl: 'https://example.com/test.jpg',
        category: 'Electronics'
      }
    });
    assert(resNegStock.status === 400, 'Rejects negative product stock with 400 Bad Request');

    // 3. Negative variant stock validation
    const resNegVarStock = await request('POST', '/api/products', {
      token: tokenA,
      body: {
        title: 'Phase11 Invalid Variant',
        description: 'Test product',
        price: 100,
        imageUrl: 'https://example.com/test.jpg',
        category: 'Electronics',
        variants: [
          { name: 'Red', stock: -5, price: 100 }
        ]
      }
    });
    assert(resNegVarStock.status === 400, 'Rejects negative variant stock with 400 Bad Request');

    // 4. Duplicate variant SKU rejection
    const resDupSku = await request('POST', '/api/products', {
      token: tokenA,
      body: {
        title: 'Phase11 Dup SKU Product',
        description: 'Test product',
        price: 100,
        imageUrl: 'https://example.com/test.jpg',
        category: 'Electronics',
        variants: [
          { name: 'Red', sku: 'SKU-001', stock: 5, price: 100 },
          { name: 'Blue', sku: 'SKU-001', stock: 5, price: 100 }
        ]
      }
    });
    assert(resDupSku.status === 400, 'Rejects duplicate variant SKU within product with 400 Bad Request');

    // 5. Valid simple product creation with top-level SKU & images array
    const resSimple = await request('POST', '/api/products', {
      token: tokenA,
      body: {
        name: 'Phase11 Premium Wireless Mouse',
        description: 'Ergonomic 2.4GHz optical mouse',
        category: 'Electronics',
        price: 899,
        sku: 'MS-WL-001',
        stock: 25,
        images: ['https://example.com/mouse-1.jpg', 'https://example.com/mouse-2.jpg'],
        vendorId: vendorShopA._id
      }
    });
    assert(resSimple.status === 201, 'Creates product with name/title, description, price, sku, stock (201 Created)');
    assert(resSimple.data.title === 'Phase11 Premium Wireless Mouse', 'Stores title from name input');
    assert(resSimple.data.sku === 'MS-WL-001', 'Stores product SKU correctly');
    assert(resSimple.data.stock === 25, 'Stores product stock correctly');
    assert(resSimple.data.imageUrl === 'https://example.com/mouse-1.jpg', 'Sets primary imageUrl from images array');
    assert(resSimple.data.images.length === 2, 'Stores all product gallery images');
    prodAId = resSimple.data._id;

    // 6. Valid product creation with variants & automatic stock calculation
    const resVariants = await request('POST', '/api/products', {
      token: tokenA,
      body: {
        title: 'Phase11 Mechanical Keyboard',
        description: 'RGB mechanical keyboard with swappable switches',
        category: 'Electronics',
        price: 2499,
        sku: 'KB-MECH-001',
        imageUrl: 'https://example.com/keyboard.jpg',
        vendorId: vendorShopA._id,
        variants: [
          { name: 'Blue Switch', sku: 'KB-BLU', price: 2499, stock: 15 },
          { name: 'Red Switch', sku: 'KB-RED', price: 2599, stock: 20 },
          { name: 'Brown Switch', sku: 'KB-BRN', price: 2699, stock: 10 }
        ]
      }
    });
    assert(resVariants.status === 201, 'Creates product with variants (201 Created)');
    assert(resVariants.data.stock === 45, 'Aggregate stock automatically equals sum of variant stocks (15+20+10=45)');
    assert(resVariants.data.variants.length === 3, 'Stores all 3 variants correctly');
    prodAVariantsId = resVariants.data._id;
  }

  // -------------------------------------------------------------
  console.log('\n--- TEST 2: Product Listing & Inventory View ---');
  // -------------------------------------------------------------
  {
    // Vendor A views their own products
    const resA = await request('GET', `/api/products/vendor/my-products?vendorId=${vendorShopA._id}`, { token: tokenA });
    assert(resA.status === 200, 'Vendor A fetches their products successfully (200 OK)');
    assert(resA.data.length === 2, 'Vendor A sees both created products');
    assert(resA.data.every(p => p.vendorId.toString() === vendorShopA._id.toString()), 'All returned products belong to Vendor A');

    // Vendor B views their own products (should be empty initially)
    const resB = await request('GET', `/api/products/vendor/my-products?vendorId=${vendorShopB._id}`, { token: tokenB });
    assert(resB.status === 200, 'Vendor B fetches their products successfully (200 OK)');
    assert(resB.data.length === 0, 'Vendor B sees 0 products initially');
  }

  // -------------------------------------------------------------
  console.log('\n--- TEST 3: Strict Product Ownership & Isolation ---');
  // -------------------------------------------------------------
  {
    // 1. Vendor B attempts to view Vendor A products by passing Vendor A shopId
    const resCrossView = await request('GET', `/api/products/vendor/my-products?vendorId=${vendorShopA._id}`, { token: tokenB });
    assert(resCrossView.status === 403, 'Vendor B cannot view Vendor A products via vendorId param (403 Forbidden)');

    // 2. Vendor B attempts to update Vendor A product
    const resCrossEdit = await request('PUT', `/api/products/${prodAId}`, {
      token: tokenB,
      body: {
        title: 'Hacked Title By Vendor B',
        price: 10
      }
    });
    assert(resCrossEdit.status === 403, 'Vendor B cannot edit Vendor A product (403 Forbidden)');

    // Verify product A was not changed
    const checkUnchanged = await Product.findById(prodAId);
    assert(checkUnchanged.title === 'Phase11 Premium Wireless Mouse', 'Product title untouched by unauthorized edit');

    // 3. Vendor B attempts to delete Vendor A product
    const resCrossDel = await request('DELETE', `/api/products/${prodAId}`, { token: tokenB });
    assert(resCrossDel.status === 403, 'Vendor B cannot delete Vendor A product (403 Forbidden)');

    const checkStillExists = await Product.findById(prodAId);
    assert(Boolean(checkStillExists), 'Product remains in database after unauthorized delete attempt');
  }

  // -------------------------------------------------------------
  console.log('\n--- TEST 4: Stock & Variant Updates (Safe Non-Negative & Aggregate Sync) ---');
  // -------------------------------------------------------------
  {
    // 1. Update simple product stock to negative -> rejected
    const resNegStock = await request('PUT', `/api/products/${prodAId}`, {
      token: tokenA,
      body: { stock: -15 }
    });
    assert(resNegStock.status === 400, 'PUT rejects negative stock update with 400 Bad Request');

    // 2. Update simple product stock safely
    const resValidStock = await request('PUT', `/api/products/${prodAId}`, {
      token: tokenA,
      body: { stock: 35, price: 949 }
    });
    assert(resValidStock.status === 200, 'PUT updates simple product stock and price (200 OK)');
    assert(resValidStock.data.stock === 35, 'Stock updated to 35');
    assert(resValidStock.data.price === 949, 'Price updated to 949');

    // 3. Update variant stocks safely and ensure aggregate stock re-computes
    const resVarUpdate = await request('PUT', `/api/products/${prodAVariantsId}`, {
      token: tokenA,
      body: {
        variants: [
          { name: 'Blue Switch', sku: 'KB-BLU', price: 2499, stock: 20 },
          { name: 'Red Switch', sku: 'KB-RED', price: 2599, stock: 30 }
        ]
      }
    });
    assert(resVarUpdate.status === 200, 'PUT updates product variants (200 OK)');
    assert(resVarUpdate.data.stock === 50, 'Aggregate stock re-synchronized to sum of updated variants (20+30=50)');
    assert(resVarUpdate.data.variants.length === 2, 'Variant list updated to 2 variants');

    // 4. Vendor A attempts to hijack/reassign vendorId on PUT
    const resHijack = await request('PUT', `/api/products/${prodAId}`, {
      token: tokenA,
      body: { vendorId: vendorShopB._id }
    });
    assert(resHijack.status === 200, 'PUT succeeded');
    const checkVendorId = await Product.findById(prodAId);
    assert(
      checkVendorId.vendorId.toString() === vendorShopA._id.toString(),
      'Immutable vendorId: Product remains owned by Vendor Shop A, hijack ignored'
    );
  }

  // -------------------------------------------------------------
  console.log('\n--- TEST 5: Order Visibility, Item Details & Isolation ---');
  // -------------------------------------------------------------
  let orderAId;
  {
    // Create an order for Vendor A
    const orderDoc = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorShopA._id,
      products: [
        {
          productId: prodAId,
          quantity: 2,
          price: 949,
          inventoryState: 'deducted'
        },
        {
          productId: prodAVariantsId,
          variantName: 'Red Switch',
          variantSku: 'KB-RED',
          quantity: 1,
          price: 2599,
          inventoryState: 'deducted'
        }
      ],
      totalAmount: 4497,
      vendorEarning: 4047.30,
      adminCommission: 449.70,
      paymentStatus: 'paid',
      status: 'confirmed',
      shippingAddress: 'Phase11 Buyer Address, 123 Tech Park, Bengaluru, Karnataka - 560001. Phone: 9876543210'
    });
    orderAId = orderDoc._id;

    // 1. Vendor A views their orders
    const resOrdersA = await request('GET', '/api/orders/vendor/my-orders', { token: tokenA });
    assert(resOrdersA.status === 200, 'Vendor A retrieves their orders (200 OK)');
    assert(resOrdersA.data.length === 1, 'Vendor A sees 1 order');
    const retrievedOrder = resOrdersA.data[0];
    assert(retrievedOrder.products.length === 2, 'Order item details include all products');
    assert(retrievedOrder.products[1].variantName === 'Red Switch', 'Order item contains variant details');
    assert(retrievedOrder.vendorEarning === 4047.30, 'Order displays correct vendor earning');

    // 2. Vendor A views single order by ID
    const resSingleOrderA = await request('GET', `/api/orders/${orderAId}`, { token: tokenA });
    assert(resSingleOrderA.status === 200, 'Vendor A can view their single order by ID (200 OK)');

    // 3. Vendor B attempts to view Vendor A orders via list with query param
    const resOrdersBQuery = await request('GET', `/api/orders/vendor/my-orders?vendorId=${vendorShopA._id}`, { token: tokenB });
    assert(resOrdersBQuery.status === 403, 'Vendor B cannot query Vendor A orders (403 Forbidden)');

    // 4. Vendor B calls GET /api/orders/vendor/my-orders (sees only their own)
    const resOrdersB = await request('GET', '/api/orders/vendor/my-orders', { token: tokenB });
    assert(resOrdersB.data.length === 0, 'Vendor B sees 0 orders in their list');

    // 5. Vendor B attempts to view Vendor A single order by ID
    const resSingleOrderB = await request('GET', `/api/orders/${orderAId}`, { token: tokenB });
    assert(resSingleOrderB.status === 403, 'Vendor B cannot view Vendor A single order by ID (403 Forbidden)');
  }

  // -------------------------------------------------------------
  console.log('\n--- TEST 6: Permitted Order Status Transitions ---');
  // -------------------------------------------------------------
  {
    // Order is currently 'confirmed'
    // 1. Vendor B attempts to change status -> 403 Forbidden
    const resBStatus = await request('PUT', `/api/orders/${orderAId}/status`, {
      token: tokenB,
      body: { status: 'processing' }
    });
    assert(resBStatus.status === 403, 'Vendor B cannot update status of Vendor A order (403 Forbidden)');

    // 2. Vendor A attempts invalid jump: confirmed -> delivered
    const resJump = await request('PUT', `/api/orders/${orderAId}/status`, {
      token: tokenA,
      body: { status: 'delivered' }
    });
    assert(resJump.status === 400, 'Rejects invalid lifecycle jump confirmed -> delivered (400 Bad Request)');

    // 3. Vendor A attempts directly setting refunded
    const resRefunded = await request('PUT', `/api/orders/${orderAId}/status`, {
      token: tokenA,
      body: { status: 'refunded' }
    });
    assert(resRefunded.status === 403, 'Vendors cannot directly set status to refunded (403 Forbidden)');

    // 4. Valid step 1: confirmed -> processing
    const resStep1 = await request('PUT', `/api/orders/${orderAId}/status`, {
      token: tokenA,
      body: { status: 'processing' }
    });
    assert(resStep1.status === 200, 'Valid transition: confirmed -> processing (200 OK)');
    assert(resStep1.data.status === 'processing', 'Order status is now processing');

    // 5. Valid step 2: processing -> shipped
    const resStep2 = await request('PUT', `/api/orders/${orderAId}/status`, {
      token: tokenA,
      body: { status: 'shipped' }
    });
    assert(resStep2.status === 200, 'Valid transition: processing -> shipped (200 OK)');
    assert(resStep2.data.status === 'shipped', 'Order status is now shipped');

    // 6. Valid step 3: shipped -> delivered
    const resStep3 = await request('PUT', `/api/orders/${orderAId}/status`, {
      token: tokenA,
      body: { status: 'delivered' }
    });
    assert(resStep3.status === 200, 'Valid transition: shipped -> delivered (200 OK)');
    assert(resStep3.data.status === 'delivered', 'Order status is now delivered');

    // 7. Backward transition attempt: delivered -> shipped
    const resBackward = await request('PUT', `/api/orders/${orderAId}/status`, {
      token: tokenA,
      body: { status: 'shipped' }
    });
    assert(resBackward.status === 400, 'Rejects backward transition: delivered -> shipped (400 Bad Request)');
  }

  // -------------------------------------------------------------
  console.log('\n--- TEST 7: Financial Isolation & Completed Payment Accounting ---');
  // -------------------------------------------------------------
  {
    // Create an unpaid / pending order for Vendor A (should NOT count toward sales/earnings)
    await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorShopA._id,
      products: [{ productId: prodAId, quantity: 1, price: 949 }],
      totalAmount: 949,
      vendorEarning: 854.10,
      adminCommission: 94.90,
      paymentStatus: 'created', // UNPAID
      status: 'pending',
      shippingAddress: 'Phase11 Unpaid Address'
    });

    // 1. Fetch Vendor A payout settings / earnings
    const resSettingsA = await request('GET', `/api/vendors/${vendorShopA._id}/payout-settings`, { token: tokenA });
    assert(resSettingsA.status === 200, 'Vendor A retrieves payout settings and sales volume (200 OK)');
    // Only 1 paid order (orderA: totalAmount 4497, adminCommission 449.70, vendorEarning 4047.30)
    assert(resSettingsA.data.paidOrdersCount === 1, 'Only completed/captured (paid) orders are counted (1 order)');
    assert(resSettingsA.data.totalOrderVolume === 4497, 'Sales volume excludes unpaid order (₹4497)');
    assert(resSettingsA.data.totalCommissionPaid === 449.70, 'Commission reflects only paid order (₹449.70)');
    assert(resSettingsA.data.totalEarnings === 4047.30, 'Total earnings reflect only paid order (₹4047.30)');

    // 2. Fetch earnings summary for all shops of Vendor A
    const resSummaryA = await request('GET', '/api/vendors/my/earnings-summary', { token: tokenA });
    assert(resSummaryA.status === 200, 'Vendor A retrieves earnings summary (200 OK)');
    assert(resSummaryA.data.length >= 1, 'Returns summary list for Vendor A');
    const shopSummary = resSummaryA.data.find(s => s.vendorId.toString() === vendorShopA._id.toString());
    assert(shopSummary.paidOrdersCount === 1, 'Earnings summary paidOrdersCount is 1');
    assert(shopSummary.totalOrderVolume === 4497, 'Earnings summary totalOrderVolume is 4497');

    // 3. Vendor B attempts to view Vendor A payout settings / financials
    const resSettingsB = await request('GET', `/api/vendors/${vendorShopA._id}/payout-settings`, { token: tokenB });
    assert(resSettingsB.status === 403, 'Vendor B cannot view Vendor A payout settings / financials (403 Forbidden)');

    // 4. Vendor B attempts to modify Vendor A payout settings
    const resEditPayoutB = await request('PUT', `/api/vendors/${vendorShopA._id}/payout-settings`, {
      token: tokenB,
      body: { upiId: 'hacker@upi' }
    });
    assert(resEditPayoutB.status === 403, 'Vendor B cannot modify Vendor A payout settings (403 Forbidden)');

    // 5. Vendor B views their own earnings summary -> 0 sales, 0 earnings
    const resSummaryB = await request('GET', '/api/vendors/my/earnings-summary', { token: tokenB });
    const shopSummaryB = resSummaryB.data.find(s => s.vendorId.toString() === vendorShopB._id.toString());
    assert(shopSummaryB.paidOrdersCount === 0, 'Vendor B sees 0 paid orders');
    assert(shopSummaryB.totalOrderVolume === 0, 'Vendor B sees 0 sales volume');
    assert(shopSummaryB.totalEarnings === 0, 'Vendor B sees 0 earnings');
  }

  // -------------------------------------------------------------
  console.log('\n--- TEST 8: Product Deletion by Owner ---');
  // -------------------------------------------------------------
  {
    // Vendor A deletes their own product
    const resDel = await request('DELETE', `/api/products/${prodAId}`, { token: tokenA });
    assert(resDel.status === 200, 'Owner can delete their own product (200 OK)');

    const checkDeleted = await Product.findById(prodAId);
    assert(checkDeleted === null, 'Product successfully removed from database');
  }

  // -------------------------------------------------------------
  console.log('\n======================================================');
  console.log(`TOTAL TESTS: ${testCount} | PASSED: ${passCount} | FAILED: ${failCount}`);
  console.log('======================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

async function teardown() {
  try {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    await Product.deleteMany({ title: /Phase11/ });
    await Order.deleteMany({ shippingAddress: /Phase11/ });
    await Vendor.deleteMany({ shopName: /Phase11/ });
    await User.deleteMany({ email: /phase11_.*@test\.com/ });
    await mongoose.disconnect();
    console.log('Teardown complete.');
  } catch (err) {
    console.error('Teardown error:', err);
  }
}

(async () => {
  try {
    await setup();
    await runTests();
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  } finally {
    await teardown();
  }
})();
