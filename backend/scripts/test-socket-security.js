/**
 * Automated Security Test Suite
 * Socket.IO Authentication & Private Order Notification Scoping
 *
 * Covers:
 * 1. User without token cannot connect
 * 2. Invalid or expired token cannot connect
 * 3. Buyer cannot receive another buyer's private order notification
 * 4. Vendor A cannot receive Vendor B's private order notification
 * 5. Vendor receives notifications for all their authorized shops (multi-shop support)
 * 6. Order update reaches the correct buyer and vendor only
 * 7. Unauthorized client cannot join another user's room
 * 8. Existing authorized notification functionality works as expected
 */

const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const { EventEmitter } = require('events');
const ioClient = require('../../frontend/node_modules/socket.io-client');
const User = require('../models/User');
const Vendor = require('../models/Vendor');
const { authenticateSocket } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'marketplace-secret-key-2025';

// Mock in-memory test data
const mockUsers = {
  buyer1: { _id: '64a000000000000000000001', username: 'buyer_one', email: 'buyer1@test.com', role: 'buyer' },
  buyer2: { _id: '64a000000000000000000002', username: 'buyer_two', email: 'buyer2@test.com', role: 'buyer' },
  vendorA: { _id: '64a000000000000000000003', username: 'vendor_a', email: 'vendorA@test.com', role: 'vendor' },
  vendorB: { _id: '64a000000000000000000004', username: 'vendor_b', email: 'vendorB@test.com', role: 'vendor' },
  admin: { _id: '64a000000000000000000005', username: 'super_admin', email: 'admin@test.com', role: 'admin' }
};

const mockShops = {
  shopA1: { _id: '64b000000000000000000001', userId: mockUsers.vendorA._id, shopName: 'Vendor A Electronics' },
  shopA2: { _id: '64b000000000000000000002', userId: mockUsers.vendorA._id, shopName: 'Vendor A Clothing' },
  shopB1: { _id: '64b000000000000000000003', userId: mockUsers.vendorB._id, shopName: 'Vendor B Groceries' }
};

// Stub Mongoose User.findById
const origUserFindById = User.findById;
User.findById = function (id) {
  const targetId = id?.toString();
  const user = Object.values(mockUsers).find(u => u._id === targetId);
  return Promise.resolve(user || null);
};

// Stub Mongoose Vendor.find
const origVendorFind = Vendor.find;
Vendor.find = function (query) {
  let list = Object.values(mockShops);
  if (query?.userId) {
    list = list.filter(s => s.userId === query.userId.toString());
  }
  return {
    select: () => Promise.resolve(list)
  };
};

// Create test tokens
const tokens = {
  buyer1: jwt.sign({ userId: mockUsers.buyer1._id }, JWT_SECRET, { expiresIn: '1h' }),
  buyer2: jwt.sign({ userId: mockUsers.buyer2._id }, JWT_SECRET, { expiresIn: '1h' }),
  vendorA: jwt.sign({ userId: mockUsers.vendorA._id }, JWT_SECRET, { expiresIn: '1h' }),
  vendorB: jwt.sign({ userId: mockUsers.vendorB._id }, JWT_SECRET, { expiresIn: '1h' }),
  admin: jwt.sign({ userId: mockUsers.admin._id }, JWT_SECRET, { expiresIn: '1h' }),
  expired: jwt.sign({ userId: mockUsers.buyer1._id }, JWT_SECRET, { expiresIn: '-1s' }),
  invalid: 'invalid.token.signature'
};

