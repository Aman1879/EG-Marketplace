const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
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
  products: [{
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    price: {
      type: Number,
      required: true
    }
  }],
  totalAmount: {
    type: Number,
    required: true
  },
  vendorEarning: {
    type: Number,
    required: true
  },
  adminCommission: {
    type: Number,
    required: true
  },
  commissionRate: {
    type: Number,
    default: 0.10
  },
  paymentStatus: {
    type: String,
    enum: ['created', 'authorized', 'paid', 'failed', 'refunded'],
    default: 'created'
  },
  paymentMethod: {
    type: String,
    default: ''
  },
  razorpayOrderId: {
    type: String,
    default: ''
  },
  razorpayPaymentId: {
    type: String,
    default: ''
  },
  razorpaySignature: {
    type: String,
    default: ''
  },
  transferId: {
    type: String,
    default: ''
  },
  transferStatus: {
    type: String,
    enum: ['not_initiated', 'queued', 'processed', 'failed', 'reversed'],
    default: 'not_initiated'
  },
  transferError: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'Pending', 'Shipped', 'Delivered', 'Cancelled'],
    default: 'pending'
  },
  shippingAddress: {
    type: String,
    required: true
  },
  refundId: {
    type: String,
    default: ''
  },
  refundAmount: {
    type: Number,
    default: 0
  },
  failureReason: {
    type: String,
    default: ''
  },
  notes: {
    type: Object,
    default: {}
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

orderSchema.pre('save', function updateTimestamp(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Order', orderSchema);

