const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');
const Vendor = require('../models/Vendor');
const Commission = require('../models/Commission');
const { authenticate, authorize } = require('../middleware/auth');

const COMMISSION_RATE = 0.10; // 10%

// Create order (buyer only)
router.post('/', authenticate, authorize('buyer'), async (req, res) => {
  try {
    const { products, shippingAddress } = req.body;

    if (!products || products.length === 0) {
      return res.status(400).json({ message: 'Products are required' });
    }

    if (!shippingAddress) {
      return res.status(400).json({ message: 'Shipping address is required' });
    }

    let totalAmount = 0;
    const orderProducts = [];
    let vendorId = null;

    // Validate products and calculate total
    for (const item of products) {
      const product = await Product.findById(item.productId);
      if (!product) {
        return res.status(404).json({ message: `Product ${item.productId} not found` });
      }

      if (product.stock < item.quantity) {
        return res.status(400).json({ message: `Insufficient stock for ${product.title}` });
      }

      if (!vendorId) {
        vendorId = product.vendorId;
      } else if (vendorId.toString() !== product.vendorId.toString()) {
        return res.status(400).json({ message: 'All products must be from the same vendor' });
      }

      const itemTotal = product.price * item.quantity;
      totalAmount += itemTotal;

      orderProducts.push({
        productId: product._id,
        quantity: item.quantity,
        price: product.price
      });

      // Update stock
      product.stock -= item.quantity;
      await product.save();
    }

    // Calculate commission
    const vendorEarning = totalAmount * (1 - COMMISSION_RATE);
    const adminCommission = totalAmount * COMMISSION_RATE;

    // Create order
    const order = new Order({
      buyerId: req.user._id,
      vendorId,
      products: orderProducts,
      totalAmount,
      vendorEarning,
      adminCommission,
      shippingAddress
    });
    await order.save();

    // Create commission record
    const commission = new Commission({
      orderId: order._id,
      totalAmount,
      vendorEarning,
      commissionAmount: adminCommission,
      commissionRate: COMMISSION_RATE
    });
    await commission.save();

    // Update vendor earnings
    const vendor = await Vendor.findById(vendorId);
    if (vendor) {
      vendor.totalEarnings += vendorEarning;
      await vendor.save();
    }

    // Emit order placed event
    if (global.orderEventEmitter) {
      global.orderEventEmitter.emit('orderPlaced', {
        orderId: order._id.toString(),
        vendorId: vendorId.toString(),
        buyerId: req.user._id.toString(),
        totalAmount
      });
    }

    res.status(201).json(order);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
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
    // Find ALL shops for this vendor user
    const vendors = await Vendor.find({ userId: req.user._id });
    if (!vendors || vendors.length === 0) {
      return res.status(404).json({ message: 'Vendor profile not found' });
    }

    // Get all vendor shop IDs
    const vendorIds = vendors.map(v => v._id);

    // Find orders for ALL shops belonging to this vendor
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

    // Normalize status to lowercase for consistency
    const normalizedStatus = status.toLowerCase();

    // Find ALL shops for this vendor user
    const vendors = await Vendor.find({ userId: req.user._id });
    if (!vendors || vendors.length === 0) {
      return res.status(404).json({ message: 'Vendor profile not found' });
    }

    const vendorIds = vendors.map(v => v._id.toString());

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check if order belongs to any of the vendor's shops
    if (!vendorIds.includes(order.vendorId.toString())) {
      return res.status(403).json({ message: 'Not authorized to update this order' });
    }

    order.status = normalizedStatus;
    order.updatedAt = new Date();
    await order.save();

    // Emit order status update event
    if (global.orderEventEmitter) {
      global.orderEventEmitter.emit('orderStatusUpdated', {
        orderId: order._id.toString(),
        buyerId: order.buyerId.toString(),
        status
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

    // Check authorization
    const vendor = await Vendor.findOne({ userId: req.user._id });
    const isBuyer = order.buyerId._id.toString() === req.user._id.toString();
    const isVendor = vendor && order.vendorId._id.toString() === vendor._id.toString();
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

