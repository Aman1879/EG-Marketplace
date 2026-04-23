const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const Order = require('../models/Order');
const Product = require('../models/Product');
const Vendor = require('../models/Vendor');
const Commission = require('../models/Commission');
const { authenticate, authorize } = require('../middleware/auth');
const { razorpay, razorpayKeyId, razorpayKeySecret, hasRazorpayCredentials } = require('../config/razorpay');

const COMMISSION_RATE = Number(process.env.ADMIN_COMMISSION_RATE || 0.10);

function roundCurrency(value) {
  return Number((value || 0).toFixed(2));
}

function toPaise(value) {
  return Math.round(Number(value || 0) * 100);
}

async function buildOrderPayload(products) {
  let totalAmount = 0;
  const orderProducts = [];
  let vendorId = null;

  for (const item of products) {
    const product = await Product.findById(item.productId);
    if (!product) {
      throw new Error(`Product ${item.productId} not found`);
    }

    if (product.stock < Number(item.quantity)) {
      throw new Error(`Insufficient stock for ${product.title}`);
    }

    if (!vendorId) {
      vendorId = product.vendorId;
    } else if (vendorId.toString() !== product.vendorId.toString()) {
      throw new Error('All products must be from the same vendor');
    }

    const itemTotal = Number(product.price) * Number(item.quantity);
    totalAmount += itemTotal;

    orderProducts.push({
      productId: product._id,
      quantity: Number(item.quantity),
      price: Number(product.price)
    });
  }

  if (!vendorId) {
    throw new Error('Could not identify vendor for order');
  }

  const vendorEarning = roundCurrency(totalAmount * (1 - COMMISSION_RATE));
  const adminCommission = roundCurrency(totalAmount * COMMISSION_RATE);

  return {
    vendorId,
    totalAmount: roundCurrency(totalAmount),
    vendorEarning,
    adminCommission,
    orderProducts
  };
}

async function createVendorTransfer({ razorpayPaymentId, order }) {
  const vendor = await Vendor.findById(order.vendorId);
  if (!vendor || !vendor.razorpayAccountId) {
    throw new Error('Vendor is not onboarded for Razorpay Route payouts');
  }

  const vendorAmountPaise = toPaise(order.vendorEarning);
  const transferResponse = await razorpay.payments.transfer(razorpayPaymentId, {
    transfers: [
      {
        account: vendor.razorpayAccountId,
        amount: vendorAmountPaise,
        currency: 'INR',
        notes: {
          orderId: order._id.toString(),
          vendorId: order.vendorId.toString(),
          commission: String(order.adminCommission)
        },
        on_hold: 0
      }
    ]
  });

  const transfer = transferResponse?.items?.[0] || null;
  if (!transfer) {
    throw new Error('Transfer API did not return transfer details');
  }

  order.transferId = transfer.id;
  order.transferStatus = transfer.status || 'queued';
  order.transferError = '';

  vendor.totalPaidEarnings += order.vendorEarning;
  await vendor.save();

  return transfer;
}

// Mandatory payment flow: create Razorpay order
router.post('/create-razorpay-order', authenticate, authorize('buyer'), async (req, res) => {
  try {
    if (!hasRazorpayCredentials) {
      return res.status(500).json({ message: 'Razorpay credentials are not configured on server' });
    }

    const { products, shippingAddress } = req.body;

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: 'Products are required' });
    }

    if (!shippingAddress || !String(shippingAddress).trim()) {
      return res.status(400).json({ message: 'Shipping address is required' });
    }

    const payload = await buildOrderPayload(products);
    const vendor = await Vendor.findById(payload.vendorId);
    if (!vendor || !vendor.razorpayAccountId) {
      return res.status(400).json({ message: 'Vendor payout account is not configured yet for this shop' });
    }

    const order = await Order.create({
      buyerId: req.user._id,
      vendorId: payload.vendorId,
      products: payload.orderProducts,
      totalAmount: payload.totalAmount,
      vendorEarning: payload.vendorEarning,
      adminCommission: payload.adminCommission,
      commissionRate: COMMISSION_RATE,
      shippingAddress: shippingAddress.trim(),
      paymentStatus: 'created',
      transferStatus: 'not_initiated'
    });

    const razorpayOrder = await razorpay.orders.create({
      amount: toPaise(payload.totalAmount),
      currency: 'INR',
      receipt: `order_${order._id.toString().slice(-12)}`,
      payment_capture: 1,
      notes: {
        appOrderId: order._id.toString(),
        buyerId: req.user._id.toString(),
        vendorId: payload.vendorId.toString()
      }
    });

    order.razorpayOrderId = razorpayOrder.id;
    await order.save();

    res.status(201).json({
      message: 'Razorpay order created',
      key: razorpayKeyId,
      orderId: order._id,
      amount: payload.totalAmount,
      currency: 'INR',
      commissionRate: COMMISSION_RATE,
      vendorEarning: payload.vendorEarning,
      adminCommission: payload.adminCommission,
      razorpayOrder
    });
  } catch (error) {
    const statusCode = /not found|Insufficient stock|same vendor/i.test(error.message) ? 400 : 500;
    res.status(statusCode).json({ message: error.message || 'Server error' });
  }
});

