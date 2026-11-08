/**
 * PHASE 10: CUSTOMER ADDRESS BOOK TEST SUITE
 *
 * Verifies:
 * 1. CRUD operations for customer address book (add, view, edit, delete).
 * 2. Backend validation for required fields, phone format, and 6-digit postal code format.
 * 3. Default address uniqueness: at most one default address per customer, first address
 *    auto-defaulted, updating default atomically demotes previous default, deleting default
 *    promotes another address.
 * 4. Strict ownership enforcement: customer B cannot access, modify, delete, or default customer A's address.
 * 5. Order snapshot invariance: editing or deleting an address after checkout never alters existing orders.
 * 6. Checkout integration: supports saved address selection as well as direct manual checkout.
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
const Address = require('../models/Address');
const addressRouter = require('../routes/addresses');
const ordersRouter = require('../routes/orders');

const TEST_DB_URI = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/marketplace_test';
const JWT_SECRET = process.env.JWT_SECRET || 'marketplace-secret-key-2025';

let server;
let baseUrl;

let userA, userB, vendorUser;
let vendorDoc, productDoc;
let tokenA, tokenB;

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
  app.use('/api/addresses', addressRouter);
  app.use('/api/orders', ordersRouter);

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Phase 10 test server listening on port ${port}\n`);

  // Cleanup test documents
  await Address.deleteMany({});
  await Order.deleteMany({ shippingAddress: /Phase10/ });
  await User.deleteMany({ email: /phase10_.*@test\.com/ });
  await Vendor.deleteMany({ shopName: /Phase10Vendor/ });
  await Product.deleteMany({ title: /Phase10Product/ });

  // Create Users
  userA = await User.create({
    username: 'phase10_buyerA',
    email: 'phase10_buyerA@test.com',
    password: 'password123',
    role: 'buyer'
  });
  tokenA = jwt.sign({ userId: userA._id }, JWT_SECRET, { expiresIn: '1h' });

  userB = await User.create({
    username: 'phase10_buyerB',
    email: 'phase10_buyerB@test.com',
    password: 'password123',
    role: 'buyer'
  });
  tokenB = jwt.sign({ userId: userB._id }, JWT_SECRET, { expiresIn: '1h' });

  vendorUser = await User.create({
    username: 'phase10_vendor',
    email: 'phase10_vendor@test.com',
    password: 'password123',
    role: 'vendor'
  });

  vendorDoc = await Vendor.create({
    userId: vendorUser._id,
    shopName: 'Phase10Vendor Shop',
    shopDescription: 'Phase 10 Vendor',
    approvalStatus: 'approved',
    onboardingComplete: true,
    totalEarnings: 0
  });

  productDoc = await Product.create({
    title: 'Phase10Product Item',
    description: 'Test Item for Phase 10',
    price: 500,
    stock: 50,
    category: 'Electronics',
    imageUrl: 'https://example.com/test.jpg',
    vendorId: vendorDoc._id
  });
}

async function runTests() {
  console.log('=== TEST SUITE: Customer Address Book ===\n');

  // -------------------------------------------------------------
  console.log('--- TEST 1: Address Input Validation ---');
  // -------------------------------------------------------------
  {
    // 1. Missing recipient name
    const res1 = await request('POST', '/api/addresses', {
      token: tokenA,
      body: {
        fullName: '',
        phone: '9876543210',
        addressLine1: 'Flat 101',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001'
      }
    });
    assert(res1.status === 400, 'Rejects empty recipient name with 400 Bad Request');

    // 2. Invalid phone numbers
    const res2 = await request('POST', '/api/addresses', {
      token: tokenA,
      body: {
        fullName: 'Rahul Sharma',
        phone: '12345',
        addressLine1: 'Flat 101',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001'
      }
    });
    assert(res2.status === 400, 'Rejects short phone number with 400 Bad Request');

    const res2b = await request('POST', '/api/addresses', {
      token: tokenA,
      body: {
        fullName: 'Rahul Sharma',
        phone: '1234567890', // Starts with 1 (not 6,7,8,9)
        addressLine1: 'Flat 101',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001'
      }
    });
    assert(res2b.status === 400, 'Rejects Indian mobile not starting with 6-9 with 400');

    // 3. Missing address line 1
    const res3 = await request('POST', '/api/addresses', {
      token: tokenA,
      body: {
        fullName: 'Rahul Sharma',
        phone: '9876543210',
        addressLine1: '   ',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001'
      }
    });
    assert(res3.status === 400, 'Rejects empty address line 1 with 400');

    // 4. Missing city
    const res4 = await request('POST', '/api/addresses', {
      token: tokenA,
      body: {
        fullName: 'Rahul Sharma',
        phone: '9876543210',
        addressLine1: 'Flat 101',
        city: '',
        state: 'Karnataka',
        postalCode: '560001'
      }
    });
    assert(res4.status === 400, 'Rejects missing city with 400');

    // 5. Missing state
    const res5 = await request('POST', '/api/addresses', {
      token: tokenA,
      body: {
        fullName: 'Rahul Sharma',
        phone: '9876543210',
        addressLine1: 'Flat 101',
        city: 'Bengaluru',
        state: '',
        postalCode: '560001'
      }
    });
    assert(res5.status === 400, 'Rejects missing state with 400');

    // 6. Invalid PIN code
    const res6 = await request('POST', '/api/addresses', {
      token: tokenA,
      body: {
        fullName: 'Rahul Sharma',
        phone: '9876543210',
        addressLine1: 'Flat 101',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '5600'
      }
    });
    assert(res6.status === 400, 'Rejects non-6-digit PIN code with 400');

    const res6b = await request('POST', '/api/addresses', {
      token: tokenA,
      body: {
        fullName: 'Rahul Sharma',
        phone: '9876543210',
        addressLine1: 'Flat 101',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '56000A'
      }
    });
    assert(res6b.status === 400, 'Rejects alphanumeric PIN code with 400');
  }

  // -------------------------------------------------------------
  console.log('\n--- TEST 2: Creation, Normalization & Default Address Behavior ---');
  // -------------------------------------------------------------
  let addr1Id, addr2Id, addr3Id;
  {
    // 1. Create first address with +91 phone formatting and isDefault: false passed
    const res1 = await request('POST', '/api/addresses', {
      token: tokenA,
      body: {
        fullName: 'Rahul Sharma',
        phone: '+91 98765 43210',
        addressLine1: '12B, Palm Grove',
        addressLine2: 'Koramangala 4th Block',
        landmark: 'Opposite Forum Mall',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560034',
        isDefault: false
      }
    });
    assert(res1.status === 201, 'Valid address created with 201 Created');
    assert(res1.data.address.phone === '9876543210', 'Phone number normalized to clean 10-digit number');
    assert(res1.data.address.isDefault === true, 'First address automatically set to isDefault: true');
    addr1Id = res1.data.address._id;

    // 2. Create second address with isDefault: true
    const res2 = await request('POST', '/api/addresses', {
      token: tokenA,
      body: {
        fullName: 'Rahul Sharma (Office)',
        phone: '8765432109',
        addressLine1: 'Level 5, Tech Park',
        addressLine2: 'Whitefield',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560066',
        isDefault: true
      }
    });
    assert(res2.status === 201, 'Second address created with 201 Created');
    assert(res2.data.address.isDefault === true, 'Second address has isDefault: true');
    addr2Id = res2.data.address._id;

    // Verify first address is now demoted to isDefault: false
    const check1 = await Address.findById(addr1Id);
    assert(check1.isDefault === false, 'First address automatically demoted to isDefault: false');

    // 3. Create third address with isDefault: false
    const res3 = await request('POST', '/api/addresses', {
      token: tokenA,
      body: {
        fullName: 'Rahul Sharma (Parents)',
        phone: '7654321098',
        addressLine1: '45, Heritage Enclave',
        city: 'Mysuru',
        state: 'Karnataka',
        postalCode: '570001',
        isDefault: false
      }
    });
    assert(res3.status === 201, 'Third address created with 201 Created');
    assert(res3.data.address.isDefault === false, 'Third address remains isDefault: false');
    addr3Id = res3.data.address._id;

    // Verify exactly one address is default for User A
    const defaults = await Address.find({ userId: userA._id, isDefault: true });
    assert(defaults.length === 1 && defaults[0]._id.toString() === addr2Id, 'Exactly one address is marked default for customer');
  }

  // -------------------------------------------------------------
  console.log('\n--- TEST 3: Address Listing & Default-First Sorting ---');
  // -------------------------------------------------------------
  {
    const res = await request('GET', '/api/addresses', { token: tokenA });
    assert(res.status === 200, 'GET /api/addresses returns 200 OK');
    assert(res.data.addresses.length === 3, 'Returns all 3 saved addresses');
    assert(res.data.addresses[0]._id.toString() === addr2Id, 'Default address is listed first in returned list');
    assert(res.data.addresses[0].isDefault === true, 'First element is confirmed default');
  }

  // -------------------------------------------------------------
  console.log('\n--- TEST 4: Address Update & Explicit Default Switch ---');
  // -------------------------------------------------------------
  {
    // 1. Update address fields on addr1
    const resUpdate = await request('PUT', `/api/addresses/${addr1Id}`, {
      token: tokenA,
      body: {
        fullName: 'Rahul S. Sharma',
        phone: '9876543210',
        addressLine1: '12B, Palm Grove Luxury Apts',
        addressLine2: 'Koramangala 4th Block',
        landmark: 'Opposite Forum Mall Main Gate',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560034',
        isDefault: false
      }
    });
    assert(resUpdate.status === 200, 'PUT /api/addresses/:id returns 200 OK');
    assert(resUpdate.data.address.fullName === 'Rahul S. Sharma', 'Recipient name updated correctly');
    assert(resUpdate.data.address.addressLine1 === '12B, Palm Grove Luxury Apts', 'AddressLine1 updated correctly');

    // 2. Set addr1 as default via PATCH /api/addresses/:id/default
    const resDefault = await request('PATCH', `/api/addresses/${addr1Id}/default`, { token: tokenA });
    assert(resDefault.status === 200, 'PATCH /api/addresses/:id/default returns 200 OK');
    assert(resDefault.data.address.isDefault === true, 'Target address is now default');

    // Verify addr2 was demoted
    const check2 = await Address.findById(addr2Id);
    assert(check2.isDefault === false, 'Previous default addr2 was demoted to false');

    const totalDefaults = await Address.countDocuments({ userId: userA._id, isDefault: true });
    assert(totalDefaults === 1, 'Still exactly one default address across the user account');
  }

  // -------------------------------------------------------------
  console.log('\n--- TEST 5: Strict Ownership Enforcement (Cross-User Isolation) ---');
  // -------------------------------------------------------------
  {
    // User B attempts to view User A's address
    const resGet = await request('GET', `/api/addresses/${addr1Id}`, { token: tokenB });
    assert(resGet.status === 403, 'User B cannot view User A address (403 Forbidden)');

    // User B attempts to edit User A's address
    const resPut = await request('PUT', `/api/addresses/${addr1Id}`, {
      token: tokenB,
      body: {
        fullName: 'Hacker Name',
        phone: '9999999999',
        addressLine1: 'Hacked Address',
        city: 'Delhi',
        state: 'Delhi',
        postalCode: '110001'
      }
    });
    assert(resPut.status === 403, 'User B cannot edit User A address (403 Forbidden)');

    // Verify User A's address was not altered
    const verifyUnchanged = await Address.findById(addr1Id);
    assert(verifyUnchanged.fullName === 'Rahul S. Sharma', 'User A address data untouched by unauthorized attempt');

    // User B attempts to set User A's address as default
    const resPatch = await request('PATCH', `/api/addresses/${addr1Id}/default`, { token: tokenB });
    assert(resPatch.status === 403, 'User B cannot default User A address (403 Forbidden)');

    // User B attempts to delete User A's address
    const resDel = await request('DELETE', `/api/addresses/${addr1Id}`, { token: tokenB });
    assert(resDel.status === 403, 'User B cannot delete User A address (403 Forbidden)');

    // User B lists addresses -> should be empty
    const resListB = await request('GET', '/api/addresses', { token: tokenB });
    assert(resListB.data.addresses.length === 0, 'User B address list is empty and does not expose User A addresses');
  }

  // -------------------------------------------------------------
  console.log('\n--- TEST 6: Address Deletion & Default Reassignment ---');
  // -------------------------------------------------------------
  {
    // Currently addr1 is default. Delete addr1.
    const resDel1 = await request('DELETE', `/api/addresses/${addr1Id}`, { token: tokenA });
    assert(resDel1.status === 200, 'DELETE /api/addresses/:id succeeds with 200');

    const checkAddr1 = await Address.findById(addr1Id);
    assert(checkAddr1 === null, 'Address 1 successfully removed from database');

    // Verify another address was promoted to default
    const remaining = await Address.find({ userId: userA._id });
    assert(remaining.length === 2, '2 addresses remaining for User A');
    const newDefault = remaining.find(a => a.isDefault);
    assert(Boolean(newDefault), 'One remaining address was automatically promoted to default');

    // Delete a non-default address
    const nonDefault = remaining.find(a => !a.isDefault);
    const resDelNonDef = await request('DELETE', `/api/addresses/${nonDefault._id}`, { token: tokenA });
    assert(resDelNonDef.status === 200, 'Non-default address deleted successfully');

    // Verify 1 address left, and it is still default
    const lastRemaining = await Address.find({ userId: userA._id });
    assert(lastRemaining.length === 1 && lastRemaining[0].isDefault === true, 'Final remaining address remains default');

    // Delete final address
    await request('DELETE', `/api/addresses/${lastRemaining[0]._id}`, { token: tokenA });
    const emptyCount = await Address.countDocuments({ userId: userA._id });
    assert(emptyCount === 0, 'All addresses deleted cleanly, count is 0');
  }

  // -------------------------------------------------------------
  console.log('\n--- TEST 7: Checkout Integration & Snapshot Invariance ---');
  // -------------------------------------------------------------
  {
    // 1. Create a fresh saved address for User A
    const createRes = await request('POST', '/api/addresses', {
      token: tokenA,
      body: {
        fullName: 'Rahul Sharma Phase10',
        phone: '9876543210',
        addressLine1: 'Penthouse 901, Phase10 Heights',
        addressLine2: 'Indiranagar',
        landmark: 'Near 100ft Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560038',
        isDefault: true
      }
    });
    assert(createRes.status === 201, 'Created address for checkout test');
    const savedAddressId = createRes.data.address._id;

    // 2. User B tries to use User A's addressId in checkout -> 403 Forbidden
    const checkoutAttacker = await request('POST', '/api/orders/create-razorpay-order', {
      token: tokenB,
      headers: { 'x-payment-provider': 'simulated' },
      body: {
        paymentProvider: 'simulated',
        products: [{ productId: productDoc._id, quantity: 1 }],
        addressId: savedAddressId
      }
    });
    assert(checkoutAttacker.status === 403, 'Cross-user addressId in checkout rejected with 403 Forbidden');

    // 3. User A checks out using their saved addressId
    const checkoutA = await request('POST', '/api/orders/create-razorpay-order', {
      token: tokenA,
      headers: { 'x-payment-provider': 'simulated' },
      body: {
        paymentProvider: 'simulated',
        products: [{ productId: productDoc._id, quantity: 1 }],
        addressId: savedAddressId
      }
    });
    assert(checkoutA.status === 201 || checkoutA.status === 200, 'Order creation with saved addressId succeeds with 201 Created');
    const orderId = checkoutA.data.orderId;

    const initialOrder = await Order.findById(orderId);
    assert(Boolean(initialOrder), 'Order created in database');
    const originalSnapshot = initialOrder.shippingAddress;
    console.log(`    Snapshot saved in order: "${originalSnapshot}"`);
    assert(originalSnapshot.includes('Phase10 Heights'), 'Order has address snapshot containing addressLine1');
    assert(originalSnapshot.includes('9876543210'), 'Order has address snapshot containing phone');

    // 4. User A edits the saved address in their address book
    const editRes = await request('PUT', `/api/addresses/${savedAddressId}`, {
      token: tokenA,
      body: {
        fullName: 'Rahul NEW NAME',
        phone: '6111111111',
        addressLine1: 'COMPLETELY DIFFERENT ADDRESS',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400001',
        isDefault: true
      }
    });
    assert(editRes.status === 200, 'Saved address edited in address book');

    // 5. Verify the previously placed order's shippingAddress is completely UNCHANGED
    const postEditOrder = await Order.findById(orderId);
    assert(
      postEditOrder.shippingAddress === originalSnapshot,
      'SNAPSHOT INVARIANCE: Order shipping address remains 100% unchanged after address book edit'
    );
    assert(
      !postEditOrder.shippingAddress.includes('COMPLETELY DIFFERENT ADDRESS'),
      'Order does NOT adopt new address line from address book'
    );

    // 6. User A deletes the saved address from address book entirely
    await request('DELETE', `/api/addresses/${savedAddressId}`, { token: tokenA });
    const postDeleteOrder = await Order.findById(orderId);
    assert(
      postDeleteOrder.shippingAddress === originalSnapshot,
      'SNAPSHOT INVARIANCE: Order shipping address remains intact even after address is deleted from address book'
    );

    // 7. Manual checkout without saved address (legacy/direct entry) continues to work perfectly
    const manualCheckout = await request('POST', '/api/orders/create-razorpay-order', {
      token: tokenA,
      headers: { 'x-payment-provider': 'simulated' },
      body: {
        paymentProvider: 'simulated',
        products: [{ productId: productDoc._id, quantity: 1 }],
        shippingAddress: 'Phase10 Manual Guest Address, MG Road, Pune, Maharashtra - 411001. Phone: 9876543210'
      }
    });
    assert(manualCheckout.status === 201 || manualCheckout.status === 200, 'Direct manual checkout without addressId succeeds with 201 Created');
    const manualOrder = await Order.findById(manualCheckout.data.orderId);
    assert(
      manualOrder.shippingAddress === 'Phase10 Manual Guest Address, MG Road, Pune, Maharashtra - 411001. Phone: 9876543210',
      'Manual checkout preserves provided address string snapshot'
    );
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
    // Clean up test data
    await Address.deleteMany({});
    await Order.deleteMany({ shippingAddress: /Phase10/ });
    await User.deleteMany({ email: /phase10_.*@test\.com/ });
    await Vendor.deleteMany({ shopName: /Phase10Vendor/ });
    await Product.deleteMany({ title: /Phase10Product/ });
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
