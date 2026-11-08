/**
 * Phase 15 Verification Suite: API Documentation, Validation & Error Handling
 * 
 * Verifies:
 * 1. Global JSON error handling (malformed JSON payload returns 400, no stack trace leakage).
 * 2. Unmatched API route returns JSON 404.
 * 3. Authentication enforcement (missing/invalid token returns 401).
 * 4. Role-based authorization enforcement (buyer cannot access admin/vendor routes).
 * 5. Privilege escalation protection (register cannot assign admin role).
 * 6. ObjectId validation on route params and body IDs (returns 400, not 500).
 * 7. Client price tampering protection (cart/checkout uses server product pricing).
 * 8. Ownership isolation (users cannot access other users' addresses, vendors cannot edit other vendors' products).
 * 9. Order status transition validation & lifecycle rules.
 * 10. Self-demotion lockout protection for admins.
 * 11. Validation of required fields, formats (phone, postal code), and enums.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const { app } = require('../server');
const User = require('../models/User');
const Vendor = require('../models/Vendor');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Address = require('../models/Address');
const CartItem = require('../models/CartItem');

let server;
let baseUrl;
let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    testsPassed++;
    console.log(`  ✅ ${message}`);
  } else {
    testsFailed++;
    console.error(`  ❌ FAILED: ${message}`);
  }
}

// Helper to make HTTP requests
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

function generateToken(userId, role = 'buyer') {
  return jwt.sign(
    { userId: userId.toString(), role },
    process.env.JWT_SECRET || 'marketplace-secret-key-2025',
    { expiresIn: '1h' }
  );
}

async function runPhase15Verification() {
  const uri = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/marketplace_test';
  console.log(`\n======================================================`);
  console.log(`Starting Phase 15 API Documentation & Validation Tests`);
  console.log(`Target Database: ${uri}`);
  console.log(`======================================================\n`);

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }

  // Start test server on random high port
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server running on port ${port}\n`);

  try {
    // -------------------------------------------------------------
    // SECTION 1: Error Handling, Malformed JSON & 404
    // -------------------------------------------------------------
    console.log('--- Section 1: Error Handling & Malformed Payload Protection ---');

    // Test malformed JSON
    const malformedRes = await request('POST', '/api/auth/login', {
      rawBody: '{"email": "bad-json-payload',
      headers: { 'Content-Type': 'application/json' }
    });
    assert(malformedRes.status === 400, `Malformed JSON returns 400 Bad Request (got ${malformedRes.status})`);
    assert(malformedRes.body && malformedRes.body.success === false, 'Malformed JSON returns success: false');
    assert(malformedRes.body && malformedRes.body.message.includes('Invalid JSON payload'), 'Malformed JSON returns helpful message without stack trace');
    assert(!malformedRes.raw.includes('node_modules') && !malformedRes.raw.includes('SyntaxError:'), 'Stack trace is not leaked');

    // Test unmatched API route
    const notFoundRes = await request('GET', '/api/v1/unknown-endpoint');
    assert(notFoundRes.status === 404, `Unknown API route returns 404 Not Found (got ${notFoundRes.status})`);
    assert(notFoundRes.body && notFoundRes.body.success === false, 'Unknown route returns success: false in JSON format');
    assert(notFoundRes.body && notFoundRes.body.message.includes('API route not found'), 'Unknown route response includes clear not-found message');

    // -------------------------------------------------------------
    // SECTION 2: Authentication & Role Authorization Enforcement
    // -------------------------------------------------------------
    console.log('\n--- Section 2: Authentication & Role Authorization Enforcement ---');

    // Missing token on protected routes
    const unauthCart = await request('GET', '/api/cart');
    assert(unauthCart.status === 401, `Unauthenticated request to /api/cart returns 401 (got ${unauthCart.status})`);

    const unauthOrders = await request('GET', '/api/orders/buyer/my-orders');
    assert(unauthOrders.status === 401, `Unauthenticated request to /api/orders/buyer/my-orders returns 401 (got ${unauthOrders.status})`);

    const unauthAdmin = await request('GET', '/api/admin/dashboard');
    assert(unauthAdmin.status === 401, `Unauthenticated request to /api/admin/dashboard returns 401 (got ${unauthAdmin.status})`);

    // Create test users for role isolation checks
    const buyerId = new mongoose.Types.ObjectId();
    const vendorUserId = new mongoose.Types.ObjectId();
    const adminId = new mongoose.Types.ObjectId();

    await User.create([
      { _id: buyerId, username: 'test_buyer_p15', email: 'buyer_p15@test.com', password: 'hash', role: 'buyer' },
      { _id: vendorUserId, username: 'test_vendor_p15', email: 'vendor_p15@test.com', password: 'hash', role: 'vendor' },
      { _id: adminId, username: 'test_admin_p15', email: 'admin_p15@test.com', password: 'hash', role: 'admin' }
    ]);

    const buyerToken = generateToken(buyerId, 'buyer');
    const vendorToken = generateToken(vendorUserId, 'vendor');
    const adminToken = generateToken(adminId, 'admin');

    // Buyer accessing Admin endpoint
    const buyerToAdmin = await request('GET', '/api/admin/dashboard', {
      headers: { Authorization: `Bearer ${buyerToken}` }
    });
    assert(buyerToAdmin.status === 403, `Buyer accessing admin dashboard returns 403 Forbidden (got ${buyerToAdmin.status})`);

    // Buyer accessing Vendor endpoint
    const buyerToVendor = await request('GET', '/api/vendors/my-shops', {
      headers: { Authorization: `Bearer ${buyerToken}` }
    });
    assert(buyerToVendor.status === 403, `Buyer accessing vendor shops returns 403 Forbidden (got ${buyerToVendor.status})`);

    // Vendor accessing Admin endpoint
    const vendorToAdmin = await request('GET', '/api/admin/dashboard', {
      headers: { Authorization: `Bearer ${vendorToken}` }
    });
    assert(vendorToAdmin.status === 403, `Vendor accessing admin dashboard returns 403 Forbidden (got ${vendorToAdmin.status})`);

    // Privilege escalation protection during registration
    const regEscalation = await request('POST', '/api/auth/register', {
      body: {
        username: 'sneaky_admin_attempt',
        email: 'sneaky@test.com',
        password: 'Password@123',
        role: 'admin' // Attempting to self-assign admin!
      }
    });
    assert(regEscalation.status === 201, 'Registration succeeded');
    assert(regEscalation.body.user.role === 'buyer', `Client-supplied 'admin' role was overridden to 'buyer' (got '${regEscalation.body.user.role}')`);

    // Clean up only the registration attempt user
    await User.deleteMany({ email: 'sneaky@test.com' });

    // -------------------------------------------------------------
    // SECTION 3: ObjectId Validation & Malformed Input Handling
    // -------------------------------------------------------------
    console.log('\n--- Section 3: ObjectId Validation & Malformed Input Handling ---');

    // Malformed ID in Products route
    const badProdId = await request('GET', '/api/products/not-a-valid-object-id');
    assert(badProdId.status === 400, `Malformed product ID in path returns 400 Bad Request (got ${badProdId.status})`);

    // Malformed ID in Orders route
    const badOrderId = await request('GET', '/api/orders/invalid-hex-id', {
      headers: { Authorization: `Bearer ${buyerToken}` }
    });
    assert(badOrderId.status === 400, `Malformed order ID in path returns 400 Bad Request (got ${badOrderId.status})`);

    // Malformed ID in Address route
    const badAddrId = await request('GET', '/api/addresses/invalid-id-123', {
      headers: { Authorization: `Bearer ${buyerToken}` }
    });
    assert(badAddrId.status === 400, `Malformed address ID in path returns 400 Bad Request (got ${badAddrId.status})`);

    // Malformed ID in Disputes reply route
    const badDisputeId = await request('PUT', '/api/disputes/123-bad-id/reply', {
      headers: { Authorization: `Bearer ${vendorToken}` },
      body: { reply: 'Hello' }
    });
    assert(badDisputeId.status === 400, `Malformed dispute ID in path returns 400 Bad Request (got ${badDisputeId.status})`);

    // Malformed ID in Cart Update route
    const badCartItemId = await request('PUT', '/api/cart/update', {
      headers: { Authorization: `Bearer ${buyerToken}` },
      body: { cartItemId: 'malformed-cart-id', quantity: 2 }
    });
    assert(badCartItemId.status === 400, `Malformed cartItemId in body returns 400 Bad Request (got ${badCartItemId.status})`);

    // -------------------------------------------------------------
    // SECTION 4: Data Validation (Ranges, Enums, Formats)
    // -------------------------------------------------------------
    console.log('\n--- Section 4: Data Validation (Ranges, Enums, Formats) ---');

    // Setup an approved vendor shop for product validation
    const testVendorUser = await User.create({
      username: 'p15_vendor_v',
      email: 'p15_vendor_v@test.com',
      password: 'hash',
      role: 'vendor'
    });
    const vToken = generateToken(testVendorUser._id, 'vendor');

    const testShop = await Vendor.create({
      userId: testVendorUser._id,
      shopName: 'P15 Validation Shop',
      approvalStatus: 'approved',
      onboardingComplete: true
    });

    // Product validation: Negative price
    const negPriceProd = await request('POST', '/api/products', {
      headers: { Authorization: `Bearer ${vToken}` },
      body: {
        vendorId: testShop._id.toString(),
        title: 'Negative Price Item',
        description: 'Test',
        price: -50,
        imageUrl: 'http://example.com/img.jpg'
      }
    });
    assert(negPriceProd.status === 400, `Negative product price returns 400 Bad Request (got ${negPriceProd.status})`);

    // Product validation: Missing description
    const missingDescProd = await request('POST', '/api/products', {
      headers: { Authorization: `Bearer ${vToken}` },
      body: {
        vendorId: testShop._id.toString(),
        title: 'No Desc Item',
        price: 100,
        imageUrl: 'http://example.com/img.jpg'
      }
    });
    assert(missingDescProd.status === 400, `Missing product description returns 400 Bad Request (got ${missingDescProd.status})`);

    // Product validation: Variant with duplicate SKU
    const dupSkuProd = await request('POST', '/api/products', {
      headers: { Authorization: `Bearer ${vToken}` },
      body: {
        vendorId: testShop._id.toString(),
        title: 'Duplicate SKU Item',
        description: 'Test item',
        price: 100,
        imageUrl: 'http://example.com/img.jpg',
        variants: [
          { name: 'Var 1', sku: 'DUPLICATE-SKU', price: 100, stock: 5 },
          { name: 'Var 2', sku: 'DUPLICATE-SKU', price: 100, stock: 5 }
        ]
      }
    });
    assert(dupSkuProd.status === 400, `Duplicate variant SKU within product returns 400 Bad Request (got ${dupSkuProd.status})`);

    // Address validation: Invalid phone format
    const testBuyerUser = await User.create({
      username: 'p15_buyer_b',
      email: 'p15_buyer_b@test.com',
      password: 'hash',
      role: 'buyer'
    });
    const bToken = generateToken(testBuyerUser._id, 'buyer');

    const badPhoneAddr = await request('POST', '/api/addresses', {
      headers: { Authorization: `Bearer ${bToken}` },
      body: {
        fullName: 'Test User',
        phone: '12345', // Invalid length / prefix
        addressLine1: 'Line 1',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001'
      }
    });
    assert(badPhoneAddr.status === 400, `Invalid phone format returns 400 Bad Request (got ${badPhoneAddr.status})`);

    // Address validation: Invalid postal code format
    const badPinAddr = await request('POST', '/api/addresses', {
      headers: { Authorization: `Bearer ${bToken}` },
      body: {
        fullName: 'Test User',
        phone: '9876543210',
        addressLine1: 'Line 1',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: 'ABC99' // Non-numeric postal code
      }
    });
    assert(badPinAddr.status === 400, `Invalid postal code format returns 400 Bad Request (got ${badPinAddr.status})`);

    // Dispute validation: Invalid reason enum
    const badReasonDispute = await request('POST', '/api/disputes', {
      headers: { Authorization: `Bearer ${bToken}` },
      body: {
        orderId: new mongoose.Types.ObjectId().toString(),
        reason: 'i_just_dont_like_it', // Not in enum
        description: 'Random description'
      }
    });
    assert(badReasonDispute.status === 400, `Invalid dispute reason enum returns 400 Bad Request (got ${badReasonDispute.status})`);

    // Order status validation: Invalid status enum
    const badStatusOrder = await request('PUT', `/api/orders/${new mongoose.Types.ObjectId()}/status`, {
      headers: { Authorization: `Bearer ${vToken}` },
      body: { status: 'invalid_status_enum' }
    });
    assert(badStatusOrder.status === 400, `Invalid order status enum returns 400 Bad Request (got ${badStatusOrder.status})`);

    // -------------------------------------------------------------
    // SECTION 5: Ownership Isolation & Parameter Tampering Protection
    // -------------------------------------------------------------
    console.log('\n--- Section 5: Ownership Isolation & Parameter Tampering ---');

    // Create a product owned by Vendor 1
    const validProduct = await Product.create({
      vendorId: testShop._id,
      title: 'Protected Product',
      description: 'Test description',
      price: 500,
      imageUrl: 'http://example.com/img.jpg',
      category: 'Electronics',
      stock: 20
    });

    // Create a second vendor user
    const otherVendorUser = await User.create({
      username: 'p15_other_vendor',
      email: 'p15_other_vendor@test.com',
      password: 'hash',
      role: 'vendor'
    });
    const otherVToken = generateToken(otherVendorUser._id, 'vendor');

    // Vendor 2 tries to update Vendor 1's product
    const tamperProd = await request('PUT', `/api/products/${validProduct._id}`, {
      headers: { Authorization: `Bearer ${otherVToken}` },
      body: { title: 'Hacked Product Title' }
    });
    assert(tamperProd.status === 403, `Vendor 2 modifying Vendor 1's product returns 403 Forbidden (got ${tamperProd.status})`);

    // Address ownership isolation
    const buyer1Addr = await Address.create({
      userId: testBuyerUser._id,
      fullName: 'Buyer 1 Name',
      phone: '9876543210',
      addressLine1: 'Line 1',
      city: 'Delhi',
      state: 'Delhi',
      postalCode: '110001',
      isDefault: true
    });

    // Create Buyer 2
    const otherBuyerUser = await User.create({
      username: 'p15_other_buyer',
      email: 'p15_other_buyer@test.com',
      password: 'hash',
      role: 'buyer'
    });
    const otherBToken = generateToken(otherBuyerUser._id, 'buyer');

    // Buyer 2 tries to read Buyer 1's address
    const tamperAddrGet = await request('GET', `/api/addresses/${buyer1Addr._id}`, {
      headers: { Authorization: `Bearer ${otherBToken}` }
    });
    assert(tamperAddrGet.status === 403, `Buyer 2 accessing Buyer 1's address returns 403 Forbidden (got ${tamperAddrGet.status})`);

    // Cart pricing protection: Client cannot supply artificial low price
    const addCartRes = await request('POST', '/api/cart/add', {
      headers: { Authorization: `Bearer ${bToken}` },
      body: {
        productId: validProduct._id.toString(),
        quantity: 2,
        price: 1 // Malicious client claims price is 1 rupee!
      }
    });
    assert(addCartRes.status === 201 || addCartRes.status === 200, `Cart item added successfully (status ${addCartRes.status})`);

    const cartSummary = await request('GET', '/api/cart/summary', {
      headers: { Authorization: `Bearer ${bToken}` }
    });
    assert(cartSummary.status === 200, 'Cart summary retrieved');
    const calculatedTotal = cartSummary.body?.total !== undefined ? cartSummary.body.total : cartSummary.body?.subtotal;
    assert(calculatedTotal === 1000, `Server-calculated price enforced (500 * 2 = 1000, got ${calculatedTotal})`);

    // Admin self-demotion protection
    const testAdminUser = await User.create({
      username: 'p15_active_admin',
      email: 'p15_active_admin@test.com',
      password: 'hash',
      role: 'admin'
    });
    const aToken = generateToken(testAdminUser._id, 'admin');

    const demoteSelf = await request('PUT', `/api/admin/users/${testAdminUser._id}/role`, {
      headers: { Authorization: `Bearer ${aToken}` },
      body: { role: 'buyer' } // Admin attempting to demote themselves
    });
    assert(demoteSelf.status === 400, `Admin self-demotion blocked with 400 Bad Request (got ${demoteSelf.status})`);
    assert(demoteSelf.body.message.includes('Cannot demote yourself'), 'Self-demotion error message explains lockout prevention');

    // Clean up test data
    await Product.deleteMany({ _id: validProduct._id });
    await Vendor.deleteMany({ _id: testShop._id });
    await Address.deleteMany({ userId: testBuyerUser._id });
    await CartItem.deleteMany({ userId: testBuyerUser._id });
    await User.deleteMany({
      email: { $in: [
        'buyer_p15@test.com', 'vendor_p15@test.com', 'admin_p15@test.com',
        'p15_vendor_v@test.com', 'p15_buyer_b@test.com', 'p15_other_vendor@test.com',
        'p15_other_buyer@test.com', 'p15_active_admin@test.com'
      ] }
    });

    // -------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------
    console.log(`\n======================================================`);
    console.log(`Phase 15 Verification Summary:`);
    console.log(`Passed: ${testsPassed}`);
    console.log(`Failed: ${testsFailed}`);
    console.log(`======================================================\n`);

    if (testsFailed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Test suite uncaught error:', err);
    process.exit(1);
  } finally {
    if (server) server.close();
    await mongoose.connection.close();
  }
}

runPhase15Verification();
