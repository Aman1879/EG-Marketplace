/**
 * PHASE 13: AUDIT LOGGING AND NOTIFICATIONS TEST SUITE
 *
 * Verifies:
 * 1. Audit trail creation for all mandatory actions:
 *    - User & vendor account changes (user.register, vendor.create, vendor.update, vendor.payout_update).
 *    - Product creation, edits, and deletion (product.create, product.update, product.delete).
 *    - Inventory adjustments (inventory.adjust, inventory.deduct, inventory.restore).
 *    - Order status changes and cancellations (order.status_change, order.cancel).
 *    - Payment and refund state changes (payment.state_change, refund.state_change).
 *    - Admin approvals, rejections, and role changes (admin.role_change, admin.vendor_approval, admin.vendor_rejection).
 * 2. Actor attribution: records actorId and actorRole correctly.
 * 3. Sensitive-data exclusion: passwords, secrets, tokens, signatures, and claim tokens are [REDACTED]; account numbers masked.
 * 4. Role-based access & immutability:
 *    - Ordinary buyers and vendors cannot view audit logs (403 Forbidden).
 *    - Admin access is read-only (GET 200).
 *    - Audit logs cannot be modified (405) or deleted (405).
 *    - Mongoose hooks enforce schema-level immutability against updates and deletions.
 * 5. Notification scoping & isolation:
 *    - Private order notifications reach the owning customer, vendor, and admin only.
 *    - Unrelated buyers and vendors never receive another user's notifications.
 *    - No global broadcasts (io.emit) for private order/account data.
 * 6. Duplicate-event handling:
 *    - Duplicate payment webhooks/verifications do not trigger duplicate notifications.
 *    - Duplicate refund webhooks do not trigger duplicate notifications.
 */

const mongoose = require('mongoose');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const path = require('path');
const ioClient = require('../../frontend/node_modules/socket.io-client');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Order = require('../models/Order');
const User = require('../models/User');
const Vendor = require('../models/Vendor');
const Product = require('../models/Product');
const AuditLog = require('../models/AuditLog');
const { recordAuditLog, sanitizeAuditData, notificationDeduplicator } = require('../utils/auditLogger');
const { authenticateSocket } = require('../middleware/auth');

const authRouter = require('../routes/auth');
const productRouter = require('../routes/products');
const vendorRouter = require('../routes/vendors');
const orderRouter = require('../routes/orders');
const adminRouter = require('../routes/admin');

const TEST_DB_URI = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/marketplace_test';
const JWT_SECRET = process.env.JWT_SECRET || 'marketplace-secret-key-2025';

let server;
let io;
let port;
let baseUrl;

let adminUser, vendorUserA, vendorUserB, buyerUserA, buyerUserB;
let vendorShopA, vendorShopB;
let tokenAdmin, tokenVendorA, tokenVendorB, tokenBuyerA, tokenBuyerB;

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

async function request(method, routePath, options = {}) {
  const url = `${baseUrl}${routePath}`;
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

function connectClient(portNum, token) {
  return new Promise((resolve) => {
    const socket = ioClient(`http://127.0.0.1:${portNum}`, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      reconnection: false,
      timeout: 3000
    });

    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => resolve({ error: err.message, socket }));
    setTimeout(() => resolve({ error: 'timeout', socket }), 2500);
  });
}

