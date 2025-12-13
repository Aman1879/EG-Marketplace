const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Rating = require('../models/Rating');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { authenticate, authorize } = require('../middleware/auth');

// Create rating (buyer only)
router.post('/', authenticate, authorize('buyer'), [
  body('productId').notEmpty().withMessage('Product ID is required'),
  body('orderId').notEmpty().withMessage('Order ID is required'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { productId, orderId, rating, review } = req.body;

    // Verify order belongs to buyer
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.buyerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Check if product is in order
    const productInOrder = order.products.find(
      p => p.productId.toString() === productId
    );
    if (!productInOrder) {
      return res.status(400).json({ message: 'Product not in this order' });
    }

    // Check if rating already exists
    const existingRating = await Rating.findOne({ productId, buyerId: req.user._id });
    if (existingRating) {
      return res.status(400).json({ message: 'You have already rated this product' });
    }

    // Create rating
    const newRating = new Rating({
      productId,
      buyerId: req.user._id,
      orderId,
      rating,
      review: review || ''
    });
    await newRating.save();

    // Update product average rating
    const ratings = await Rating.find({ productId });
    const totalRatings = ratings.length;
    const sumRatings = ratings.reduce((sum, r) => sum + r.rating, 0);
    const averageRating = sumRatings / totalRatings;

    const product = await Product.findById(productId);
    if (product) {
      product.averageRating = averageRating;
      product.totalRatings = totalRatings;
      await product.save();
    }

    res.status(201).json(newRating);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'You have already rated this product' });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get ratings for a product
router.get('/product/:productId', async (req, res) => {
  try {
    const ratings = await Rating.find({ productId: req.params.productId })
      .populate('buyerId', 'username')
      .sort({ createdAt: -1 });
    res.json(ratings);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