function createTestServer() {
  const server = http.createServer();
  const io = socketIo(server, { cors: { origin: '*' } });
  const emitter = new EventEmitter();

  io.use(authenticateSocket);

  io.on('connection', async (socket) => {
    try {
      const user = socket.user;
      if (!user) {
        socket.disconnect(true);
        return;
      }

      socket.join(`user:${user._id.toString()}`);

      if (user.role === 'admin') {
        socket.join('admin');
      }

      if (user.role === 'vendor') {
        const shops = await Vendor.find({ userId: user._id }).select('_id');
        for (const shop of shops) {
          socket.join(`vendor:${shop._id.toString()}`);
        }
      }
    } catch (e) {
      socket.disconnect(true);
    }
  });

  // Global scoped event listeners
  emitter.on('orderPlaced', (orderData) => {
    if (!orderData?.vendorId) return;
    const payload = {
      orderId: orderData.orderId,
      vendorId: orderData.vendorId,
      totalAmount: orderData.totalAmount,
      paymentStatus: orderData.paymentStatus
    };
    io.to(`vendor:${orderData.vendorId}`).to('admin').emit('newOrder', payload);
  });

  emitter.on('orderStatusUpdated', (orderData) => {
    if (!orderData?.orderId) return;
    const payload = {
      orderId: orderData.orderId,
      status: orderData.status
    };
    let target = io.to(`user:${orderData.buyerId}`);
    if (orderData.vendorId) {
      target = target.to(`vendor:${orderData.vendorId}`);
    }
    target.to('admin').emit('orderUpdate', payload);
  });

  emitter.on('disputeCreated', (disputeData) => {
    if (!disputeData?.disputeId) return;
    const payload = {
      disputeId: disputeData.disputeId,
      vendorId: disputeData.vendorId
    };
    io.to(`vendor:${disputeData.vendorId}`)
      .to(`user:${disputeData.buyerId}`)
      .to('admin')
      .emit('newDispute', payload);
  });

  emitter.on('vendorRequestSubmitted', (requestData) => {
    if (!requestData?.vendorId) return;
    const payload = {
      vendorId: requestData.vendorId,
      shopName: requestData.shopName
    };
    io.to('admin').emit('newVendorRequest', payload);
  });

  return { server, io, emitter };
}

function connectClient(port, token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://localhost:${port}`, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      reconnection: false,
      timeout: 2000
    });

    socket.on('connect', () => {
      resolve({ socket, error: null });
    });

    socket.on('connect_error', (err) => {
      resolve({ socket, error: err });
    });
  });
}

function waitForEvent(socket, eventName, timeoutMs = 400) {
  return new Promise((resolve) => {
    let timer;
    const listener = (data) => {
      clearTimeout(timer);
      socket.off(eventName, listener);
      resolve(data);
    };
    socket.on(eventName, listener);
    timer = setTimeout(() => {
      socket.off(eventName, listener);
      resolve(null);
    }, timeoutMs);
  });
}

