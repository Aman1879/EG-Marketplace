const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true // Non-unique index to allow multiple shops per vendor
  },
  shopName: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  category: {
    type: String,
    default: ''
  },
  categories: {
    type: [String],
    default: []
  },
  country: {
    type: String,
    default: ''
  },
  logoUrl: {
    type: String,
    default: ''
  },
  bannerUrl: {
    type: String,
    default: ''
  },
  address: {
    type: String,
    default: ''
  },
  contactEmail: {
    type: String,
    default: ''
  },
  contactPhone: {
    type: String,
    default: ''
  },
  averageRating: {
    type: Number,
    default: 0
  },
  totalRatings: {
    type: Number,
    default: 0
  },
  onboardingComplete: {
    type: Boolean,
    default: false
  },
  totalEarnings: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Ensure no unique index on userId alone (vendors can have multiple shops)
// Create compound index on userId + shopName if needed for uniqueness per shop name
vendorSchema.index({ userId: 1, shopName: 1 }, { unique: false });

module.exports = mongoose.model('Vendor', vendorSchema);