// Verify signature, mark paid, then transfer vendor share
router.post('/verify-payment', authenticate, authorize('buyer'), async (req, res) => {
  try {
    const {
      orderId,
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: razorpaySignature
    } = req.body;

    if (!orderId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({ message: 'Missing Razorpay payment verification fields' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.buyerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to verify this order' });
    }

    if (order.paymentStatus === 'paid') {
      return res.json({ message: 'Payment already verified', order });
    }

    if (order.razorpayOrderId !== razorpayOrderId) {
      return res.status(400).json({ message: 'Razorpay order mismatch' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', razorpayKeySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    if (expectedSignature !== razorpaySignature) {
      order.paymentStatus = 'failed';
      order.failureReason = 'Invalid Razorpay signature';
      await order.save();
      return res.status(400).json({ message: 'Payment verification failed (invalid signature)' });
    }

    // Move inventory after successful payment verification.
    for (const item of order.products) {
      const product = await Product.findById(item.productId);
      if (!product) {
        throw new Error(`Product ${item.productId} not found`);
      }
      if (product.stock < item.quantity) {
        throw new Error(`Insufficient stock for ${product.title}`);
      }
      product.stock -= item.quantity;
      await product.save();
    }

    order.razorpayPaymentId = razorpayPaymentId;
    order.razorpaySignature = razorpaySignature;
    order.paymentStatus = 'paid';
    order.paymentMethod = 'razorpay';

    const paymentDetails = await razorpay.payments.fetch(razorpayPaymentId);
    if (paymentDetails?.status) {
      order.paymentStatus = paymentDetails.status === 'captured' ? 'paid' : 'authorized';
    }

    try {
      await createVendorTransfer({ razorpayPaymentId, order });
    } catch (transferError) {
      // Payment is valid even if transfer is delayed/fails; keep explicit transfer error state.
      order.transferStatus = 'failed';
      order.transferError = transferError.message;
    }

    await order.save();

    await Commission.findOneAndUpdate(
      { orderId: order._id },
      {
        orderId: order._id,
        totalAmount: order.totalAmount,
        vendorEarning: order.vendorEarning,
        commissionAmount: order.adminCommission,
        commissionRate: order.commissionRate
      },
      { new: true, upsert: true }
    );

    const vendor = await Vendor.findById(order.vendorId);
    if (vendor) {
      vendor.totalEarnings += order.vendorEarning;
      await vendor.save();
    }

    if (global.orderEventEmitter) {
      global.orderEventEmitter.emit('orderPlaced', {
        orderId: order._id.toString(),
        vendorId: order.vendorId.toString(),
        buyerId: req.user._id.toString(),
        totalAmount: order.totalAmount,
        paymentStatus: order.paymentStatus
      });
    }

    res.json({ message: 'Payment verified and transfer initiated', order });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Razorpay webhook
router.post('/webhook/razorpay', async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];

    if (!webhookSecret || !signature) {
      return res.status(400).json({ message: 'Webhook secret or signature missing' });
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body || {});
    const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

    if (expected !== signature) {
      return res.status(400).json({ message: 'Invalid webhook signature' });
    }

    const eventPayload = Buffer.isBuffer(req.body)
      ? JSON.parse(req.body.toString('utf8'))
      : req.body;
    const event = eventPayload?.event;
    const paymentEntity = eventPayload?.payload?.payment?.entity;
    const refundEntity = eventPayload?.payload?.refund?.entity;

    if (event === 'payment.failed' && paymentEntity?.order_id) {
      await Order.findOneAndUpdate(
        { razorpayOrderId: paymentEntity.order_id },
        {
          paymentStatus: 'failed',
          failureReason: paymentEntity.error_description || paymentEntity.error_reason || 'Payment failed'
        }
      );
    }

    if (event === 'payment.captured' && paymentEntity?.order_id) {
      await Order.findOneAndUpdate(
        { razorpayOrderId: paymentEntity.order_id },
        {
          paymentStatus: 'paid',
          razorpayPaymentId: paymentEntity.id || ''
        }
      );
    }

    if (event === 'refund.processed' && refundEntity?.payment_id) {
      await Order.findOneAndUpdate(
        { razorpayPaymentId: refundEntity.payment_id },
        {
          paymentStatus: 'refunded',
          refundId: refundEntity.id || '',
          refundAmount: roundCurrency((refundEntity.amount || 0) / 100)
        }
      );
    }

    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ message: 'Webhook processing failed', error: error.message });
  }
});

// Backward compatibility endpoint for old checkout flow
router.post('/', authenticate, authorize('buyer'), async (req, res) => {
  return res.status(400).json({
    message: 'Direct order creation is disabled. Please use /api/orders/create-razorpay-order and /api/orders/verify-payment.'
  });
});

// Refund API (admin only)
router.post('/:id/refund', authenticate, authorize('admin'), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (!order.razorpayPaymentId || order.paymentStatus !== 'paid') {
      return res.status(400).json({ message: 'Only paid Razorpay orders can be refunded' });
    }

    const requestedAmount = Number(req.body.amount || order.totalAmount);
    const refundAmount = Math.min(requestedAmount, order.totalAmount);

    const refund = await razorpay.payments.refund(order.razorpayPaymentId, {
      amount: toPaise(refundAmount),
      notes: {
        orderId: order._id.toString(),
        reason: req.body.reason || 'Admin initiated refund'
      }
    });

    order.paymentStatus = 'refunded';
    order.refundId = refund.id;
    order.refundAmount = roundCurrency((refund.amount || 0) / 100);
    order.status = 'cancelled';
    await order.save();

    res.json({ message: 'Refund initiated successfully', order, refund });
  } catch (error) {
    res.status(500).json({ message: 'Refund failed', error: error.message });
  }
});

