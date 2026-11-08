const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  fullName: {
    type: String,
    required: [true, 'Recipient full name is required'],
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true
  },
  addressLine1: {
    type: String,
    required: [true, 'Address line 1 is required'],
    trim: true
  },
  addressLine2: {
    type: String,
    trim: true,
    default: ''
  },
  landmark: {
    type: String,
    trim: true,
    default: ''
  },
  city: {
    type: String,
    required: [true, 'City is required'],
    trim: true
  },
  state: {
    type: String,
    required: [true, 'State is required'],
    trim: true
  },
  postalCode: {
    type: String,
    required: [true, 'Postal code is required'],
    trim: true
  },
  isDefault: {
    type: Boolean,
    default: false,
    index: true
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

addressSchema.index({ userId: 1, isDefault: -1, createdAt: -1 });

// Format address as a human-readable snapshot string
addressSchema.methods.toSnapshotString = function() {
  const parts = [];
  if (this.fullName) parts.push(this.fullName);
  if (this.addressLine1) parts.push(this.addressLine1);
  if (this.addressLine2) parts.push(this.addressLine2);
  if (this.landmark) {
    const cleanLandmark = this.landmark.replace(/^near\s+/i, '');
    parts.push(`Near ${cleanLandmark}`);
  }
  parts.push(`${this.city}, ${this.state} - ${this.postalCode}`);
  if (this.phone) parts.push(`Phone: ${this.phone}`);
  return parts.join(', ');
};

module.exports = mongoose.model('Address', addressSchema);
