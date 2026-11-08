/**
 * PHASE 12: ADMIN DASHBOARD AND REPORTING TEST SUITE
 *
 * Verifies:
 * 1. Admin authorization & RBAC (Buyers & Vendors 403 Forbidden; unauthenticated 401).
 * 2. High-level dashboard summary & order status counts distribution.
 * 3. Financial reporting precision:
 *    - Gross captured sales derived strictly from paid/captured orders.
 *    - Unpaid, failed, authorized, and cancelled-before-payment orders excluded.
 *    - Completed refunds deducted from net revenue.
 *    - Pending/initiated and failed refunds strictly excluded from refund totals.
 *    - Platform commission and vendor earnings reconciliation.
 *    - Date range filtering on financial reports.
 * 4. Filtered order listing (date range, order status, payment status, customer, vendor).
 * 5. Product & inventory summary with configurable low-stock threshold.
 * 6. User management (listing, role filter, search, role updates, admin self-demotion lockout).
 * 7. Vendor management & approval workflow (list, filter by approval status, approve, reject).
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
const Commission = require('../models/Commission');
const adminRouter = require('../routes/admin');

const TEST_DB_URI = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/marketplace_test';
const JWT_SECRET = process.env.JWT_SECRET || 'marketplace-secret-key-2025';

let server;
let baseUrl;

let adminUser, vendorUser, buyerUser, otherUser;
let vendorShop;
let adminToken, vendorToken, buyerToken;

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
  app.use('/api/admin', adminRouter);

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Phase 12 test server listening on port ${port}\n`);

  // Cleanup existing Phase 12 test records
  await Order.deleteMany({ shippingAddress: /Phase12/ });
  await Product.deleteMany({ title: /Phase12/ });
  await Vendor.deleteMany({ shopName: /Phase12/ });
  await User.deleteMany({ email: /phase12_.*@test\.com/ });

  // 1. Create Users
  adminUser = await User.create({
    username: 'phase12_admin',
    email: 'phase12_admin@test.com',
    password: 'password123',
    role: 'admin'
  });
  adminToken = jwt.sign({ userId: adminUser._id }, JWT_SECRET, { expiresIn: '1h' });

  vendorUser = await User.create({
    username: 'phase12_vendor',
    email: 'phase12_vendor@test.com',
    password: 'password123',
    role: 'vendor'
  });
  vendorToken = jwt.sign({ userId: vendorUser._id }, JWT_SECRET, { expiresIn: '1h' });

  buyerUser = await User.create({
    username: 'phase12_buyer',
    email: 'phase12_buyer@test.com',
    password: 'password123',
    role: 'buyer'
  });
  buyerToken = jwt.sign({ userId: buyerUser._id }, JWT_SECRET, { expiresIn: '1h' });

  otherUser = await User.create({
    username: 'phase12_other',
    email: 'phase12_other@test.com',
    password: 'password123',
    role: 'buyer'
  });

  // 2. Create Vendor Shop
  vendorShop = await Vendor.create({
    userId: vendorUser._id,
    shopName: 'Phase12 Mega Store',
    shopDescription: 'Official test vendor for Phase 12 admin reporting',
    approvalStatus: 'approved',
    onboardingComplete: true
  });
}

async function teardown() {
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
  // Cleanup test records
  await Order.deleteMany({ shippingAddress: /Phase12/ });
  await Product.deleteMany({ title: /Phase12/ });
  await Vendor.deleteMany({ shopName: /Phase12/ });
  await User.deleteMany({ email: /phase12_.*@test\.com/ });
  await mongoose.disconnect();
}

async function runTests() {
  console.log('========================================================');
  console.log('STARTING PHASE 12: ADMIN DASHBOARD & REPORTING TESTS');
  console.log('========================================================\n');

  try {
    await setup();

    // -------------------------------------------------------------
    // SUITE 1: Admin RBAC & Route Authorization Protection
    // -------------------------------------------------------------
    console.log('--- SUITE 1: Admin Authorization & Role Protection ---');

    // 1.1 Unauthenticated requests rejected
    const unauthDash = await request('GET', '/api/admin/dashboard');
    assert(unauthDash.status === 401, 'Unauthenticated request to /api/admin/dashboard returns 401');

    const unauthOrders = await request('GET', '/api/admin/orders');
    assert(unauthOrders.status === 401, 'Unauthenticated request to /api/admin/orders returns 401');

    const unauthInv = await request('GET', '/api/admin/inventory');
    assert(unauthInv.status === 401, 'Unauthenticated request to /api/admin/inventory returns 401');

    const unauthUsers = await request('GET', '/api/admin/users');
    assert(unauthUsers.status === 401, 'Unauthenticated request to /api/admin/users returns 401');

    const unauthVendors = await request('GET', '/api/admin/vendors');
    assert(unauthVendors.status === 401, 'Unauthenticated request to /api/admin/vendors returns 401');

    // 1.2 Buyer requests rejected with 403 Forbidden
    const buyerDash = await request('GET', '/api/admin/dashboard', { token: buyerToken });
    assert(buyerDash.status === 403, 'Buyer request to /api/admin/dashboard returns 403 Forbidden');

    const buyerOrders = await request('GET', '/api/admin/orders', { token: buyerToken });
    assert(buyerOrders.status === 403, 'Buyer request to /api/admin/orders returns 403 Forbidden');

    const buyerReports = await request('GET', '/api/admin/reports/financial', { token: buyerToken });
    assert(buyerReports.status === 403, 'Buyer request to /api/admin/reports/financial returns 403 Forbidden');

    // 1.3 Vendor requests rejected with 403 Forbidden
    const vendorDash = await request('GET', '/api/admin/dashboard', { token: vendorToken });
    assert(vendorDash.status === 403, 'Vendor request to /api/admin/dashboard returns 403 Forbidden');

    const vendorUsers = await request('GET', '/api/admin/users', { token: vendorToken });
    assert(vendorUsers.status === 403, 'Vendor request to /api/admin/users returns 403 Forbidden');

    const vendorInv = await request('GET', '/api/admin/inventory', { token: vendorToken });
    assert(vendorInv.status === 403, 'Vendor request to /api/admin/inventory returns 403 Forbidden');

    // 1.4 Admin requests succeed with 200 OK
    const adminDash = await request('GET', '/api/admin/dashboard', { token: adminToken });
    assert(adminDash.status === 200, 'Admin request to /api/admin/dashboard returns 200 OK');
    assert(typeof adminDash.data.totalUsers === 'number', 'Dashboard returns totalUsers');
    assert(typeof adminDash.data.orderStatusCounts === 'object', 'Dashboard returns orderStatusCounts');

    // -------------------------------------------------------------
    // SUITE 2: Seed Products & Orders for Financial & Inventory Tests
    // -------------------------------------------------------------
    console.log('\n--- SUITE 2: Seeding Products and Orders ---');

    // Seed products with various stock levels (0, 3, 8, 25)
    const productA = await Product.create({
      title: 'Phase12 Out of Stock Item',
      description: 'Zero stock product',
      price: 500,
      stock: 0,
      vendorId: vendorShop._id,
      category: 'Electronics',
      imageUrl: 'https://example.com/item0.jpg',
      sku: 'SKU-PHASE12-0'
    });

    const productB = await Product.create({
      title: 'Phase12 Low Stock Item',
      description: 'Low stock product',
      price: 1000,
      stock: 4,
      vendorId: vendorShop._id,
      category: 'Clothing',
      imageUrl: 'https://example.com/item4.jpg',
      sku: 'SKU-PHASE12-4'
    });

    const productC = await Product.create({
      title: 'Phase12 Medium Stock Item',
      description: 'Medium stock product',
      price: 2000,
      stock: 9,
      vendorId: vendorShop._id,
      category: 'Books',
      imageUrl: 'https://example.com/item9.jpg',
      sku: 'SKU-PHASE12-9'
    });

    const productD = await Product.create({
      title: 'Phase12 Healthy Stock Item',
      description: 'Healthy stock product',
      price: 300,
      stock: 50,
      vendorId: vendorShop._id,
      category: 'Home',
      imageUrl: 'https://example.com/item50.jpg',
      sku: 'SKU-PHASE12-50'
    });

    assert(productA && productB && productC && productD, 'Four test products created successfully');

    // Seed test orders:
    // Order 1: Paid completed order (total 1000, commission 100, vendor 900, status 'confirmed')
    const orderPaid1 = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorShop._id,
      products: [{ productId: productB._id, quantity: 1, price: 1000 }],
      totalAmount: 1000,
      adminCommission: 100,
      vendorEarning: 900,
      status: 'confirmed',
      paymentStatus: 'paid',
      shippingAddress: 'Phase12 Street 1',
      createdAt: new Date('2026-03-01T10:00:00Z')
    });

    // Order 2: Paid delivered order (total 2000, commission 200, vendor 1800, status 'delivered')
    const orderPaid2 = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorShop._id,
      products: [{ productId: productC._id, quantity: 1, price: 2000 }],
      totalAmount: 2000,
      adminCommission: 200,
      vendorEarning: 1800,
      status: 'delivered',
      paymentStatus: 'paid',
      shippingAddress: 'Phase12 Street 2',
      createdAt: new Date('2026-03-05T12:00:00Z')
    });

    // Order 3: Paid with completed partial refund (total 1500, commission 150, vendor 1350, refund: 400 completed, status 'processing')
    const orderPartialRefund = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorShop._id,
      products: [{ productId: productB._id, quantity: 1, price: 1500 }],
      totalAmount: 1500,
      adminCommission: 150,
      vendorEarning: 1350,
      status: 'processing',
      paymentStatus: 'paid',
      refunds: [
        { refundId: 'rfnd_test_comp_1', amount: 400, status: 'completed' },
        { refundId: 'rfnd_test_init_1', amount: 300, status: 'initiated' } // initiated must be ignored!
      ],
      shippingAddress: 'Phase12 Street 3',
      createdAt: new Date('2026-03-10T14:00:00Z')
    });

    // Order 4: Fully refunded order (total 600, commission 60, vendor 540, paymentStatus 'refunded', status 'refunded', refundAmount: 600)
    const orderFullRefund = await Order.create({
      buyerId: otherUser._id,
      vendorId: vendorShop._id,
      products: [{ productId: productD._id, quantity: 2, price: 300 }],
      totalAmount: 600,
      adminCommission: 60,
      vendorEarning: 540,
      status: 'refunded',
      paymentStatus: 'refunded',
      refundAmount: 600,
      refundStatus: 'completed',
      shippingAddress: 'Phase12 Street 4',
      createdAt: new Date('2026-03-12T09:00:00Z')
    });

    // Order 5: Unpaid / created order (total 500, paymentStatus 'created', status 'pending') - MUST BE EXCLUDED FROM SALES
    const orderUnpaid = await Order.create({
      buyerId: otherUser._id,
      vendorId: vendorShop._id,
      products: [{ productId: productA._id, quantity: 1, price: 500 }],
      totalAmount: 500,
      adminCommission: 50,
      vendorEarning: 450,
      status: 'pending',
      paymentStatus: 'created',
      shippingAddress: 'Phase12 Street 5',
      createdAt: new Date('2026-03-15T11:00:00Z')
    });

    // Order 6: Failed payment order (total 800, paymentStatus 'failed', status 'cancelled') - MUST BE EXCLUDED FROM SALES
    const orderFailed = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorShop._id,
      products: [{ productId: productD._id, quantity: 1, price: 800 }],
      totalAmount: 800,
      adminCommission: 80,
      vendorEarning: 720,
      status: 'cancelled',
      paymentStatus: 'failed',
      shippingAddress: 'Phase12 Street 6',
      createdAt: new Date('2026-03-16T15:00:00Z')
    });

    // Order 7: Order with failed refund attempt (total 1200, paymentStatus 'paid', status 'confirmed', refunds: [{ status: 'failed', amount: 500 }])
    // The 500 failed refund must NOT be subtracted from net revenue!
    const orderFailedRefund = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendorShop._id,
      products: [{ productId: productB._id, quantity: 1, price: 1200 }],
      totalAmount: 1200,
      adminCommission: 120,
      vendorEarning: 1080,
      status: 'confirmed',
      paymentStatus: 'paid',
      refunds: [
        { refundId: 'rfnd_failed_1', amount: 500, status: 'failed' }
      ],
      shippingAddress: 'Phase12 Street 7',
      createdAt: new Date('2026-03-20T16:00:00Z')
    });

    assert(orderPaid1 && orderPaid2 && orderPartialRefund && orderFullRefund && orderUnpaid && orderFailed && orderFailedRefund,
      'Seven diverse lifecycle/payment orders created successfully');

    // -------------------------------------------------------------
    // SUITE 3: Financial Calculations & Precision Audit
    // -------------------------------------------------------------
    console.log('\n--- SUITE 3: Financial Reporting & Calculations Precision ---');

    // Expected numbers for Phase 12 orders:
    // Captured orders:
    // - orderPaid1: 1000
    // - orderPaid2: 2000
    // - orderPartialRefund: 1500 (refund completed: 400)
    // - orderFullRefund: 600 (refund completed: 600)
    // - orderFailedRefund: 1200 (refund failed: 0 completed)
    // Gross Captured: 1000 + 2000 + 1500 + 600 + 1200 = 6300
    // Completed Refunds: 400 + 600 = 1000
    // Net Revenue: 6300 - 1000 = 5300
    // Commission: 100 + 200 + 150 + 60 + 120 = 630
    // Vendor Earnings: 900 + 1800 + 1350 + 540 + 1080 = 5670
    // Gross = Commission + Vendor = 630 + 5670 = 6300

    const finReport = await request('GET', '/api/admin/reports/financial?startDate=2026-03-01&endDate=2026-03-31', { token: adminToken });
    assert(finReport.status === 200, 'Admin can fetch financial report for March 2026');
    assert(finReport.data.grossCapturedSales === 6300, `Gross captured sales is ₹6300 (actual: ₹${finReport.data.grossCapturedSales})`);
    assert(finReport.data.completedRefunds === 1000, `Completed refunds is ₹1000 (actual: ₹${finReport.data.completedRefunds})`);
    assert(finReport.data.netRevenue === 5300, `Net revenue is ₹5300 (gross - completed refunds) (actual: ₹${finReport.data.netRevenue})`);
    assert(finReport.data.platformCommission === 630, `Platform commission is ₹630 (actual: ₹${finReport.data.platformCommission})`);
    assert(finReport.data.vendorEarnings === 5670, `Vendor earnings is ₹5670 (actual: ₹${finReport.data.vendorEarnings})`);
    assert(finReport.data.reconciliation.reconciled === true, 'Financial integrity reconciled: gross === commission + vendor earnings');

    // Check exclusion of uncompleted orders
    assert(finReport.data.excludedOrdersCount === 2, `Excluded uncompleted orders count is 2 (orderUnpaid + orderFailed) (actual: ${finReport.data.excludedOrdersCount})`);

    // Verify Pending/Initiated/Failed refunds are NOT included in completed refunds
    assert(finReport.data.completedRefunds !== 1500, 'Initiated refund of ₹300 is NOT counted in completed refunds');
    assert(finReport.data.completedRefunds !== 1800, 'Failed refund of ₹500 is NOT counted in completed refunds');

    // -------------------------------------------------------------
    // SUITE 4: Dashboard Overview & Status Counts
    // -------------------------------------------------------------
    console.log('\n--- SUITE 4: Dashboard Overview & Status Distribution ---');

    const dashRes = await request('GET', '/api/admin/dashboard', { token: adminToken });
    assert(dashRes.status === 200, 'Admin dashboard returns 200');
    assert(dashRes.data.grossCapturedSales >= 6300, 'Dashboard contains grossCapturedSales');
    assert(dashRes.data.completedRefunds >= 1000, 'Dashboard contains completedRefunds');
    assert(dashRes.data.netRevenue >= 5300, 'Dashboard contains netRevenue');
    assert(dashRes.data.platformCommission >= 630, 'Dashboard contains platformCommission');
    assert(dashRes.data.vendorEarnings >= 5670, 'Dashboard contains vendorEarnings');

    // Order status counts breakdown
    const osc = dashRes.data.orderStatusCounts;
    assert(typeof osc === 'object', 'orderStatusCounts is returned');
    assert(osc.confirmed >= 2, `Confirmed orders count tracked (${osc.confirmed})`);
    assert(osc.delivered >= 1, `Delivered orders count tracked (${osc.delivered})`);
    assert(osc.processing >= 1, `Processing orders count tracked (${osc.processing})`);
    assert(osc.refunded >= 1, `Refunded orders count tracked (${osc.refunded})`);
    assert(osc.cancelled >= 1, `Cancelled orders count tracked (${osc.cancelled})`);
    assert(osc.pending >= 1, `Pending orders count tracked (${osc.pending})`);

    // -------------------------------------------------------------
    // SUITE 5: Admin Order Filtering & Search (`GET /api/admin/orders`)
    // -------------------------------------------------------------
    console.log('\n--- SUITE 5: Filtered Order Listing ---');

    // 5.1 Filter by status
    const deliveredOrders = await request('GET', '/api/admin/orders?status=delivered', { token: adminToken });
    assert(deliveredOrders.status === 200, 'GET /api/admin/orders?status=delivered returns 200');
    assert(deliveredOrders.data.orders.every(o => o.status === 'delivered'), 'All returned orders have status: delivered');

    // 5.2 Filter by paymentStatus
    const paidOrders = await request('GET', '/api/admin/orders?paymentStatus=paid', { token: adminToken });
    assert(paidOrders.status === 200, 'GET /api/admin/orders?paymentStatus=paid returns 200');
    assert(paidOrders.data.orders.every(o => o.paymentStatus === 'paid'), 'All returned orders have paymentStatus: paid');

    // 5.3 Filter by date range
    const earlyMarchOrders = await request('GET', '/api/admin/orders?startDate=2026-03-01&endDate=2026-03-06', { token: adminToken });
    assert(earlyMarchOrders.status === 200, 'Date filtered orders returns 200');
    assert(earlyMarchOrders.data.orders.length >= 2, 'Date filter returned early March orders');

    // 5.4 Filter by customer username search
    const customerOrders = await request('GET', '/api/admin/orders?customer=phase12_buyer', { token: adminToken });
    assert(customerOrders.status === 200, 'Filter by customer username returns 200');
    assert(customerOrders.data.orders.length >= 4, `Customer orders found: ${customerOrders.data.orders.length}`);

    // 5.5 Filter by vendor shopName search
    const vendorOrders = await request('GET', '/api/admin/orders?vendor=Phase12%20Mega', { token: adminToken });
    assert(vendorOrders.status === 200, 'Filter by vendor shopName returns 200');
    assert(vendorOrders.data.orders.length >= 5, `Vendor orders found: ${vendorOrders.data.orders.length}`);

    // 5.6 Pagination
    const pageOrders = await request('GET', '/api/admin/orders?page=1&limit=2', { token: adminToken });
    assert(pageOrders.status === 200 && pageOrders.data.orders.length === 2, 'Pagination limit=2 returns exactly 2 orders');
    assert(pageOrders.data.totalPages > 1, `Pagination totalPages calculated (${pageOrders.data.totalPages})`);

    // -------------------------------------------------------------
    // SUITE 6: Product & Inventory Summary (`GET /api/admin/inventory`)
    // -------------------------------------------------------------
    console.log('\n--- SUITE 6: Inventory & Low-Stock Reporting ---');

    // 6.1 Default threshold (10)
    const invRes10 = await request('GET', '/api/admin/inventory?threshold=10', { token: adminToken });
    assert(invRes10.status === 200, 'GET /api/admin/inventory returns 200');
    assert(invRes10.data.threshold === 10, 'Inventory threshold set to 10');
    assert(invRes10.data.outOfStockCount >= 1, `Out of stock products counted (${invRes10.data.outOfStockCount})`);
    assert(invRes10.data.lowStockCount >= 2, `Low stock products counted with threshold 10 (${invRes10.data.lowStockCount})`);
    assert(invRes10.data.totalStock > 0, `Total stock aggregation returned (${invRes10.data.totalStock})`);

    // Verify low-stock list contains productA (0) and productB (4) and productC (9)
    const lowStockIds = invRes10.data.lowStockProducts.map(p => p._id.toString());
    assert(lowStockIds.includes(productA._id.toString()), 'Out of stock productA is in low-stock products list');
    assert(lowStockIds.includes(productB._id.toString()), 'Low stock productB is in low-stock products list');
    assert(lowStockIds.includes(productC._id.toString()), 'Stock 9 productC is in low-stock products list (<= 10)');
    assert(!lowStockIds.includes(productD._id.toString()), 'Healthy productD (stock 50) is NOT in low-stock products list');

    // 6.2 Strict threshold (5)
    const invRes5 = await request('GET', '/api/admin/inventory?threshold=5', { token: adminToken });
    assert(invRes5.status === 200, 'GET /api/admin/inventory?threshold=5 returns 200');
    const lowStockIds5 = invRes5.data.lowStockProducts.map(p => p._id.toString());
    assert(lowStockIds5.includes(productB._id.toString()), 'Product B (stock 4) is in threshold 5 list');
    assert(!lowStockIds5.includes(productC._id.toString()), 'Product C (stock 9) is excluded when threshold is 5');

    // -------------------------------------------------------------
    // SUITE 7: User Management & Admin Role Protection
    // -------------------------------------------------------------
    console.log('\n--- SUITE 7: User Management & Role Controls ---');

    // 7.1 List users with role filter
    const buyersRes = await request('GET', '/api/admin/users?role=buyer', { token: adminToken });
    assert(buyersRes.status === 200, 'GET /api/admin/users?role=buyer returns 200');
    assert(buyersRes.data.users.every(u => u.role === 'buyer'), 'All returned users have role buyer');

    // 7.2 Search users by email
    const searchRes = await request('GET', '/api/admin/users?search=phase12_other', { token: adminToken });
    assert(searchRes.status === 200, 'Search user by username/email returns 200');
    assert(searchRes.data.users.some(u => u.email === otherUser.email), 'Found phase12_other user in search results');

    // 7.3 Update user role (promote buyer to vendor)
    const promoteRes = await request('PUT', `/api/admin/users/${otherUser._id}/role`, {
      token: adminToken,
      body: { role: 'vendor' }
    });
    assert(promoteRes.status === 200, 'Admin can promote user role to vendor');
    assert(promoteRes.data.user.role === 'vendor', 'User role updated in response');

    const updatedUser = await User.findById(otherUser._id);
    assert(updatedUser.role === 'vendor', 'User role persisted in MongoDB');

    // 7.4 Admin self-demotion lockout protection
    const selfDemoteRes = await request('PUT', `/api/admin/users/${adminUser._id}/role`, {
      token: adminToken,
      body: { role: 'buyer' }
    });
    assert(selfDemoteRes.status === 400, 'Admin self-demotion is rejected with 400 Bad Request');
    const unchangedAdmin = await User.findById(adminUser._id);
    assert(unchangedAdmin.role === 'admin', 'Admin role preserved and protected against lockout');

    // -------------------------------------------------------------
    // SUITE 8: Vendor Management & Approval Workflow
    // -------------------------------------------------------------
    console.log('\n--- SUITE 8: Vendor Management & Approval Workflow ---');

    // 8.1 Create a pending vendor request
    const pendingVendor = await Vendor.create({
      userId: otherUser._id,
      shopName: 'Phase12 Pending Shop',
      shopDescription: 'Applicant for vendor status',
      approvalStatus: 'pending',
      onboardingComplete: false
    });

    // 8.2 List pending vendor requests
    const pendingListRes = await request('GET', '/api/admin/vendor-requests', { token: adminToken });
    assert(pendingListRes.status === 200, 'GET /api/admin/vendor-requests returns 200');
    assert(pendingListRes.data.requests.some(r => r._id.toString() === pendingVendor._id.toString()),
      'Pending vendor request appears in /api/admin/vendor-requests');

    // 8.3 Approve vendor request
    const approveRes = await request('PUT', `/api/admin/vendor-requests/${pendingVendor._id}/approve`, { token: adminToken });
    assert(approveRes.status === 200, 'Approve vendor request returns 200');

    const approvedVendor = await Vendor.findById(pendingVendor._id);
    assert(approvedVendor.approvalStatus === 'approved', 'Vendor approvalStatus updated to approved');
    assert(approvedVendor.onboardingComplete === true, 'Vendor onboardingComplete set to true');

    // 8.4 Reject vendor shop via status update
    const rejectRes = await request('PUT', `/api/admin/vendors/${pendingVendor._id}/status`, {
      token: adminToken,
      body: { status: 'rejected', notes: 'Incomplete documents' }
    });
    assert(rejectRes.status === 200, 'Update vendor status to rejected returns 200');
    const rejectedVendor = await Vendor.findById(pendingVendor._id);
    assert(rejectedVendor.approvalStatus === 'rejected', 'Vendor approvalStatus updated to rejected');
    assert(rejectedVendor.approvalNotes === 'Incomplete documents', 'Rejection notes saved');

    // 8.5 Filter vendors by approvalStatus
    const filterVendorsRes = await request('GET', '/api/admin/vendors?status=rejected', { token: adminToken });
    assert(filterVendorsRes.status === 200, 'GET /api/admin/vendors?status=rejected returns 200');
    assert(filterVendorsRes.data.vendors.some(v => v._id.toString() === pendingVendor._id.toString()),
      'Rejected vendor appears in status=rejected filter');

  } catch (err) {
    console.error('Unexpected test error:', err);
    failCount++;
  } finally {
    await teardown();
  }

  console.log('\n========================================================');
  console.log(`PHASE 12 TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED (TOTAL: ${testCount})`);
  console.log('========================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests();

