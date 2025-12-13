const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Dispute = require('../models/Dispute');
const Order = require('../models/Order');
const Vendor = require('../models/Vendor');
const { authenticate, authorize } = require('../middleware/auth');

// Create dispute (buyer only)
router.post('/', authenticate, authorize('buyer'), [
  body('orderId').notEmpty().withMessage('Order ID is required'),
  body('reason').isIn(['not_received', 'damaged_product', 'wrong_item', 'refund_request', 'other']).withMessage('Invalid reason'),
  body('description').trim().notEmpty().withMessage('Description is required'),
  body('images').optional({ checkFalsy: true }).isArray().withMessage('Images must be an array of URLs')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { orderId, reason, description, images = [] } = req.body;

    // Verify order belongs to buyer
    const order = await Order.findById(orderId).populate('vendorId');
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.buyerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Create dispute
    const dispute = new Dispute({
      orderId,
      buyerId: req.user._id,
      vendorId: order.vendorId._id,
      description,
      reason,
      images,
      status: 'open',
      messages: [{
        senderType: 'buyer',
        senderId: req.user._id,
        message: description
      }]
    });
    await dispute.save();

    // Emit dispute created event
    if (global.orderEventEmitter) {
      global.orderEventEmitter.emit('disputeCreated', {
        disputeId: dispute._id.toString(),
        vendorId: order.vendorId._id.toString(),
        buyerId: req.user._id.toString()
      });
    }

    res.status(201).json(dispute);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get buyer's disputes
router.get('/buyer/my-disputes', authenticate, authorize('buyer'), async (req, res) => {
  try {
    const disputes = await Dispute.find({ buyerId: req.user._id })
      .populate('orderId', 'totalAmount status')
      .populate('vendorId', 'shopName')
      .sort({ createdAt: -1 });
    res.json(disputes);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get vendor's disputes
router.get('/vendor/my-disputes', authenticate, authorize('vendor'), async (req, res) => {
  try {
    // Find ALL shops for this vendor user
    const vendors = await Vendor.find({ userId: req.user._id });
    if (!vendors || vendors.length === 0) {
      return res.status(404).json({ message: 'Vendor profile not found' });
    }

    // Get all vendor shop IDs
    const vendorIds = vendors.map(v => v._id);

    // Find disputes for ALL shops belonging to this vendor
    const disputes = await Dispute.find({ vendorId: { $in: vendorIds } })
      .populate('orderId', 'totalAmount status')
      .populate('buyerId', 'username email')
      .populate('vendorId', 'shopName')
      .sort({ createdAt: -1 });
    
    res.json(disputes);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Vendor reply to dispute
router.put('/:id/reply', authenticate, authorize('vendor'), [
  body('reply').trim().notEmpty().withMessage('Reply is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Find ALL shops for this vendor user
    const vendors = await Vendor.find({ userId: req.user._id });
    if (!vendors || vendors.length === 0) {
      return res.status(404).json({ message: 'Vendor profile not found' });
    }

    const vendorIds = vendors.map(v => v._id.toString());

    const dispute = await Dispute.findById(req.params.id);
    if (!dispute) {
      return res.status(404).json({ message: 'Dispute not found' });
    }

    // Check if dispute belongs to any of the vendor's shops
    if (!vendorIds.includes(dispute.vendorId.toString())) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    dispute.messages.push({
      senderType: 'vendor',
      senderId: req.user._id,
      message: req.body.reply
    });
    dispute.status = 'vendor-responded';
    dispute.updatedAt = new Date();
    await dispute.save();

    res.json(dispute);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Admin update dispute status
router.put('/:id/status', authenticate, authorize('admin'), [
  body('status').isIn(['open', 'vendor-responded', 'under-review', 'resolved', 'rejected']).withMessage('Invalid status'),
  body('adminNotes').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const dispute = await Dispute.findById(req.params.id);
    if (!dispute) {
      return res.status(404).json({ message: 'Dispute not found' });
    }

    dispute.status = req.body.status;
    if (req.body.adminNotes) {
      dispute.adminNotes = req.body.adminNotes;
      dispute.messages.push({
        senderType: 'admin',
        senderId: req.user._id,
        message: req.body.adminNotes
      });
    }
    dispute.updatedAt = new Date();
    await dispute.save();

    // Emit dispute resolved event
    if (global.orderEventEmitter && dispute.status === 'resolved') {
      global.orderEventEmitter.emit('disputeResolved', {
        disputeId: dispute._id.toString(),
        buyerId: dispute.buyerId.toString(),
        vendorId: dispute.vendorId.toString()
      });
    }

    res.json(dispute);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all disputes (admin only)
router.get('/all', authenticate, authorize('admin'), async (req, res) => {
  try {
    const disputes = await Dispute.find()
      .populate('orderId', 'totalAmount status')
      .populate('buyerId', 'username email')
      .populate('vendorId', 'shopName')
      .sort({ createdAt: -1 });
    res.json(disputes);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

