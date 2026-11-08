const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const Product = require('../models/Product');
const Vendor = require('../models/Vendor');
const { authenticate, authorize } = require('../middleware/auth');
const { recordAuditLog } = require('../utils/auditLogger');
const { isValidImageUrl } = require('../middleware/security');

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ALLOWED_SORT_OPTIONS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  price_asc: { price: 1, _id: 1 },
  price_desc: { price: -1, _id: -1 },
  name_asc: { title: 1, _id: 1 },
  name_desc: { title: -1, _id: -1 },
  rating_desc: { averageRating: -1, totalRatings: -1, _id: -1 },
  rating_asc: { averageRating: 1, _id: 1 }
};

function ensureApprovedVendor(vendor, res) {
  if (!vendor) {
    res.status(404).json({ message: 'Vendor profile not found' });
    return false;
  }

  if (vendor.approvalStatus !== 'approved' || !vendor.onboardingComplete) {
    res.status(403).json({
      message: 'Your shop is not approved by admin yet. You can add products after approval.'
    });
    return false;
  }

  return true;
}

// Handler for fetching products with search, filtering, sorting and pagination
async function handleGetProducts(req, res) {
  try {
    const {
      search,
      category,
      minPrice,
      maxPrice,
      vendor,
      vendorId,
      inStock,
      availability,
      sort = 'newest',
      page = 1,
      limit = 12
    } = req.query;

    const filter = {};

    // 1. Keyword search across title and description
    if (search !== undefined && search !== null) {
      if (typeof search !== 'string') {
        return res.status(400).json({ message: 'Search query must be a string' });
      }
      const trimmedSearch = search.trim();
      if (trimmedSearch.length > 100) {
        return res.status(400).json({ message: 'Search query cannot exceed 100 characters' });
      }
      if (trimmedSearch.length > 0) {
        const tokens = trimmedSearch.split(/\s+/).filter(Boolean);
        if (tokens.length === 1) {
          const searchRegex = new RegExp(escapeRegex(tokens[0]), 'i');
          filter.$or = [
            { title: { $regex: searchRegex } },
            { description: { $regex: searchRegex } }
          ];
        } else if (tokens.length > 1) {
          filter.$and = tokens.map(token => {
            const regex = new RegExp(escapeRegex(token), 'i');
            return {
              $or: [
                { title: { $regex: regex } },
                { description: { $regex: regex } }
              ]
            };
          });
        }
      }
    }

    // 2. Category filtering
    if (category !== undefined && category !== null) {
      if (typeof category !== 'string') {
        return res.status(400).json({ message: 'Category must be a string' });
      }
      const trimmedCategory = category.trim();
      if (trimmedCategory.length > 0 && trimmedCategory.toLowerCase() !== 'all') {
        filter.category = { $regex: new RegExp(`^${escapeRegex(trimmedCategory)}$`, 'i') };
      }
    }

    // 3. Price filtering (minPrice & maxPrice)
    const priceFilter = {};
    if (minPrice !== undefined && minPrice !== null && minPrice !== '') {
      const parsedMin = Number(minPrice);
      if (isNaN(parsedMin) || !Number.isFinite(parsedMin) || parsedMin < 0) {
        return res.status(400).json({ message: 'minPrice must be a non-negative number' });
      }
      priceFilter.$gte = parsedMin;
    }

    if (maxPrice !== undefined && maxPrice !== null && maxPrice !== '') {
      const parsedMax = Number(maxPrice);
      if (isNaN(parsedMax) || !Number.isFinite(parsedMax) || parsedMax < 0) {
        return res.status(400).json({ message: 'maxPrice must be a non-negative number' });
      }
      priceFilter.$lte = parsedMax;
    }

    if (priceFilter.$gte !== undefined && priceFilter.$lte !== undefined) {
      if (priceFilter.$gte > priceFilter.$lte) {
        return res.status(400).json({ message: 'minPrice cannot be greater than maxPrice' });
      }
    }

    if (Object.keys(priceFilter).length > 0) {
      filter.price = priceFilter;
    }

    // 4. Vendor filtering
    const targetVendor = vendorId || vendor;
    if (targetVendor !== undefined && targetVendor !== null && targetVendor !== '') {
      if (!mongoose.Types.ObjectId.isValid(targetVendor)) {
        return res.status(400).json({ message: 'Invalid vendor ID' });
      }
      filter.vendorId = targetVendor;
    }

    // 5. Availability / stock filtering
    if (inStock !== undefined && inStock !== null && inStock !== '') {
      const normalizedInStock = String(inStock).toLowerCase().trim();
      if (normalizedInStock === 'true' || normalizedInStock === '1') {
        filter.stock = { $gt: 0 };
      } else if (normalizedInStock === 'false' || normalizedInStock === '0') {
        filter.stock = { $lte: 0 };
      } else {
        return res.status(400).json({ message: 'inStock must be "true" or "false"' });
      }
    } else if (availability !== undefined && availability !== null && availability !== '') {
      const normalizedAvail = String(availability).toLowerCase().trim();
      if (normalizedAvail === 'in_stock') {
        filter.stock = { $gt: 0 };
      } else if (normalizedAvail === 'out_of_stock') {
        filter.stock = { $lte: 0 };
      } else {
        return res.status(400).json({ message: 'availability must be "in_stock" or "out_of_stock"' });
      }
    }

    // 6. Sorting validation
    const sortKey = String(sort).trim().toLowerCase();
    if (!ALLOWED_SORT_OPTIONS[sortKey]) {
      return res.status(400).json({
        message: `Invalid sort field "${sort}". Allowed values: ${Object.keys(ALLOWED_SORT_OPTIONS).join(', ')}`
      });
    }
    const sortCriteria = ALLOWED_SORT_OPTIONS[sortKey];

    // 7. Pagination validation
    const pageStr = String(page).trim();
    if (!/^\d+$/.test(pageStr)) {
      return res.status(400).json({ message: 'Page must be a positive integer' });
    }
    const parsedPage = parseInt(pageStr, 10);
    if (parsedPage < 1) {
      return res.status(400).json({ message: 'Page must be a positive integer' });
    }

    const limitStr = String(limit).trim();
    if (!/^\d+$/.test(limitStr)) {
      return res.status(400).json({ message: 'Limit must be a positive integer' });
    }
    const parsedLimit = parseInt(limitStr, 10);
    if (parsedLimit < 1) {
      return res.status(400).json({ message: 'Limit must be a positive integer' });
    }
    if (parsedLimit > 100) {
      return res.status(400).json({ message: 'Limit exceeds maximum allowed page size of 100' });
    }

    const skip = (parsedPage - 1) * parsedLimit;

    // 8. Execute queries concurrently without loading entire collection in memory
    const [products, totalCount] = await Promise.all([
      Product.find(filter)
        .populate('vendorId', 'shopName description logoUrl address')
        .sort(sortCriteria)
        .skip(skip)
        .limit(parsedLimit)
        .lean(),
      Product.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(totalCount / parsedLimit);

    return res.json({
      success: true,
      products,
      totalCount,
      total: totalCount,
      totalPages,
      currentPage: parsedPage,
      page: parsedPage,
      limit: parsedLimit,
      count: products.length
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
}

// Get all products with search, filters, sort, pagination
router.get('/', handleGetProducts);

// Get products by category (path param)
router.get('/category/:category', (req, res) => {
  req.query.category = req.params.category;
  return handleGetProducts(req, res);
});

// Get vendor's products (placed before /:id to avoid route capture)
router.get('/vendor/my-products', authenticate, authorize('vendor'), async (req, res) => {
  try {
    const { vendorId } = req.query;
    let vendor;
    if (vendorId) {
      if (!mongoose.Types.ObjectId.isValid(vendorId)) {
        return res.status(400).json({ message: 'Invalid vendor ID format' });
      }
      const existingVendor = await Vendor.findById(vendorId);
      if (!existingVendor) {
        return res.status(404).json({ message: 'Vendor profile not found' });
      }
      if (existingVendor.userId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Access denied: You do not own this shop' });
      }
      vendor = existingVendor;
    } else {
      vendor = await Vendor.findOne({ userId: req.user._id }).sort({ createdAt: -1 });
      if (!vendor) {
        return res.status(404).json({ message: 'Vendor profile not found' });
      }
    }

    const products = await Product.find({ vendorId: vendor._id }).sort({ createdAt: -1 });
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get standard normalized product categories (placed before /:id)
router.get('/categories', (req, res) => {
  res.json(Product.STANDARD_CATEGORIES);
});

// Get single product
router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid product ID' });
    }

    const product = await Product.findById(req.params.id).populate('vendorId', 'shopName description logoUrl address');
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create product (vendor only)
router.post('/', authenticate, authorize('vendor'), async (req, res) => {
  try {
    const title = String(req.body.title || req.body.name || '').trim();
    if (!title) {
      return res.status(400).json({ message: 'Product title / name is required' });
    }

    const description = String(req.body.description || '').trim();
    if (!description) {
      return res.status(400).json({ message: 'Description is required' });
    }

    if (req.body.price === undefined || req.body.price === null || isNaN(Number(req.body.price)) || Number(req.body.price) < 0) {
      return res.status(400).json({ message: 'Price must be a non-negative number' });
    }
    const price = Number(req.body.price);

    let imageUrl = String(req.body.imageUrl || '').trim();
    const images = Array.isArray(req.body.images)
      ? req.body.images.map(img => String(img).trim()).filter(Boolean)
      : [];
    if (!imageUrl && images.length > 0) {
      imageUrl = images[0];
    }
    if (!imageUrl) {
      return res.status(400).json({ message: 'Product image URL is required' });
    }

    if (!isValidImageUrl(imageUrl)) {
      return res.status(400).json({ message: 'Invalid product image URL or scheme. Only HTTP, HTTPS, or base64 image data URIs are permitted.' });
    }

    for (const img of images) {
      if (!isValidImageUrl(img)) {
        return res.status(400).json({ message: 'Invalid gallery image URL or scheme. Only HTTP, HTTPS, or base64 image data URIs are permitted.' });
      }
    }

    const category = Product.normalizeCategory(req.body.category);
    const sku = String(req.body.sku || '').trim();

    let computedStock = 0;
    const variants = [];
    if (Array.isArray(req.body.variants) && req.body.variants.length > 0) {
      const skus = new Set();
      for (const v of req.body.variants) {
        if (!v || !v.name || !String(v.name).trim()) {
          return res.status(400).json({ message: 'Each variant must have a name' });
        }
        if (v.price !== undefined && (isNaN(Number(v.price)) || Number(v.price) < 0)) {
          return res.status(400).json({ message: 'Variant price must be non-negative' });
        }
        if (v.stock !== undefined && (isNaN(Number(v.stock)) || Number(v.stock) < 0)) {
          return res.status(400).json({ message: 'Variant stock must be non-negative' });
        }
        const variantSku = String(v.sku || '').trim();
        if (variantSku) {
          if (skus.has(variantSku)) {
            return res.status(400).json({ message: `Duplicate variant SKU "${variantSku}" within product` });
          }
          skus.add(variantSku);
        }
        const vStock = Math.floor(Number(v.stock || 0));
        computedStock += vStock;
        variants.push({
          name: String(v.name).trim(),
          sku: variantSku,
          price: v.price !== undefined ? Number(v.price) : price,
          stock: vStock,
          isActive: v.isActive !== false,
          options: Array.isArray(v.options) ? v.options : []
        });
      }
    } else {
      if (req.body.stock !== undefined) {
        const rawStock = Number(req.body.stock);
        if (isNaN(rawStock) || rawStock < 0 || !Number.isFinite(rawStock)) {
          return res.status(400).json({ message: 'Stock must be a non-negative number' });
        }
        computedStock = Math.floor(rawStock);
      } else {
        computedStock = 1;
      }
    }

    let vendor;
    if (req.body.vendorId) {
      if (!mongoose.Types.ObjectId.isValid(req.body.vendorId)) {
        return res.status(400).json({ message: 'Invalid vendor ID format' });
      }
      const existingVendor = await Vendor.findById(req.body.vendorId);
      if (!existingVendor) {
        return res.status(404).json({ message: 'Vendor profile not found' });
      }
      if (existingVendor.userId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Access denied: You do not own this vendor shop' });
      }
      vendor = existingVendor;
    } else {
      vendor = await Vendor.findOne({ userId: req.user._id }).sort({ createdAt: -1 });
    }

    if (!ensureApprovedVendor(vendor, res)) return;

    const product = new Product({
      vendorId: vendor._id,
      title,
      description,
      price,
      imageUrl,
      images,
      category,
      sku,
      stock: computedStock,
      variants
    });

    await product.save();

    await recordAuditLog({
      actorId: req.user._id,
      actorRole: req.user.role,
      action: 'product.create',
      resourceType: 'Product',
      resourceId: product._id.toString(),
      before: null,
      after: {
        title: product.title,
        price: product.price,
        stock: product.stock,
        sku: product.sku,
        category: product.category,
        variantsCount: product.variants?.length || 0
      },
      metadata: { vendorId: product.vendorId.toString() }
    });

    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update product (vendor only)
router.put('/:id', authenticate, authorize('vendor'), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid product ID format' });
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Ownership check: Ensure the vendor that owns this product belongs to the authenticated user
    const vendor = await Vendor.findOne({ _id: product.vendorId, userId: req.user._id });
    if (!vendor) {
      return res.status(403).json({ message: 'Not authorized to update this product' });
    }

    if (!ensureApprovedVendor(vendor, res)) return;

    const beforeState = {
      title: product.title,
      price: product.price,
      stock: product.stock,
      sku: product.sku,
      category: product.category
    };
    const previousStock = product.stock;

    // Never permit tampering with immutable system and relationship fields
    delete req.body._id;
    delete req.body.vendorId;
    delete req.body.inventoryOperations;
    delete req.body.averageRating;
    delete req.body.totalRatings;
    delete req.body.createdAt;

    // Handle title / name
    if (req.body.name && !req.body.title) {
      req.body.title = String(req.body.name).trim();
    }
    if (req.body.title !== undefined) {
      const trimmed = String(req.body.title).trim();
      if (!trimmed) {
        return res.status(400).json({ message: 'Title / name cannot be empty' });
      }
      product.title = trimmed;
    }

    if (req.body.description !== undefined) {
      const trimmed = String(req.body.description).trim();
      if (!trimmed) {
        return res.status(400).json({ message: 'Description cannot be empty' });
      }
      product.description = trimmed;
    }

    if (req.body.price !== undefined) {
      const parsedPrice = Number(req.body.price);
      if (isNaN(parsedPrice) || parsedPrice < 0 || !Number.isFinite(parsedPrice)) {
        return res.status(400).json({ message: 'Price must be a non-negative number' });
      }
      product.price = parsedPrice;
    }

    if (req.body.category !== undefined) {
      product.category = Product.normalizeCategory(req.body.category);
    }

    if (req.body.sku !== undefined) {
      product.sku = String(req.body.sku).trim();
    }

    if (req.body.imageUrl !== undefined) {
      const img = String(req.body.imageUrl).trim();
      if (img) {
        if (!isValidImageUrl(img)) {
          return res.status(400).json({ message: 'Invalid product image URL or scheme. Only HTTP, HTTPS, or base64 image data URIs are permitted.' });
        }
        product.imageUrl = img;
      }
    }

    if (Array.isArray(req.body.images)) {
      const candidateImages = req.body.images.map(img => String(img).trim()).filter(Boolean);
      for (const img of candidateImages) {
        if (!isValidImageUrl(img)) {
          return res.status(400).json({ message: 'Invalid gallery image URL or scheme. Only HTTP, HTTPS, or base64 image data URIs are permitted.' });
        }
      }
      product.images = candidateImages;
      if (!product.imageUrl && product.images.length > 0) {
        product.imageUrl = product.images[0];
      }
    }

    // Handle variant-level and aggregate stock updates
    if (Array.isArray(req.body.variants)) {
      if (req.body.variants.length > 0) {
        const skus = new Set();
        let computedStock = 0;
        const updatedVariants = [];
        for (const v of req.body.variants) {
          if (!v || !v.name || !String(v.name).trim()) {
            return res.status(400).json({ message: 'Each variant must have a name' });
          }
          if (v.price !== undefined && (isNaN(Number(v.price)) || Number(v.price) < 0 || !Number.isFinite(Number(v.price)))) {
            return res.status(400).json({ message: 'Variant price must be non-negative' });
          }
          if (v.stock !== undefined && (isNaN(Number(v.stock)) || Number(v.stock) < 0 || !Number.isFinite(Number(v.stock)))) {
            return res.status(400).json({ message: 'Variant stock must be non-negative' });
          }
          const vSku = String(v.sku || '').trim();
          if (vSku) {
            if (skus.has(vSku)) {
              return res.status(400).json({ message: `Duplicate variant SKU "${vSku}" within product` });
            }
            skus.add(vSku);
          }
          const vStock = Math.floor(Number(v.stock || 0));
          computedStock += vStock;
          updatedVariants.push({
            name: String(v.name).trim(),
            sku: vSku,
            price: v.price !== undefined ? Number(v.price) : product.price,
            stock: vStock,
            isActive: v.isActive !== false,
            options: Array.isArray(v.options) ? v.options : []
          });
        }
        product.variants = updatedVariants;
        product.stock = computedStock;
      } else {
        product.variants = [];
        if (req.body.stock !== undefined) {
          const parsedStock = Number(req.body.stock);
          if (isNaN(parsedStock) || parsedStock < 0 || !Number.isFinite(parsedStock)) {
            return res.status(400).json({ message: 'Stock must be a non-negative number' });
          }
          product.stock = Math.floor(parsedStock);
        }
      }
    } else if (req.body.stock !== undefined) {
      const parsedStock = Number(req.body.stock);
      if (isNaN(parsedStock) || parsedStock < 0 || !Number.isFinite(parsedStock)) {
        return res.status(400).json({ message: 'Stock must be a non-negative number' });
      }
      product.stock = Math.floor(parsedStock);
    }

    product.updatedAt = new Date();
    await product.save();

    await recordAuditLog({
      actorId: req.user._id,
      actorRole: req.user.role,
      action: 'product.update',
      resourceType: 'Product',
      resourceId: product._id.toString(),
      before: beforeState,
      after: {
        title: product.title,
        price: product.price,
        stock: product.stock,
        sku: product.sku,
        category: product.category
      },
      metadata: { vendorId: product.vendorId.toString() }
    });

    if (previousStock !== product.stock) {
      await recordAuditLog({
        actorId: req.user._id,
        actorRole: req.user.role,
        action: 'inventory.adjust',
        resourceType: 'Product',
        resourceId: product._id.toString(),
        before: { stock: previousStock },
        after: { stock: product.stock },
        metadata: {
          delta: product.stock - previousStock,
          vendorId: product.vendorId.toString(),
          reason: 'Manual vendor stock update'
        }
      });
    }

    res.json(product);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete product (vendor only)
router.delete('/:id', authenticate, authorize('vendor'), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid product ID format' });
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const vendor = await Vendor.findOne({ _id: product.vendorId, userId: req.user._id });
    if (!vendor) {
      return res.status(403).json({ message: 'Not authorized to delete this product' });
    }

    if (!ensureApprovedVendor(vendor, res)) return;

    const beforeState = {
      title: product.title,
      price: product.price,
      stock: product.stock,
      sku: product.sku,
      category: product.category
    };
    const previousStock = product.stock;

    await product.deleteOne();

    await recordAuditLog({
      actorId: req.user._id,
      actorRole: req.user.role,
      action: 'product.delete',
      resourceType: 'Product',
      resourceId: product._id.toString(),
      before: beforeState,
      after: null,
      metadata: { vendorId: product.vendorId.toString() }
    });

    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

