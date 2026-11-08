const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Commission = require('../models/Commission');
const Order = require('../models/Order');
const Vendor = require('../models/Vendor');
const User = require('../models/User');
const Product = require('../models/Product');
const AuditLog = require('../models/AuditLog');
const { authenticate, authorize } = require('../middleware/auth');
const { recordAuditLog } = require('../utils/auditLogger');

function roundCurrency(val) {
  return Number((Number(val) || 0).toFixed(2));
}

function isObjectId(val) {
  return typeof val === 'string' && /^[0-9a-fA-F]{24}$/.test(val.trim());
}

function computeCompletedRefund(order) {
  if (!order) return 0;

  // If order status or refundStatus is explicitly completed
  if (order.refundStatus === 'completed' || (order.status || '').toLowerCase() === 'refunded') {
    return roundCurrency(order.refundAmount || order.totalAmount || 0);
  }

  // If individual partial refunds exist in the refunds array
  if (Array.isArray(order.refunds) && order.refunds.length > 0) {
    const sum = order.refunds
      .filter(r => r && (r.status === 'processed' || r.status === 'completed'))
      .reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
    return roundCurrency(sum);
  }

  // Pending, initiated, processing, failed, or manual_review refunds are strictly excluded
  return 0;
}

// Helper to compute financial metrics across orders
async function computeFinancialMetrics(filter = {}) {
  // Only captured/paid orders count as completed sales
  const paidOrders = await Order.find({
    paymentStatus: 'paid',
    ...filter
  }).select('totalAmount adminCommission vendorEarning refundAmount refunds status refundStatus paymentStatus').lean();

  let grossCapturedSales = 0;
  let completedRefunds = 0;
  let platformCommission = 0;
  let vendorEarnings = 0;

  for (const o of paidOrders) {
    grossCapturedSales += (o.totalAmount || 0);
    platformCommission += (o.adminCommission || 0);
    vendorEarnings += (o.vendorEarning || 0);
    completedRefunds += computeCompletedRefund(o);
  }

  // Fully refunded orders whose paymentStatus transitioned to 'refunded'
  const refundedOrders = await Order.find({
    paymentStatus: 'refunded',
    ...filter
  }).select('totalAmount adminCommission vendorEarning refundAmount refunds status refundStatus paymentStatus').lean();

  for (const o of refundedOrders) {
    grossCapturedSales += (o.totalAmount || 0);
    platformCommission += (o.adminCommission || 0);
    vendorEarnings += (o.vendorEarning || 0);
    completedRefunds += (o.refundAmount || o.totalAmount || 0);
  }

  grossCapturedSales = roundCurrency(grossCapturedSales);
  completedRefunds = roundCurrency(completedRefunds);
  const netRevenue = Math.max(0, roundCurrency(grossCapturedSales - completedRefunds));
  platformCommission = roundCurrency(platformCommission);
  vendorEarnings = roundCurrency(vendorEarnings);

  const totalCapturedOrders = paidOrders.length + refundedOrders.length;

  return {
    grossCapturedSales,
    completedRefunds,
    netRevenue,
    platformCommission,
    vendorEarnings,
    totalCapturedOrders,
    reconciliation: {
      difference: roundCurrency(grossCapturedSales - (platformCommission + vendorEarnings)),
      reconciled: Math.abs(grossCapturedSales - (platformCommission + vendorEarnings)) < 0.05
    }
  };
}

