const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  imageUrl: {
    type: String,
    required: true
  },
  images: [{
    type: String,
    trim: true
  }],
  category: {
    type: String,
    required: true,
    default: 'General'
  },
  sku: {
    type: String,
    trim: true,
    default: ''
  },
  stock: {
    type: Number,
    default: 1,
    min: 0
  },
  variants: [{
    name: {
      type: String,
      trim: true,
      required: true
    },
    sku: {
      type: String,
      trim: true
    },
    price: {
      type: Number,
      min: 0
    },
    stock: {
      type: Number,
      min: 0,
      default: 0
    },
    isActive: {
      type: Boolean,
      default: true
    },
    options: [{
      type: String,
      trim: true
    }]
  }],
  inventoryOperations: [{
    operationId: {
      type: String,
      required: true
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order'
    },
    action: {
      type: String,
      enum: ['deduct', 'rollback', 'restore'],
      required: true
    },
    quantity: {
      type: Number,
      required: true
    },
    claimId: {
      type: String
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  averageRating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  totalRatings: {
    type: Number,
    default: 0
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

productSchema.index({ 'inventoryOperations.operationId': 1 });
productSchema.index({ title: 'text', description: 'text' }, { weights: { title: 5, description: 1 } });
productSchema.index({ category: 1, price: 1 });
productSchema.index({ vendorId: 1, createdAt: -1 });
productSchema.index({ price: 1 });
productSchema.index({ stock: 1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ title: 1 });
productSchema.index({ sku: 1 }, { sparse: true });
productSchema.index({ 'variants.sku': 1 }, { sparse: true });

const STANDARD_CATEGORIES = [
  'Clothing',
  'Electronics',
  'Home Decor',
  'Jewellery',
  'Art & Crafts',
  'Beauty Products',
  'Footwear',
  'Books',
  'Toys & Games',
  'Kitchenware',
  'Handmade Items',
  'Accessories',
  'Bags',
  'Stationery',
  'Gadgets',
  'DIY Supplies'
];

function normalizeCategory(category) {
  if (!category || typeof category !== 'string') return 'General';
  const trimmed = category.trim();
  if (!trimmed) return 'General';
  const match = STANDARD_CATEGORIES.find(
    cat => cat.toLowerCase() === trimmed.toLowerCase()
  );
  return match || trimmed;
}

const Product = mongoose.model('Product', productSchema);
Product.STANDARD_CATEGORIES = STANDARD_CATEGORIES;
Product.normalizeCategory = normalizeCategory;

module.exports = Product;

