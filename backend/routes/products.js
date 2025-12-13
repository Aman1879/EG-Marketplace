const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Product = require('../models/Product');
const Vendor = require('../models/Vendor');
const { authenticate, authorize } = require('../middleware/auth');

// Get all products (optional category filter)
router.get('/', async (req, res) => {
  try {
    const { category } = req.query;
    const filter = category
      ? { category: { $regex: new RegExp(`^${category}$`, 'i') } }
      : {};
    const products = await Product.find(filter).populate('vendorId', 'shopName').sort({ createdAt: -1 });
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get products by category (path param)
router.get('/category/:category', async (req, res) => {
  try {
    const products = await Product.find({ category: req.params.category }).populate('vendorId', 'shopName').sort({ createdAt: -1 });
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get vendor's products (placed before /:id to avoid route capture)
router.get('/vendor/my-products', authenticate, authorize('vendor'), async (req, res) => {
  try {
    const { vendorId } = req.query;
    let vendor;
    if (vendorId) {
      vendor = await Vendor.findOne({ _id: vendorId, userId: req.user._id });
      if (!vendor) {
        return res.status(404).json({ message: 'Vendor profile not found' });
      }
    } else {
      vendor = await Vendor.findOne({ userId: req.user._id }).sort({ createdAt: -1 });
      if (!vendor) {
        return res.status(404).json({ message: 'Vendor profile not found' });
      }
    }

    const products = await Product.find({ vendorId: vendor._id }).sort({ createdAt: -1 });
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get single product
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate('vendorId', 'shopName');
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create product (vendor only)
router.post('/', authenticate, authorize('vendor'), [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('description').trim().notEmpty().withMessage('Description is required'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('imageUrl').isURL().withMessage('Invalid image URL'),
  body('category').trim().notEmpty().withMessage('Category is required'),
  body('vendorId').optional({ checkFalsy: true }).isMongoId().withMessage('Invalid vendorId')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    let vendor;
    if (req.body.vendorId) {
      vendor = await Vendor.findOne({ _id: req.body.vendorId, userId: req.user._id });
      if (!vendor) {
        return res.status(404).json({ message: 'Vendor profile not found' });
      }
    } else {
      vendor = await Vendor.findOne({ userId: req.user._id }).sort({ createdAt: -1 });
      if (!vendor) {
        return res.status(404).json({ message: 'Vendor profile not found' });
      }
    }

    const product = new Product({
      vendorId: vendor._id,
      ...req.body
    });
    await product.save();

    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update product (vendor only)
router.put('/:id', authenticate, authorize('vendor'), [
  body('category').optional({ checkFalsy: true }).trim(),
  body('vendorId').optional({ checkFalsy: true }).isMongoId().withMessage('Invalid vendorId')
], async (req, res) => {
  try {
    let vendor;
    if (req.body.vendorId) {
      vendor = await Vendor.findOne({ _id: req.body.vendorId, userId: req.user._id });
      if (!vendor) {
        return res.status(404).json({ message: 'Vendor profile not found' });
      }
    } else {
      vendor = await Vendor.findOne({ userId: req.user._id }).sort({ createdAt: -1 });
      if (!vendor) {
        return res.status(404).json({ message: 'Vendor profile not found' });
      }
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (product.vendorId.toString() !== vendor._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to update this product' });
    }

    Object.assign(product, req.body);
    product.updatedAt = new Date();
    await product.save();

    res.json(product);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete product (vendor only)
router.delete('/:id', authenticate, authorize('vendor'), async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ userId: req.user._id });
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor profile not found' });
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (product.vendorId.toString() !== vendor._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to delete this product' });
    }

    await product.deleteOne();
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