// -------------------------------------------------------------
// 1. GET /api/admin/dashboard - High-level summary & financials
// -------------------------------------------------------------
router.get('/dashboard', authenticate, authorize('admin'), async (req, res) => {
  try {
    const [totalUsers, totalVendors, totalProducts, totalOrders] = await Promise.all([
      User.countDocuments(),
      Vendor.countDocuments(),
      Product.countDocuments(),
      Order.countDocuments()
    ]);

    // Financial calculations based strictly on completed captured payments
    const financials = await computeFinancialMetrics();

    // Order status counts across all orders
    const statusAgg = await Order.aggregate([
      { $group: { _id: { $toLower: '$status' }, count: { $sum: 1 } } }
    ]);

    const orderStatusCounts = {
      pending: 0,
      confirmed: 0,
      processing: 0,
      shipped: 0,
      delivered: 0,
      cancelled: 0,
      refunded: 0
    };

    statusAgg.forEach(item => {
      if (item._id && orderStatusCounts[item._id] !== undefined) {
        orderStatusCounts[item._id] = item.count;
      }
    });

    res.json({
      totalUsers,
      totalVendors,
      totalProducts,
      totalOrders,
      ...financials,
      totalRevenue: financials.netRevenue,
      totalCommission: financials.platformCommission,
      orderStatusCounts
    });
  } catch (error) {
    console.error('Error fetching admin dashboard stats:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// -------------------------------------------------------------
// 2. GET /api/admin/reports/financial - Dedicated Financial Report
// -------------------------------------------------------------
router.get('/reports/financial', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const filter = {};

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        if (!isNaN(start.getTime())) filter.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) filter.createdAt.$lte = end;
      }
    }

    const financials = await computeFinancialMetrics(filter);

    // Count excluded uncompleted orders (unpaid, failed, cancelled before payment)
    const excludedOrdersCount = await Order.countDocuments({
      paymentStatus: { $in: ['created', 'authorized', 'failed'] },
      ...filter
    });

    res.json({
      currency: 'INR',
      dateRange: {
        startDate: startDate || null,
        endDate: endDate || null
      },
      ...financials,
      excludedOrdersCount
    });
  } catch (error) {
    console.error('Error fetching financial report:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// -------------------------------------------------------------
// 3. GET /api/admin/orders - Filtered Order Search & Listing
// -------------------------------------------------------------
router.get('/orders', authenticate, authorize('admin'), async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      status,
      paymentStatus,
      customer,
      customerId,
      vendor,
      vendorId,
      page = 1,
      limit = 20,
      sort = 'newest'
    } = req.query;

    const filter = {};

    // Date range filter
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        if (!isNaN(start.getTime())) filter.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) filter.createdAt.$lte = end;
      }
    }

    // Status filter
    if (status && status !== 'all') {
      filter.status = { $regex: new RegExp(`^${status.trim()}$`, 'i') };
    }

    // Payment status filter
    if (paymentStatus && paymentStatus !== 'all') {
      filter.paymentStatus = paymentStatus.trim().toLowerCase();
    }

    // Customer filter (by ObjectId or username/email search)
    const targetCustomer = (customerId || customer || '').trim();
    if (targetCustomer) {
      if (isObjectId(targetCustomer)) {
        filter.buyerId = targetCustomer;
      } else {
        const matchedUsers = await User.find({
          $or: [
            { username: { $regex: new RegExp(targetCustomer, 'i') } },
            { email: { $regex: new RegExp(targetCustomer, 'i') } }
          ]
        }).select('_id');
        filter.buyerId = { $in: matchedUsers.map(u => u._id) };
      }
    }

    // Vendor filter (by ObjectId or shopName search)
    const targetVendor = (vendorId || vendor || '').trim();
    if (targetVendor) {
      if (isObjectId(targetVendor)) {
        filter.vendorId = targetVendor;
      } else {
        const matchedVendors = await Vendor.find({
          shopName: { $regex: new RegExp(targetVendor, 'i') }
        }).select('_id');
        filter.vendorId = { $in: matchedVendors.map(v => v._id) };
      }
    }

    const sortOptions = sort === 'oldest' ? { createdAt: 1 } : { createdAt: -1 };
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (parsedPage - 1) * parsedLimit;

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate('buyerId', 'username email')
        .populate('vendorId', 'shopName')
        .populate('products.productId', 'title imageUrl price sku')
        .sort(sortOptions)
        .skip(skip)
        .limit(parsedLimit)
        .lean(),
      Order.countDocuments(filter)
    ]);

    res.json({
      success: true,
      count: orders.length,
      total,
      totalPages: Math.ceil(total / parsedLimit),
      page: parsedPage,
      limit: parsedLimit,
      orders
    });
  } catch (error) {
    console.error('Error fetching admin orders:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// -------------------------------------------------------------
// 4. GET /api/admin/inventory - Product & Inventory Summary
// -------------------------------------------------------------
router.get('/inventory', authenticate, authorize('admin'), async (req, res) => {
  try {
    const threshold = parseInt(req.query.threshold, 10) || 10;

    const [totalProducts, outOfStockCount, lowStockCount, stockAgg, lowStockProducts] = await Promise.all([
      Product.countDocuments(),
      Product.countDocuments({ stock: { $lte: 0 } }),
      Product.countDocuments({ stock: { $gt: 0, $lte: threshold } }),
      Product.aggregate([
        { $group: { _id: null, totalStock: { $sum: '$stock' } } }
      ]),
      Product.find({ stock: { $lte: threshold } })
        .populate('vendorId', 'shopName')
        .sort({ stock: 1 })
        .limit(50)
    ]);

    const totalStock = stockAgg?.[0]?.totalStock || 0;

    res.json({
      success: true,
      totalProducts,
      totalStock,
      threshold,
      outOfStockCount,
      lowStockCount,
      criticalStockCount: outOfStockCount + lowStockCount,
      lowStockProducts
    });
  } catch (error) {
    console.error('Error fetching inventory summary:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// -------------------------------------------------------------
// 5. GET /api/admin/users & PUT /api/admin/users/:id/role
// -------------------------------------------------------------
router.get('/users', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { role, search, page = 1, limit = 50 } = req.query;
    const filter = {};

    if (role && ['buyer', 'vendor', 'admin'].includes(role.toLowerCase())) {
      filter.role = role.toLowerCase();
    }

    if (search) {
      filter.$or = [
        { username: { $regex: new RegExp(search.trim(), 'i') } },
        { email: { $regex: new RegExp(search.trim(), 'i') } }
      ];
    }

    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (parsedPage - 1) * parsedLimit;

    const [users, total] = await Promise.all([
      User.find(filter).select('-password').sort({ createdAt: -1 }).skip(skip).limit(parsedLimit),
      User.countDocuments(filter)
    ]);

    res.json({
      success: true,
      total,
      page: parsedPage,
      totalPages: Math.ceil(total / parsedLimit),
      users
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/users/:id/role', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { role } = req.body;
    if (!role || !['buyer', 'vendor', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'Valid role (buyer, vendor, admin) is required' });
    }

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }

    // Prevent admin from accidentally demoting themselves to avoid lockout
    if (req.params.id === req.user._id.toString() && role !== 'admin') {
      return res.status(400).json({ message: 'Cannot demote yourself from admin role' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const oldRole = user.role;
    user.role = role;
    await user.save();

    await recordAuditLog({
      actorId: req.user._id,
      actorRole: req.user.role,
      action: 'admin.role_change',
      resourceType: 'User',
      resourceId: user._id.toString(),
      before: { role: oldRole },
      after: { role: user.role },
      metadata: { username: user.username, email: user.email }
    });

    res.json({
      success: true,
      message: `User role updated to ${role}`,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// -------------------------------------------------------------
// 6. GET /api/admin/vendors & PUT /api/admin/vendors/:id/status
// -------------------------------------------------------------
router.get('/vendors', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { status, search } = req.query;
    const filter = {};

    if (status && ['pending', 'approved', 'rejected'].includes(status.toLowerCase())) {
      filter.approvalStatus = status.toLowerCase();
    }

    if (search) {
      filter.shopName = { $regex: new RegExp(search.trim(), 'i') };
    }

    const vendors = await Vendor.find(filter)
      .populate('userId', 'username email role')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      total: vendors.length,
      vendors
    });
  } catch (error) {
    console.error('Error fetching vendors list:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/vendors/:id/status', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { status, notes } = req.body;
    if (!status || !['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ message: 'Valid status (approved, rejected, pending) is required' });
    }

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid vendor ID format' });
    }

    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    const oldStatus = vendor.approvalStatus;
    const oldOnboarding = vendor.onboardingComplete;
    vendor.approvalStatus = status;
    vendor.onboardingComplete = status === 'approved';
    vendor.approvalReviewedAt = new Date();
    vendor.approvalReviewedBy = req.user._id;
    if (notes !== undefined) vendor.approvalNotes = String(notes).trim();

    await vendor.save();

    await recordAuditLog({
      actorId: req.user._id,
      actorRole: req.user.role,
      action: 'admin.vendor_status_change',
      resourceType: 'Vendor',
      resourceId: vendor._id.toString(),
      before: { approvalStatus: oldStatus, onboardingComplete: oldOnboarding },
      after: { approvalStatus: vendor.approvalStatus, onboardingComplete: vendor.onboardingComplete },
      metadata: { shopName: vendor.shopName, notes: vendor.approvalNotes }
    });

    if (global.orderEventEmitter) {
      global.orderEventEmitter.emit('vendorApprovalUpdated', {
        vendorId: vendor._id.toString(),
        userId: vendor.userId.toString(),
        shopName: vendor.shopName,
        approvalStatus: vendor.approvalStatus
      });
    }

    res.json({
      success: true,
      message: `Vendor status updated to ${status}`,
      vendor
    });
  } catch (error) {
    console.error('Error updating vendor status:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// -------------------------------------------------------------
// 7. Vendor Approvals Workflow (existing endpoints preserved)
// -------------------------------------------------------------
// Get pending vendor shop approval requests
router.get('/vendor-requests', authenticate, authorize('admin'), async (req, res) => {
  try {
    const requests = await Vendor.find({ approvalStatus: 'pending' })
      .populate('userId', 'username email')
      .sort({ approvalRequestedAt: -1, createdAt: -1 });

    res.json({ requests });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Approve a vendor shop request
router.put('/vendor-requests/:id/approve', authenticate, authorize('admin'), async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor request not found' });
    }

    const oldStatus = vendor.approvalStatus;
    vendor.approvalStatus = 'approved';
    vendor.onboardingComplete = true;
    vendor.approvalReviewedAt = new Date();
    vendor.approvalReviewedBy = req.user._id;
    vendor.approvalNotes = '';
    await vendor.save();

    await recordAuditLog({
      actorId: req.user._id,
      actorRole: req.user.role,
      action: 'admin.vendor_approval',
      resourceType: 'Vendor',
      resourceId: vendor._id.toString(),
      before: { approvalStatus: oldStatus, onboardingComplete: false },
      after: { approvalStatus: 'approved', onboardingComplete: true },
      metadata: { shopName: vendor.shopName }
    });

    if (global.orderEventEmitter) {
      global.orderEventEmitter.emit('vendorApprovalUpdated', {
        vendorId: vendor._id.toString(),
        userId: vendor.userId.toString(),
        shopName: vendor.shopName,
        approvalStatus: vendor.approvalStatus
      });
    }

    res.json({ message: 'Vendor shop approved', vendor });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Reject a vendor shop request
router.put('/vendor-requests/:id/reject', authenticate, authorize('admin'), async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor request not found' });
    }

    const oldStatus = vendor.approvalStatus;
    vendor.approvalStatus = 'rejected';
    vendor.onboardingComplete = false;
    vendor.approvalReviewedAt = new Date();
    vendor.approvalReviewedBy = req.user._id;
    vendor.approvalNotes = (req.body?.notes || '').trim();
    await vendor.save();

    await recordAuditLog({
      actorId: req.user._id,
      actorRole: req.user.role,
      action: 'admin.vendor_rejection',
      resourceType: 'Vendor',
      resourceId: vendor._id.toString(),
      before: { approvalStatus: oldStatus, onboardingComplete: true },
      after: { approvalStatus: 'rejected', onboardingComplete: false },
      metadata: { shopName: vendor.shopName, notes: vendor.approvalNotes }
    });

    if (global.orderEventEmitter) {
      global.orderEventEmitter.emit('vendorApprovalUpdated', {
        vendorId: vendor._id.toString(),
        userId: vendor.userId.toString(),
        shopName: vendor.shopName,
        approvalStatus: vendor.approvalStatus
      });
    }

    res.json({ message: 'Vendor shop rejected', vendor });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// -------------------------------------------------------------
// 8. Commissions & Vendor Earnings (existing endpoints preserved)
// -------------------------------------------------------------
router.get('/commissions', authenticate, authorize('admin'), async (req, res) => {
  try {
    const commissions = await Commission.find()
      .populate('orderId')
      .sort({ createdAt: -1 });

    const validCommissions = commissions.filter(c => {
      const order = c.orderId;
      if (!order) return false;
      const paymentStatus = order.paymentStatus;
      const status = (order.status || '').toLowerCase();
      return paymentStatus === 'paid' && !['cancelled', 'refunded'].includes(status);
    });

    const totalCommission = roundCurrency(
      validCommissions.reduce((sum, c) => sum + (c.commissionAmount || 0), 0)
    );

    res.json({
      commissions,
      totalCommission,
      totalOrders: validCommissions.length
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/vendor-earnings', authenticate, authorize('admin'), async (req, res) => {
  try {
    const vendors = await Vendor.find().populate('userId', 'username email');

    const summary = await Promise.all(vendors.map(async (vendor) => {
      const orders = await Order.find({
        vendorId: vendor._id,
        paymentStatus: 'paid',
        status: { $nin: ['cancelled', 'Cancelled', 'refunded', 'Refunded'] }
      });

      const adminCommission = roundCurrency(
        orders.reduce((sum, order) => sum + (order.adminCommission || 0), 0)
      );

      const totalRevenue = roundCurrency(
        orders.reduce((sum, order) => {
          const netAmount = Math.max(0, (order.totalAmount || 0) - computeCompletedRefund(order));
          return sum + netAmount;
        }, 0)
      );

      return {
        vendorId: vendor._id,
        shopName: vendor.shopName || 'N/A',
        username: vendor.userId?.username || 'N/A',
        email: vendor.userId?.email || 'N/A',
        totalEarnings: vendor.totalEarnings || 0,
        adminCommission,
        totalRevenue,
        totalOrders: orders.length
      };
    }));

    res.json(summary);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// -------------------------------------------------------------
// 9. GET /api/admin/audit-logs - Read-only Audit Trail
// -------------------------------------------------------------
router.get('/audit-logs', authenticate, authorize('admin'), async (req, res) => {
  try {
    const {
      action,
      resourceType,
      resourceId,
      actorId,
      actorRole,
      startDate,
      endDate,
      page = 1,
      limit = 20,
      sort = 'newest'
    } = req.query;

    const filter = {};

    if (action) {
      filter.action = { $regex: new RegExp(action.trim(), 'i') };
    }
    if (resourceType) {
      filter.resourceType = { $regex: new RegExp(`^${resourceType.trim()}$`, 'i') };
    }
    if (resourceId) {
      filter.resourceId = resourceId.trim();
    }
    if (actorId && isObjectId(actorId)) {
      filter.actorId = actorId.trim();
    }
    if (actorRole) {
      filter.actorRole = actorRole.trim().toLowerCase();
    }
    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) {
        const start = new Date(startDate);
        if (!isNaN(start.getTime())) filter.timestamp.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) filter.timestamp.$lte = end;
      }
    }

    const sortOptions = sort === 'oldest' ? { timestamp: 1 } : { timestamp: -1 };
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (parsedPage - 1) * parsedLimit;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .populate('actorId', 'username email role')
        .sort(sortOptions)
        .skip(skip)
        .limit(parsedLimit)
        .lean(),
      AuditLog.countDocuments(filter)
    ]);

    res.json({
      success: true,
      count: logs.length,
      total,
      totalPages: Math.ceil(total / parsedLimit),
      page: parsedPage,
      limit: parsedLimit,
      logs
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Explicitly protect audit logs from modification/deletion routes
router.all('/audit-logs', authenticate, authorize('admin'), (req, res, next) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Audit records are read-only and immutable' });
  }
  next();
});

router.all('/audit-logs/:id', authenticate, authorize('admin'), (req, res) => {
  return res.status(405).json({ message: 'Audit records are read-only and immutable' });
});

module.exports = router;
