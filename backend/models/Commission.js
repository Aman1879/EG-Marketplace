const mongoose = require('mongoose');

const commissionSchema = new mongoose.Schema({
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
    unique: true
  },
  totalAmount: {
    type: Number,
    required: true
  },
  vendorEarning: {
    type: Number,
    required: true
  },
  commissionAmount: {
    type: Number,
    required: true
  },
  commissionRate: {
    type: Number,
    default: 0.10 // 10%
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Commission', commissionSchema);

