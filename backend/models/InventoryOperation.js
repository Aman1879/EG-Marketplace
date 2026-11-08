const mongoose = require('mongoose');

const inventoryOperationSchema = new mongoose.Schema({
  operationId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  orderId: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    index: true
  },
  productId: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    index: true
  },
  action: {
    type: String,
    enum: ['deduct', 'rollback', 'restore'],
    required: true,
    index: true
  },
  quantity: {
    type: Number,
    required: true
  },
  claimId: {
    type: String,
    default: null
  },
  fencingToken: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['pending', 'reserved', 'completed', 'failed', 'archived', 'active'],
    default: 'pending',
    index: true
  },
  completedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Ensure operationId is globally unique across the entire collection
inventoryOperationSchema.index({ operationId: 1 }, { unique: true });
inventoryOperationSchema.index({ orderId: 1, productId: 1, action: 1 });

module.exports = mongoose.model('InventoryOperation', inventoryOperationSchema);