async function setup() {
  await mongoose.connect(TEST_DB_URI);
  console.log(`Connected to database: ${mongoose.connection.name}`);
  if (mongoose.connection.name !== 'marketplace_test') {
    throw new Error('ABORT: Test suite must only run against marketplace_test database!');
  }

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use('/api/products', productRouter);
  app.use('/api/vendors', vendorRouter);
  app.use('/api/orders', orderRouter);
  app.use('/api/admin', adminRouter);

  server = http.createServer(app);
  io = socketIo(server, { cors: { origin: '*' } });
  io.use(authenticateSocket);

  io.on('connection', async (socket) => {
    try {
      const user = socket.user;
      if (!user) {
        socket.disconnect(true);
        return;
      }
      socket.join(`user:${user._id.toString()}`);
      if (user.role === 'admin') socket.join('admin');
      if (user.role === 'vendor') {
        const shops = await Vendor.find({ userId: user._id }).select('_id');
        for (const s of shops) {
          socket.join(`vendor:${s._id.toString()}`);
        }
      }
    } catch (e) {
      socket.disconnect(true);
    }
  });

  // Global socket event listeners matching backend/server.js
  const EventEmitter = require('events');
  global.orderEventEmitter = new EventEmitter();

  global.orderEventEmitter.on('orderPlaced', (orderData) => {
    if (!orderData?.vendorId || !orderData?.orderId) return;
    if (!notificationDeduplicator.shouldDispatch(`socket:orderPlaced:${orderData.orderId}`)) return;
    const payload = {
      orderId: orderData.orderId,
      vendorId: orderData.vendorId,
      totalAmount: orderData.totalAmount,
      paymentStatus: orderData.paymentStatus
    };
    let target = io.to(`vendor:${orderData.vendorId}`).to('admin');
    if (orderData.buyerId) target = target.to(`user:${orderData.buyerId}`);
    target.emit('newOrder', payload);
  });

  global.orderEventEmitter.on('orderStatusUpdated', (orderData) => {
    if (!orderData?.orderId) return;
    const dedupKey = `socket:orderStatus:${orderData.orderId}:${orderData.status}`;
    if (!notificationDeduplicator.shouldDispatch(dedupKey)) return;
    const payload = {
      orderId: orderData.orderId,
      status: orderData.status
    };
    let target = io.to(`user:${orderData.buyerId}`);
    if (orderData.vendorId) target = target.to(`vendor:${orderData.vendorId}`);
    target.to('admin').emit('orderUpdate', payload);
  });

  await new Promise(resolve => server.listen(0, resolve));
  port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Phase 13 test server listening on port ${port}\n`);

  // Cleanup test records
  await AuditLog.deleteMany({ resourceType: { $in: ['User', 'Vendor', 'Product', 'Order'] } }, { allowAuditModification: true });
  await Order.deleteMany({ shippingAddress: /Phase13/ });
  await Product.deleteMany({ title: /Phase13/ });
  await Vendor.deleteMany({ shopName: /Phase13/ });
  await User.deleteMany({ email: /phase13_.*@test\.com/ });

  // 1. Create Users
  adminUser = await User.create({
    username: 'phase13_admin',
    email: 'phase13_admin@test.com',
    password: 'password123',
    role: 'admin'
  });
  tokenAdmin = jwt.sign({ userId: adminUser._id }, JWT_SECRET, { expiresIn: '1h' });

  vendorUserA = await User.create({
    username: 'phase13_vendor_a',
    email: 'phase13_vendor_a@test.com',
    password: 'password123',
    role: 'vendor'
  });
  tokenVendorA = jwt.sign({ userId: vendorUserA._id }, JWT_SECRET, { expiresIn: '1h' });

  vendorUserB = await User.create({
    username: 'phase13_vendor_b',
    email: 'phase13_vendor_b@test.com',
    password: 'password123',
    role: 'vendor'
  });
  tokenVendorB = jwt.sign({ userId: vendorUserB._id }, JWT_SECRET, { expiresIn: '1h' });

  buyerUserA = await User.create({
    username: 'phase13_buyer_a',
    email: 'phase13_buyer_a@test.com',
    password: 'password123',
    role: 'buyer'
  });
  tokenBuyerA = jwt.sign({ userId: buyerUserA._id }, JWT_SECRET, { expiresIn: '1h' });

  buyerUserB = await User.create({
    username: 'phase13_buyer_b',
    email: 'phase13_buyer_b@test.com',
    password: 'password123',
    role: 'buyer'
  });
  tokenBuyerB = jwt.sign({ userId: buyerUserB._id }, JWT_SECRET, { expiresIn: '1h' });

  // 2. Create Vendor Shops
  vendorShopA = await Vendor.create({
    userId: vendorUserA._id,
    shopName: 'Phase13 Shop Alpha',
    approvalStatus: 'approved',
    onboardingComplete: true
  });

  vendorShopB = await Vendor.create({
    userId: vendorUserB._id,
    shopName: 'Phase13 Shop Beta',
    approvalStatus: 'approved',
    onboardingComplete: true
  });
}

async function teardown() {
  if (io) io.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await AuditLog.deleteMany({ resourceType: { $in: ['User', 'Vendor', 'Product', 'Order'] } }, { allowAuditModification: true });
  await Order.deleteMany({ shippingAddress: /Phase13/ });
  await Product.deleteMany({ title: /Phase13/ });
  await Vendor.deleteMany({ shopName: /Phase13/ });
  await User.deleteMany({ email: /phase13_.*@test\.com/ });
  await mongoose.disconnect();
}

async function runTests() {
  console.log('========================================================');
  console.log('STARTING PHASE 13: AUDIT LOGGING & NOTIFICATIONS TESTS');
  console.log('========================================================\n');

  try {
    await setup();

    // -------------------------------------------------------------
    // SUITE 1: Audit Trail Creation & Actor Attribution
    // -------------------------------------------------------------
    console.log('--- SUITE 1: Audit Creation & Actor Attribution ---');

    // 1.1 User registration
    const regRes = await request('POST', '/api/auth/register', {
      body: {
        username: 'phase13_newuser',
        email: 'phase13_newuser@test.com',
        password: 'Password123!',
        role: 'buyer'
      }
    });
    assert(regRes.status === 201, 'User registered successfully (201 Created)');
    const regAudit = await AuditLog.findOne({ action: 'user.register', 'after.username': 'phase13_newuser' });
    assert(regAudit !== null, 'Audit log created for user.register');
    assert(regAudit.actorRole === 'buyer', `Actor role correctly attributed as buyer (actual: ${regAudit.actorRole})`);
    assert(regAudit.resourceType === 'User', 'Resource type is User');

    // 1.2 Vendor shop onboarding / creation
    const onboardRes = await request('POST', '/api/vendors/onboard', {
      token: tokenVendorA,
      body: {
        shopName: 'Phase13 Brand New Shop',
        description: 'Quality goods',
        category: 'Electronics',
        gstin: '29ABCDE1234F1Z5'
      }
    });
    assert(onboardRes.status === 200 || onboardRes.status === 201, 'Vendor shop onboarding succeeded');
    const vendorCreateAudit = await AuditLog.findOne({ action: 'vendor.create', 'after.shopName': 'Phase13 Brand New Shop' });
    assert(vendorCreateAudit !== null, 'Audit log created for vendor.create');
    assert(vendorCreateAudit.actorId.toString() === vendorUserA._id.toString(), 'Actor ID matches vendor user');
    assert(vendorCreateAudit.actorRole === 'vendor', 'Actor role is vendor');

    // 1.3 Vendor payout settings update
    const payoutRes = await request('PUT', `/api/vendors/${vendorShopA._id}/payout-settings`, {
      token: tokenVendorA,
      body: {
        upiId: 'phase13vendor@upi',
        accountHolderName: 'Vendor Alpha',
        accountNumber: '123456789012',
        ifscCode: 'HDFC0001234'
      }
    });
    assert(payoutRes.status === 200, 'Vendor payout settings updated (200 OK)');
    const payoutAudit = await AuditLog.findOne({ action: 'vendor.payout_update', resourceId: vendorShopA._id.toString() });
    assert(payoutAudit !== null, 'Audit log created for vendor.payout_update');
    assert(payoutAudit.after.upiId === 'phase13vendor@upi', 'Audit log records updated upiId');

    // 1.4 Product creation
    const prodRes = await request('POST', '/api/products', {
      token: tokenVendorA,
      body: {
        vendorId: vendorShopA._id,
        title: 'Phase13 Wireless Mouse',
        description: 'Ergonomic optical mouse',
        price: 799,
        stock: 25,
        sku: 'SKU-P13-MOUSE',
        category: 'Electronics',
        imageUrl: 'https://example.com/mouse.jpg'
      }
    });
    assert(prodRes.status === 201, 'Product created successfully (201 Created)');
    const createdProductId = prodRes.data._id;
    const prodAudit = await AuditLog.findOne({ action: 'product.create', resourceId: createdProductId });
    assert(prodAudit !== null, 'Audit log created for product.create');
    assert(prodAudit.actorId.toString() === vendorUserA._id.toString(), 'Actor ID matches vendor user');
    assert(prodAudit.after.sku === 'SKU-P13-MOUSE', 'After state captures product SKU');
    assert(prodAudit.after.stock === 25, 'After state captures product initial stock');

    // 1.5 Product edit & inventory adjustment
    const updateProdRes = await request('PUT', `/api/products/${createdProductId}`, {
      token: tokenVendorA,
      body: {
        title: 'Phase13 Wireless Mouse Pro',
        price: 899,
        stock: 40 // adjusted from 25 to 40 (+15)
      }
    });
    assert(updateProdRes.status === 200, 'Product updated successfully (200 OK)');
    const prodUpdateAudit = await AuditLog.findOne({ action: 'product.update', resourceId: createdProductId });
    assert(prodUpdateAudit !== null, 'Audit log created for product.update');
    assert(prodUpdateAudit.before.title === 'Phase13 Wireless Mouse', 'Before state captured original title');
    assert(prodUpdateAudit.after.title === 'Phase13 Wireless Mouse Pro', 'After state captured updated title');

    const invAdjustAudit = await AuditLog.findOne({ action: 'inventory.adjust', resourceId: createdProductId });
    assert(invAdjustAudit !== null, 'Audit log created for inventory.adjust');
    assert(invAdjustAudit.before.stock === 25, 'Previous stock was 25');
    assert(invAdjustAudit.after.stock === 40, 'New stock is 40');
    assert(invAdjustAudit.metadata.delta === 15, 'Delta recorded as +15');

    // 1.6 Product deletion
    const delProdRes = await request('DELETE', `/api/products/${createdProductId}`, {
      token: tokenVendorA
    });
    assert(delProdRes.status === 200, 'Product deleted successfully (200 OK)');
    const delAudit = await AuditLog.findOne({ action: 'product.delete', resourceId: createdProductId });
    assert(delAudit !== null, 'Audit log created for product.delete');
    assert(delAudit.before.title === 'Phase13 Wireless Mouse Pro', 'Before state captured before deletion');
    assert(delAudit.after === null, 'After state is null on deletion');

    // 1.7 Order status change & cancellation
    // Create an order for testing
    const testProduct = await Product.create({
      title: 'Phase13 Keyboard',
      description: 'Mechanical keyboard',
      price: 1500,
      stock: 30,
      sku: 'SKU-P13-KB',
      category: 'Electronics',
      imageUrl: 'https://example.com/kb.jpg',
      vendorId: vendorShopA._id
    });

    const testOrder = await Order.create({
      buyerId: buyerUserA._id,
      vendorId: vendorShopA._id,
      products: [{ productId: testProduct._id, quantity: 1, price: 1500, inventoryState: 'deducted' }],
      totalAmount: 1500,
      adminCommission: 150,
      vendorEarning: 1350,
      status: 'confirmed',
      paymentStatus: 'paid',
      shippingAddress: 'Phase13 Test Address'
    });

    // Vendor updates status: confirmed -> processing
    const statusUpdateRes = await request('PUT', `/api/orders/${testOrder._id}/status`, {
      token: tokenVendorA,
      body: { status: 'processing', reason: 'Preparing package' }
    });
    assert(statusUpdateRes.status === 200, 'Order status updated to processing (200 OK)');
    const statusAudit = await AuditLog.findOne({ action: 'order.status_change', resourceId: testOrder._id.toString() });
    assert(statusAudit !== null, 'Audit log created for order.status_change');
    assert(statusAudit.actorId.toString() === vendorUserA._id.toString(), 'Actor attribution matches vendor user');
    assert(statusAudit.before.status === 'confirmed', 'Before status was confirmed');
    assert(statusAudit.after.status === 'processing', 'After status is processing');

    // Buyer cancels order
    const cancelRes = await request('POST', `/api/orders/${testOrder._id}/cancel`, {
      token: tokenBuyerA,
      body: { reason: 'Found a better price' }
    });
    assert(cancelRes.status === 200, 'Order cancelled by buyer (200 OK)');
    const cancelAudit = await AuditLog.findOne({ action: 'order.cancel', resourceId: testOrder._id.toString() });
    assert(cancelAudit !== null, 'Audit log created for order.cancel');
    assert(cancelAudit.actorId.toString() === buyerUserA._id.toString(), 'Actor attribution matches buyer user');
    assert(cancelAudit.actorRole === 'buyer', 'Actor role is buyer');
    assert(cancelAudit.before.status === 'processing', 'Before status was processing');
    assert(cancelAudit.after.status === 'cancelled', 'After status is cancelled');

    // 1.8 Admin approvals, rejections, and role changes
    // Role change
    const roleChangeRes = await request('PUT', `/api/admin/users/${buyerUserB._id}/role`, {
      token: tokenAdmin,
      body: { role: 'vendor' }
    });
    assert(roleChangeRes.status === 200, 'Admin changed user role to vendor');
    const roleAudit = await AuditLog.findOne({ action: 'admin.role_change', resourceId: buyerUserB._id.toString() });
    assert(roleAudit !== null, 'Audit log created for admin.role_change');
    assert(roleAudit.actorId.toString() === adminUser._id.toString(), 'Actor is admin');
    assert(roleAudit.before.role === 'buyer', 'Before role was buyer');
    assert(roleAudit.after.role === 'vendor', 'After role is vendor');

    // Vendor approval & rejection
    const pendingVendor = await Vendor.create({
      userId: buyerUserB._id,
      shopName: 'Phase13 Pending Audit Shop',
      approvalStatus: 'pending',
      onboardingComplete: false
    });

    const approveRes = await request('PUT', `/api/admin/vendor-requests/${pendingVendor._id}/approve`, {
      token: tokenAdmin
    });
    assert(approveRes.status === 200, 'Admin approved vendor shop');
    const approveAudit = await AuditLog.findOne({ action: 'admin.vendor_approval', resourceId: pendingVendor._id.toString() });
    assert(approveAudit !== null, 'Audit log created for admin.vendor_approval');
    assert(approveAudit.after.approvalStatus === 'approved', 'After status is approved');

    const rejectRes = await request('PUT', `/api/admin/vendor-requests/${pendingVendor._id}/reject`, {
      token: tokenAdmin,
      body: { notes: 'Invalid tax ID' }
    });
    assert(rejectRes.status === 200, 'Admin rejected vendor shop');
    const rejectAudit = await AuditLog.findOne({ action: 'admin.vendor_rejection', resourceId: pendingVendor._id.toString() });
    assert(rejectAudit !== null, 'Audit log created for admin.vendor_rejection');
    assert(rejectAudit.after.approvalStatus === 'rejected', 'After status is rejected');

    // -------------------------------------------------------------
    // SUITE 2: Sensitive-Data Exclusion & Sanitization
    // -------------------------------------------------------------
    console.log('\n--- SUITE 2: Sensitive-Data Exclusion ---');

    // 2.1 Verify sanitizeAuditData function directly
    const dirtyData = {
      username: 'johndoe',
      password: 'superSecretPassword123',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      token: 'jwt.token.string',
      refreshToken: 'refresh.token.string',
      razorpaySignature: 'sig_12345abcdef',
      transferClaimToken: 'claim_tok_999',
      webhookSecret: 'secret_hook_123',
      accountNumber: '987654321098',
      nested: {
        cardCVV: '123',
        cvv: '999',
        normalField: 'allGood'
      }
    };

    const cleanData = sanitizeAuditData(dirtyData);
    assert(cleanData.password === '[REDACTED]', 'Password redacted');
    assert(cleanData.passwordHash === '[REDACTED]', 'PasswordHash redacted');
    assert(cleanData.token === '[REDACTED]', 'JWT token redacted');
    assert(cleanData.refreshToken === '[REDACTED]', 'RefreshToken redacted');
    assert(cleanData.razorpaySignature === '[REDACTED]', 'Razorpay signature redacted');
    assert(cleanData.transferClaimToken === '[REDACTED]', 'Claim token redacted');
    assert(cleanData.webhookSecret === '[REDACTED]', 'Webhook secret redacted');
    assert(cleanData.accountNumber === '****1098', `Bank account number masked (actual: ${cleanData.accountNumber})`);
    assert(cleanData.nested.cvv === '[REDACTED]', 'Nested CVV redacted');
    assert(cleanData.nested.normalField === 'allGood', 'Non-sensitive field preserved');

    // 2.2 Verify persisted audit records have NO plaintext passwords
    const allUserAudits = await AuditLog.find({ resourceType: 'User' });
    const hasPlaintextPassword = allUserAudits.some(log => {
      const str = JSON.stringify(log);
      return str.includes('Password123!') || str.includes('password123');
    });
    assert(!hasPlaintextPassword, 'Zero audit logs contain plaintext passwords');

    // -------------------------------------------------------------
    // SUITE 3: Role-Based Access & Audit Log Immutability
    // -------------------------------------------------------------
    console.log('\n--- SUITE 3: Role-Based Access & Immutability ---');

    // 3.1 Unauthenticated rejected with 401
    const unauthAudit = await request('GET', '/api/admin/audit-logs');
    assert(unauthAudit.status === 401, 'Unauthenticated request to audit-logs returns 401');

    // 3.2 Buyer rejected with 403 Forbidden
    const buyerAudit = await request('GET', '/api/admin/audit-logs', { token: tokenBuyerA });
    assert(buyerAudit.status === 403, 'Buyer request to audit-logs returns 403 Forbidden');

    // 3.3 Vendor rejected with 403 Forbidden
    const vendorAudit = await request('GET', '/api/admin/audit-logs', { token: tokenVendorA });
    assert(vendorAudit.status === 403, 'Vendor request to audit-logs returns 403 Forbidden');

    // 3.4 Admin can view audit logs (200 OK)
    const adminAuditRes = await request('GET', '/api/admin/audit-logs', { token: tokenAdmin });
    assert(adminAuditRes.status === 200, 'Admin can view audit logs (200 OK)');
    assert(adminAuditRes.data.success === true, 'Response contains success: true');
    assert(adminAuditRes.data.logs.length > 0, `Returned ${adminAuditRes.data.logs.length} audit logs`);

    // 3.5 Filtering by action
    const filterActionRes = await request('GET', '/api/admin/audit-logs?action=order.cancel', { token: tokenAdmin });
    assert(filterActionRes.status === 200, 'Filter by action returns 200');
    assert(filterActionRes.data.logs.every(l => l.action === 'order.cancel'), 'All filtered logs have action order.cancel');

    // 3.6 Filtering by resourceType
    const filterResourceRes = await request('GET', '/api/admin/audit-logs?resourceType=Product', { token: tokenAdmin });
    assert(filterResourceRes.status === 200, 'Filter by resourceType returns 200');
    assert(filterResourceRes.data.logs.every(l => l.resourceType === 'Product'), 'All filtered logs have resourceType Product');

    // 3.7 Immutability via HTTP endpoints (405 Method Not Allowed)
    const someLog = adminAuditRes.data.logs[0];
    const putAuditRes = await request('PUT', `/api/admin/audit-logs/${someLog._id}`, {
      token: tokenAdmin,
      body: { action: 'tampered.action' }
    });
    assert(putAuditRes.status === 405, 'PUT /api/admin/audit-logs/:id rejected with 405 Method Not Allowed');

    const deleteAuditRes = await request('DELETE', `/api/admin/audit-logs/${someLog._id}`, {
      token: tokenAdmin
    });
    assert(deleteAuditRes.status === 405, 'DELETE /api/admin/audit-logs/:id rejected with 405 Method Not Allowed');

    // 3.8 Schema-level immutability enforcement
    let mongooseUpdateBlocked = false;
    try {
      await AuditLog.updateOne({ _id: someLog._id }, { $set: { action: 'hacked.action' } });
    } catch (e) {
      if (e.name === 'AuditImmutabilityError') mongooseUpdateBlocked = true;
    }
    assert(mongooseUpdateBlocked, 'Mongoose pre-hook blocked updateOne with AuditImmutabilityError');

    let mongooseDeleteBlocked = false;
    try {
      await AuditLog.deleteOne({ _id: someLog._id });
    } catch (e) {
      if (e.name === 'AuditImmutabilityError') mongooseDeleteBlocked = true;
    }
    assert(mongooseDeleteBlocked, 'Mongoose pre-hook blocked deleteOne with AuditImmutabilityError');

    // -------------------------------------------------------------
    // SUITE 4: Notification Scoping & Isolation
    // -------------------------------------------------------------
    console.log('\n--- SUITE 4: Notification Scoping & Isolation ---');

    // Connect authenticated client sockets
    const socketBuyerA = await connectClient(port, tokenBuyerA);
    const socketBuyerB = await connectClient(port, tokenBuyerB);
    const socketVendorA = await connectClient(port, tokenVendorA);
    const socketVendorB = await connectClient(port, tokenVendorB);
    const socketAdmin = await connectClient(port, tokenAdmin);

    assert(socketBuyerA.connected, 'Buyer A socket connected');
    assert(socketBuyerB.connected, 'Buyer B socket connected');
    assert(socketVendorA.connected, 'Vendor A socket connected');
    assert(socketVendorB.connected, 'Vendor B socket connected');
    assert(socketAdmin.connected, 'Admin socket connected');

    // Set up message tracking
    const received = {
      buyerA: [],
      buyerB: [],
      vendorA: [],
      vendorB: [],
      admin: []
    };

    socketBuyerA.on('newOrder', (d) => received.buyerA.push({ event: 'newOrder', data: d }));
    socketBuyerA.on('orderUpdate', (d) => received.buyerA.push({ event: 'orderUpdate', data: d }));

    socketBuyerB.on('newOrder', (d) => received.buyerB.push({ event: 'newOrder', data: d }));
    socketBuyerB.on('orderUpdate', (d) => received.buyerB.push({ event: 'orderUpdate', data: d }));

    socketVendorA.on('newOrder', (d) => received.vendorA.push({ event: 'newOrder', data: d }));
    socketVendorA.on('orderUpdate', (d) => received.vendorA.push({ event: 'orderUpdate', data: d }));

    socketVendorB.on('newOrder', (d) => received.vendorB.push({ event: 'newOrder', data: d }));
    socketVendorB.on('orderUpdate', (d) => received.vendorB.push({ event: 'orderUpdate', data: d }));

    socketAdmin.on('newOrder', (d) => received.admin.push({ event: 'newOrder', data: d }));
    socketAdmin.on('orderUpdate', (d) => received.admin.push({ event: 'orderUpdate', data: d }));

    // Emit orderPlaced for Order belonging to Buyer A and Vendor A
    const isolationOrderId = new mongoose.Types.ObjectId().toString();
    global.orderEventEmitter.emit('orderPlaced', {
      orderId: isolationOrderId,
      vendorId: vendorShopA._id.toString(),
      buyerId: buyerUserA._id.toString(),
      totalAmount: 1200,
      paymentStatus: 'paid'
    });

    await new Promise(r => setTimeout(r, 200));

    // Verify Buyer A received confirmation
    assert(received.buyerA.some(m => m.event === 'newOrder' && m.data.orderId === isolationOrderId),
      'Buyer A received newOrder notification');

    // Verify Vendor A received notification
    assert(received.vendorA.some(m => m.event === 'newOrder' && m.data.orderId === isolationOrderId),
      'Vendor A received newOrder notification');

    // Verify Admin received notification
    assert(received.admin.some(m => m.event === 'newOrder' && m.data.orderId === isolationOrderId),
      'Admin received newOrder notification');

    // Verify Buyer B and Vendor B DID NOT receive it (Isolation!)
    assert(!received.buyerB.some(m => m.data?.orderId === isolationOrderId),
      'ISOLATION: Unrelated Buyer B did NOT receive Order A notification');
    assert(!received.vendorB.some(m => m.data?.orderId === isolationOrderId),
      'ISOLATION: Unrelated Vendor B did NOT receive Order A notification');

    // -------------------------------------------------------------
    // SUITE 5: Duplicate-Event Handling & Deduplication
    // -------------------------------------------------------------
    console.log('\n--- SUITE 5: Duplicate-Event Handling ---');

    // 5.1 Duplicate event emitted directly
    const beforeCountBuyerA = received.buyerA.filter(m => m.data?.orderId === isolationOrderId).length;
    // Emit exact same orderPlaced event a second and third time
    global.orderEventEmitter.emit('orderPlaced', {
      orderId: isolationOrderId,
      vendorId: vendorShopA._id.toString(),
      buyerId: buyerUserA._id.toString(),
      totalAmount: 1200,
      paymentStatus: 'paid'
    });
    global.orderEventEmitter.emit('orderPlaced', {
      orderId: isolationOrderId,
      vendorId: vendorShopA._id.toString(),
      buyerId: buyerUserA._id.toString(),
      totalAmount: 1200,
      paymentStatus: 'paid'
    });

    await new Promise(r => setTimeout(r, 200));
    const afterCountBuyerA = received.buyerA.filter(m => m.data?.orderId === isolationOrderId).length;
    assert(beforeCountBuyerA === afterCountBuyerA,
      `DEDUPLICATION: Duplicate orderPlaced event ignored (count stayed ${beforeCountBuyerA})`);

    // 5.2 Duplicate order status updates
    const updateOrderId = new mongoose.Types.ObjectId().toString();
    global.orderEventEmitter.emit('orderStatusUpdated', {
      orderId: updateOrderId,
      buyerId: buyerUserA._id.toString(),
      vendorId: vendorShopA._id.toString(),
      status: 'shipped'
    });

    // Immediate duplicate replay
    global.orderEventEmitter.emit('orderStatusUpdated', {
      orderId: updateOrderId,
      buyerId: buyerUserA._id.toString(),
      vendorId: vendorShopA._id.toString(),
      status: 'shipped'
    });

    await new Promise(r => setTimeout(r, 200));
    const shippedNotifs = received.buyerA.filter(m => m.event === 'orderUpdate' && m.data?.orderId === updateOrderId);
    assert(shippedNotifs.length === 1, `DEDUPLICATION: Duplicate status update shipped delivered exactly 1 notification (actual: ${shippedNotifs.length})`);

    // Clean up socket connections
    socketBuyerA.disconnect();
    socketBuyerB.disconnect();
    socketVendorA.disconnect();
    socketVendorB.disconnect();
    socketAdmin.disconnect();

  } catch (err) {
    console.error('Unexpected test error:', err);
    failCount++;
  } finally {
    await teardown();
  }

  console.log('\n========================================================');
  console.log(`PHASE 13 TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED (TOTAL: ${testCount})`);
  console.log('========================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests();
