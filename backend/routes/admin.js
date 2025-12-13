const express = require('express');
const router = express.Router();
const Commission = require('../models/Commission');
const Order = require('../models/Order');
const Vendor = require('../models/Vendor');
const User = require('../models/User');
const Product = require('../models/Product');
const { authenticate, authorize } = require('../middleware/auth');

// Get all commissions
router.get('/commissions', authenticate, authorize('admin'), async (req, res) => {
  try {
    const commissions = await Commission.find()
      .populate('orderId')
      .sort({ createdAt: -1 });
    
    const totalCommission = commissions.reduce((sum, c) => sum + c.commissionAmount, 0);
    
    res.json({
      commissions,
      totalCommission,
      totalOrders: commissions.length
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get vendor earnings summary
router.get('/vendor-earnings', authenticate, authorize('admin'), async (req, res) => {
  try {
    const vendors = await Vendor.find().populate('userId', 'username email');
    
    // Calculate admin commission for each vendor
    const summary = await Promise.all(vendors.map(async (vendor) => {
      // Get all orders for this vendor
      const orders = await Order.find({ vendorId: vendor._id });
      
      // Calculate total admin commission from this vendor
      const adminCommission = orders.reduce((sum, order) => {
        return sum + (order.adminCommission || 0);
      }, 0);
      
      // Calculate total revenue from this vendor
      const totalRevenue = orders.reduce((sum, order) => {
        return sum + (order.totalAmount || 0);
      }, 0);

      return {
        vendorId: vendor._id,
        shopName: vendor.shopName || 'N/A',
        username: vendor.userId?.username || 'N/A',
        email: vendor.userId?.email || 'N/A',
        totalEarnings: vendor.totalEarnings || 0,
        adminCommission: adminCommission,
        totalRevenue: totalRevenue,
        totalOrders: orders.length
      };
    }));

    res.json(summary);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get dashboard stats
router.get('/dashboard', authenticate, authorize('admin'), async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalVendors = await Vendor.countDocuments();
    const totalProducts = await Product.countDocuments();
    const totalOrders = await Order.countDocuments();
    
    const commissions = await Commission.find();
    const totalCommission = commissions.reduce((sum, c) => sum + c.commissionAmount, 0);
    
    const orders = await Order.find();
    const totalRevenue = orders.reduce((sum, o) => sum + o.totalAmount, 0);

    res.json({
      totalUsers,
      totalVendors,
      totalProducts,
      totalOrders,
      totalCommission,
      totalRevenue
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

