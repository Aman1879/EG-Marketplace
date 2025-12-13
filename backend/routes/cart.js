const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const CartItem = require('../models/CartItem');
const Product = require('../models/Product');
const { authenticate, authorize } = require('../middleware/auth');

// Get cart for current buyer
router.get('/', authenticate, authorize('buyer'), async (req, res) => {
  try {
    const items = await CartItem.find({ userId: req.user._id })
      .populate('productId');

    // Remove items whose products no longer exist
    const validItems = [];
    for (const item of items) {
      if (!item.productId) {
        await CartItem.deleteOne({ _id: item._id });
        continue;
      }
      validItems.push({
        _id: item._id,
        productId: item.productId._id,
        quantity: item.quantity,
        priceAtAdd: item.priceAtAdd,
        addedAt: item.addedAt,
        product: item.productId
      });
    }

    res.json(validItems);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Add item to cart (upsert)
router.post('/add', authenticate, authorize('buyer'), [
  body('productId').notEmpty().withMessage('Product ID is required'),
  body('quantity').optional().isInt({ min: 1 }).withMessage('Quantity must be at least 1')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { productId, quantity = 1 } = req.body;
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const existing = await CartItem.findOne({ userId: req.user._id, productId });
    if (existing) {
      existing.quantity += quantity;
      await existing.save();
      return res.json(existing);
    }

    const item = new CartItem({
      userId: req.user._id,
      productId,
      quantity,
      priceAtAdd: product.price
    });
    await item.save();
    res.status(201).json(item);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update quantity
router.put('/update', authenticate, authorize('buyer'), [
  body('productId').notEmpty().withMessage('Product ID is required'),
  body('quantity').isInt().withMessage('Quantity is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { productId, quantity } = req.body;
    const item = await CartItem.findOne({ userId: req.user._id, productId });
    if (!item) {
      return res.status(404).json({ message: 'Cart item not found' });
    }
    if (quantity <= 0) {
      await CartItem.deleteOne({ _id: item._id });
      return res.json({ message: 'Item removed' });
    }
    item.quantity = quantity;
    await item.save();
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Remove item
router.delete('/remove/:productId', authenticate, authorize('buyer'), async (req, res) => {
  try {
    await CartItem.deleteOne({ userId: req.user._id, productId: req.params.productId });
    res.json({ message: 'Item removed' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Clear cart
router.delete('/clear', authenticate, authorize('buyer'), async (req, res) => {
  try {
    await CartItem.deleteMany({ userId: req.user._id });
    res.json({ message: 'Cart cleared' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;


