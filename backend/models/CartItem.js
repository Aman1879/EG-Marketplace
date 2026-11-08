const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
    index: true
  },
  variantId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
    index: true
  },
  variantName: {
    type: String,
    default: ''
  },
  variantSku: {
    type: String,
    default: ''
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1
  },
  priceAtAdd: {
    type: Number,
    required: true,
    min: 0
  },
  addedAt: {
    type: Date,
    default: Date.now
  }
});

cartItemSchema.index({ userId: 1, productId: 1, variantId: 1 }, { unique: true });

module.exports = mongoose.model('CartItem', cartItemSchema);


