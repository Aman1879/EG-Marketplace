const mongoose = require('mongoose');

const disputeSchema = new mongoose.Schema({
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true
  },
  buyerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  },
  reason: {
    type: String,
    enum: ['not_received', 'damaged_product', 'wrong_item', 'refund_request', 'other'],
    required: true
  },
  description: {
    type: String,
    required: true
  },
  images: {
    type: [String],
    default: []
  },
  status: {
    type: String,
    enum: ['open', 'vendor-responded', 'under-review', 'resolved', 'rejected'],
    default: 'open'
  },
  messages: [{
    senderType: { type: String, enum: ['buyer', 'vendor', 'admin'], required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, required: true },
    message: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }],
  adminNotes: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Dispute', disputeSchema);