async function runTests() {
  console.log('\n============================================================');
  console.log(' RUNNING SOCKET.IO SECURITY & NOTIFICATION TEST SUITE');
  console.log('============================================================\n');

  const { server, io, emitter } = createTestServer();
  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;
  console.log(`Test server running on port: ${port}\n`);

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  \x1b[32m✔ PASS\x1b[0m: ${message}`);
      passed++;
    } else {
      console.error(`  \x1b[31m✖ FAIL\x1b[0m: ${message}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // Test 1: User without token cannot connect
    // -------------------------------------------------------------
    console.log('Test 1: User without token cannot connect');
    const resNoToken = await connectClient(port, null);
    assert(
      resNoToken.error !== null && /Authentication required/i.test(resNoToken.error.message),
      'Connection rejected when no token is provided'
    );
    resNoToken.socket.close();

    // -------------------------------------------------------------
    // Test 2: Invalid or expired token cannot connect
    // -------------------------------------------------------------
    console.log('\nTest 2: Invalid or expired token cannot connect');
    const resInvalid = await connectClient(port, tokens.invalid);
    assert(
      resInvalid.error !== null && /Invalid token/i.test(resInvalid.error.message),
      'Connection rejected for malformed / invalid signature token'
    );
    resInvalid.socket.close();

    const resExpired = await connectClient(port, tokens.expired);
    assert(
      resExpired.error !== null && /Invalid token/i.test(resExpired.error.message),
      'Connection rejected for expired token'
    );
    resExpired.socket.close();

    // -------------------------------------------------------------
    // Setup authenticated clients for isolation tests
    // -------------------------------------------------------------
    const clientBuyer1 = (await connectClient(port, tokens.buyer1)).socket;
    const clientBuyer2 = (await connectClient(port, tokens.buyer2)).socket;
    const clientVendorA = (await connectClient(port, tokens.vendorA)).socket;
    const clientVendorB = (await connectClient(port, tokens.vendorB)).socket;
    const clientAdmin = (await connectClient(port, tokens.admin)).socket;

    // -------------------------------------------------------------
    // Test 3: Buyer cannot receive another buyer's private order notification
    // -------------------------------------------------------------
    console.log('\nTest 3: Buyer isolation (cross-buyer eavesdropping prevention)');
    const pBuyer1 = waitForEvent(clientBuyer1, 'orderUpdate');
    const pBuyer2 = waitForEvent(clientBuyer2, 'orderUpdate');

    emitter.emit('orderStatusUpdated', {
      orderId: 'order_1001',
      buyerId: mockUsers.buyer1._id,
      vendorId: mockShops.shopA1._id,
      status: 'shipped'
    });

    const [buyer1Update, buyer2Update] = await Promise.all([pBuyer1, pBuyer2]);
    assert(buyer1Update !== null && buyer1Update.orderId === 'order_1001', 'Buyer 1 receives their own order update');
    assert(buyer2Update === null, 'Buyer 2 does NOT receive Buyer 1\'s order update');

    // -------------------------------------------------------------
    // Test 4: Vendor A cannot receive Vendor B's private order notification
    // -------------------------------------------------------------
    console.log('\nTest 4: Vendor isolation (cross-vendor eavesdropping prevention)');
    const pVendorA_test4 = waitForEvent(clientVendorA, 'newOrder');
    const pVendorB_test4 = waitForEvent(clientVendorB, 'newOrder');

    emitter.emit('orderPlaced', {
      orderId: 'order_2001',
      vendorId: mockShops.shopA1._id,
      buyerId: mockUsers.buyer1._id,
      totalAmount: 1499.00,
      paymentStatus: 'paid'
    });

    const [vendorAOrder, vendorBOrder] = await Promise.all([pVendorA_test4, pVendorB_test4]);
    assert(vendorAOrder !== null && vendorAOrder.orderId === 'order_2001', 'Vendor A receives new order for Shop A1');
    assert(vendorBOrder === null, 'Vendor B does NOT receive Vendor A\'s new order');

    // -------------------------------------------------------------
    // Test 5: Vendor receives notifications for all their authorized shops (multi-shop)
    // -------------------------------------------------------------
    console.log('\nTest 5: Multi-shop vendor authorization');
    const pVendorA_shop2 = waitForEvent(clientVendorA, 'newOrder');
    const pVendorB_shop2 = waitForEvent(clientVendorB, 'newOrder');

    emitter.emit('orderPlaced', {
      orderId: 'order_2002',
      vendorId: mockShops.shopA2._id, // Vendor A's secondary shop
      buyerId: mockUsers.buyer2._id,
      totalAmount: 499.00,
      paymentStatus: 'paid'
    });

    const [vendorAShop2Order, vendorBShop2Order] = await Promise.all([pVendorA_shop2, pVendorB_shop2]);
    assert(vendorAShop2Order !== null && vendorAShop2Order.orderId === 'order_2002', 'Vendor A receives order for their second shop (Shop A2)');
    assert(vendorBShop2Order === null, 'Vendor B does NOT receive order for Shop A2');

    // -------------------------------------------------------------
    // Test 6: Order status update reaches correct buyer and vendor
    // -------------------------------------------------------------
    console.log('\nTest 6: Order status update reaches correct buyer and vendor simultaneously');
    const pBuyer1_t6 = waitForEvent(clientBuyer1, 'orderUpdate');
    const pVendorA_t6 = waitForEvent(clientVendorA, 'orderUpdate');
    const pBuyer2_t6 = waitForEvent(clientBuyer2, 'orderUpdate');
    const pVendorB_t6 = waitForEvent(clientVendorB, 'orderUpdate');

    emitter.emit('orderStatusUpdated', {
      orderId: 'order_3001',
      buyerId: mockUsers.buyer1._id,
      vendorId: mockShops.shopA1._id,
      status: 'delivered'
    });

    const [b1_res, va_res, b2_res, vb_res] = await Promise.all([pBuyer1_t6, pVendorA_t6, pBuyer2_t6, pVendorB_t6]);
    assert(b1_res !== null && b1_res.status === 'delivered', 'Target Buyer 1 receives delivery status update');
    assert(va_res !== null && va_res.status === 'delivered', 'Fulfilling Vendor A receives delivery status update');
    assert(b2_res === null, 'Unrelated Buyer 2 does NOT receive status update');
    assert(vb_res === null, 'Unrelated Vendor B does NOT receive status update');

    // -------------------------------------------------------------
    // Test 7: Unauthorized client cannot join another user's or admin room
    // -------------------------------------------------------------
    console.log('\nTest 7: Room tampering protection (client cannot join arbitrary rooms)');
    // Client attempts to emit custom join events or access admin room
    clientBuyer1.emit('join', 'admin');
    clientBuyer1.emit('joinRoom', `vendor:${mockShops.shopB1._id}`);

    const pBuyer1_adminEvent = waitForEvent(clientBuyer1, 'newVendorRequest', 300);
    const pAdmin_adminEvent = waitForEvent(clientAdmin, 'newVendorRequest', 300);

    emitter.emit('vendorRequestSubmitted', {
      vendorId: 'vendor_req_99',
      shopName: 'Attempted Fake Shop'
    });

    const [b1AdminCheck, adminCheck] = await Promise.all([pBuyer1_adminEvent, pAdmin_adminEvent]);
    assert(adminCheck !== null && adminCheck.shopName === 'Attempted Fake Shop', 'Admin receives vendor shop request');
    assert(b1AdminCheck === null, 'Buyer 1 cannot join admin room and receives no admin events');

    // -------------------------------------------------------------
    // Test 8: Authorized notification functionality works (Dispute notification)
    // -------------------------------------------------------------
    console.log('\nTest 8: Legitimate notification delivery for disputes');
    const pBuyer1_dispute = waitForEvent(clientBuyer1, 'newDispute');
    const pVendorA_dispute = waitForEvent(clientVendorA, 'newDispute');
    const pBuyer2_dispute = waitForEvent(clientBuyer2, 'newDispute');
    const pVendorB_dispute = waitForEvent(clientVendorB, 'newDispute');
    const pAdmin_dispute = waitForEvent(clientAdmin, 'newDispute');

    emitter.emit('disputeCreated', {
      disputeId: 'disp_555',
      vendorId: mockShops.shopA1._id,
      buyerId: mockUsers.buyer1._id
    });

    const [d_b1, d_va, d_b2, d_vb, d_adm] = await Promise.all([
      pBuyer1_dispute,
      pVendorA_dispute,
      pBuyer2_dispute,
      pVendorB_dispute,
      pAdmin_dispute
    ]);

    assert(d_b1 !== null && d_b1.disputeId === 'disp_555', 'Filing Buyer 1 receives dispute notification');
    assert(d_va !== null && d_va.disputeId === 'disp_555', 'Involved Vendor A receives dispute notification');
    assert(d_adm !== null && d_adm.disputeId === 'disp_555', 'Admin receives dispute notification');
    assert(d_b2 === null, 'Unrelated Buyer 2 does NOT receive dispute notification');
    assert(d_vb === null, 'Unrelated Vendor B does NOT receive dispute notification');

    // Cleanup
    clientBuyer1.close();
    clientBuyer2.close();
    clientVendorA.close();
    clientVendorB.close();
    clientAdmin.close();

    await new Promise(r => server.close(r));

    // Restore stubs
    User.findById = origUserFindById;
    Vendor.find = origVendorFind;

    console.log('\n============================================================');
    console.log(` TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('============================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Unexpected test error:', err);
    process.exit(1);
  }
}

runTests();