// Get buyer's orders
router.get('/buyer/my-orders', authenticate, authorize('buyer'), async (req, res) => {
  try {
    const orders = await Order.find({ buyerId: req.user._id })
      .populate('vendorId', 'shopName')
      .populate('products.productId', 'title imageUrl')
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get vendor's orders
router.get('/vendor/my-orders', authenticate, authorize('vendor'), async (req, res) => {
  try {
    const vendors = await Vendor.find({ userId: req.user._id });
    if (!vendors || vendors.length === 0) {
      return res.status(404).json({ message: 'Vendor profile not found' });
    }

    const vendorIds = vendors.map(v => v._id);

    const orders = await Order.find({ vendorId: { $in: vendorIds } })
      .populate('buyerId', 'username email')
      .populate('vendorId', 'shopName')
      .populate('products.productId', 'title imageUrl')
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update order status (vendor only)
router.put('/:id/status', authenticate, authorize('vendor'), async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'Pending', 'Shipped', 'Delivered', 'Cancelled'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const normalizedStatus = status.toLowerCase();
    const vendors = await Vendor.find({ userId: req.user._id });
    if (!vendors || vendors.length === 0) {
      return res.status(404).json({ message: 'Vendor profile not found' });
    }

    const vendorIds = vendors.map(v => v._id.toString());
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (!vendorIds.includes(order.vendorId.toString())) {
      return res.status(403).json({ message: 'Not authorized to update this order' });
    }

    order.status = normalizedStatus;
    await order.save();

    if (global.orderEventEmitter) {
      global.orderEventEmitter.emit('orderStatusUpdated', {
        orderId: order._id.toString(),
        buyerId: order.buyerId.toString(),
        status: normalizedStatus
      });
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get single order
router.get('/:id', authenticate, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('buyerId', 'username email')
      .populate('vendorId', 'shopName')
      .populate('products.productId', 'title imageUrl price');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const vendors = await Vendor.find({ userId: req.user._id }).select('_id');
    const vendorIdSet = new Set(vendors.map(v => v._id.toString()));

    const isBuyer = order.buyerId._id.toString() === req.user._id.toString();
    const isVendor = vendorIdSet.has(order.vendorId._id.toString());
    const isAdmin = req.user.role === 'admin';

    if (!isBuyer && !isVendor && !isAdmin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

