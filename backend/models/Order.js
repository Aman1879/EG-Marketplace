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
    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
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
      min: 1
    },
    price: {
      type: Number,
      required: true
    },
    inventoryState: {
      type: String,
      enum: ['pending', 'deducted', 'rolled_back', 'restored'],
      default: 'pending'
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
    enum: ['not_initiated', 'queued', 'processed', 'failed', 'reversed', 'manual_review'],
    default: 'not_initiated'
  },
  transferError: {
    type: String,
    default: ''
  },
  transferClaimedAt: {
    type: Date,
    default: null
  },
  transferClaimToken: {
    type: String,
    default: null
  },
  transferClaimVersion: {
    type: Number,
    default: 0
  },
  vendorEarningsCredited: {
    type: Boolean,
    default: false
  },
  vendorEarningsCreditedAt: {
    type: Date,
    default: null
  },
  idempotencyKey: {
    type: String,
    default: null,
    trim: true
  },
  payloadHash: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded', 'Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Refunded'],
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
  reservedRefundAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  refundStatus: {
    type: String,
    enum: ['none', 'initiated', 'processing', 'completed', 'failed', 'manual_review'],
    default: 'none',
    index: true
  },
  refunds: [{
    refundId: {
      type: String,
      default: ''
    },
    amount: {
      type: Number,
      required: true
    },
    reason: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['initiated', 'processing', 'completed', 'failed', 'manual_review'],
      default: 'initiated'
    },
    initiatedAt: {
      type: Date,
      default: Date.now
    },
    completedAt: {
      type: Date,
      default: null
    }
  }],
  inventoryStatus: {
    type: String,
    enum: [
      'not_deducted',
      'deducting',
      'deducted',
      'deduction_failed',
      'restoring',
      'restored',
      'restoration_failed',
      'recovery_required'
    ],
    default: 'not_deducted',
    index: true
  },
  inventoryClaimedAt: {
    type: Date,
    default: null
  },
  inventoryClaimId: {
    type: String,
    default: null
  },
  claimVersion: {
    type: Number,
    default: 0
  },
  inventoryHeartbeatAt: {
    type: Date,
    default: null
  },
  inventoryLogs: [{
    action: { type: String },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    quantity: { type: Number },
    timestamp: { type: Date, default: Date.now },
    status: { type: String },
    message: { type: String }
  }],
  statusHistory: [{
    fromStatus: { type: String },
    toStatus: { type: String, required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: { type: String, default: 'system' },
    reason: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now }
  }],
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

orderSchema.index(
  { buyerId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string', $gt: '' } }
  }
);

// Performance and query indexes
orderSchema.index({ buyerId: 1, createdAt: -1 });
orderSchema.index({ vendorId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1, createdAt: -1 });
orderSchema.index({ razorpayOrderId: 1 }, { sparse: true });
orderSchema.index({ razorpayPaymentId: 1 }, { sparse: true });
orderSchema.index({ transferStatus: 1 });
orderSchema.index({ createdAt: -1 });

orderSchema.pre('save', function updateTimestamp(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Order', orderSchema);

