const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Vendor = require('../models/Vendor');
const Product = require('../models/Product');
const { authenticate, authorize } = require('../middleware/auth');

// Get current vendor profile (latest)
router.get('/me', authenticate, authorize('vendor'), async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ userId: req.user._id }).sort({ createdAt: -1 });
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor profile not found' });
    }
    res.json(vendor);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// List all shops for vendor
router.get('/my-shops', authenticate, authorize('vendor'), async (req, res) => {
  try {
    const shops = await Vendor.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json(shops);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Custom validator for URLs or data URLs
const validateUrlOrDataUrl = (value) => {
  if (!value || (typeof value === 'string' && value.trim() === '')) return true; // optional field
  if (typeof value === 'string' && value.startsWith('data:image/')) return true; // data URL
  try {
    new URL(value); // regular URL
    return true;
  } catch {
    return false;
  }
};

// Create new shop
router.post('/create', authenticate, authorize('vendor'), [
  body('shopName')
    .exists().withMessage('Shop name is required')
    .trim()
    .isLength({ min: 3 }).withMessage('Shop name must be at least 3 characters'),
  body('description')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 500 }).withMessage('Description too long'),
  body('category')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 100 }),
  body('categories')
    .optional()
    .custom((value) => {
      if (!value || value === '' || (Array.isArray(value) && value.length === 0)) return true;
      return Array.isArray(value);
    }).withMessage('Categories must be an array'),
  body('country')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 100 }),
  body('logoUrl')
    .optional()
    .custom(validateUrlOrDataUrl)
    .withMessage('Logo must be a valid URL or data URL'),
  body('bannerUrl')
    .optional()
    .custom(validateUrlOrDataUrl)
    .withMessage('Banner must be a valid URL or data URL'),
  body('address')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 200 }),
  body('contactEmail')
    .optional()
    .custom((value) => {
      if (!value || (typeof value === 'string' && value.trim() === '')) return true;
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
    }).withMessage('Contact email must be valid'),
  body('contactPhone')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 30 })
], async (req, res) => {
  try {
    console.log('=== Shop Creation Request ===');
    console.log('User ID:', req.user?._id);
    console.log('Body keys:', Object.keys(req.body));
    console.log('Shop name:', req.body.shopName);
    console.log('Category:', req.body.category);
    console.log('Categories:', req.body.categories);
    console.log('Logo URL type:', typeof req.body.logoUrl, req.body.logoUrl ? (req.body.logoUrl.substring(0, 50) + '...') : 'empty');
    console.log('Banner URL type:', typeof req.body.bannerUrl, req.body.bannerUrl ? (req.body.bannerUrl.substring(0, 50) + '...') : 'empty');
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('Validation errors:', errors.array());
      return res.status(400).json({ 
        message: 'Validation failed',
        errors: errors.array() 
      });
    }

    const { shopName, description, category, categories, country, logoUrl, bannerUrl, address, contactEmail, contactPhone } = req.body;
    
    // Normalize categories
    let normalizedCategories = [];
    if (Array.isArray(categories) && categories.length > 0) {
      normalizedCategories = categories.map(c => String(c).trim()).filter(Boolean);
    } else if (category && String(category).trim()) {
      normalizedCategories = [String(category).trim()];
    }

    // Clean up empty strings for optional fields
    const vendorData = {
      userId: req.user._id,
      shopName: shopName.trim(),
      description: (description && description.trim()) || '',
      category: (category && category.trim()) || '',
      categories: normalizedCategories,
      country: (country && country.trim()) || 'India',
      logoUrl: (logoUrl && logoUrl.trim()) || '',
      bannerUrl: (bannerUrl && bannerUrl.trim()) || '',
      address: (address && address.trim()) || '',
      contactEmail: (contactEmail && contactEmail.trim()) || '',
      contactPhone: (contactPhone && contactPhone.trim()) || '',
      onboardingComplete: true
    };

    console.log('Creating vendor with data:', { ...vendorData, logoUrl: vendorData.logoUrl?.substring(0, 50) + '...', bannerUrl: vendorData.bannerUrl?.substring(0, 50) + '...' });
    
    // Check if vendor already has a shop with this name
    const existingShop = await Vendor.findOne({ 
      userId: vendorData.userId, 
      shopName: vendorData.shopName 
    });
    
    let vendor;
    if (existingShop) {
      // Update existing shop with same name
      Object.assign(existingShop, vendorData);
      vendor = await existingShop.save();
      console.log('Vendor shop updated:', vendor._id);
      res.json({
        message: 'Vendor shop updated',
        vendor
      });
    } else {
      // Create new shop (vendors can have multiple shops)
      vendor = new Vendor(vendorData);
      await vendor.save();
      console.log('Vendor created successfully:', vendor._id);
      res.json({
        message: 'Vendor shop created',
        vendor
      });
    }
  } catch (error) {
    console.error('Shop creation error:', {
      name: error.name,
      message: error.message,
      code: error.code,
      stack: error.stack,
      errors: error.errors
    });
    
    // Handle MongoDB duplicate key error
    if (error.code === 11000) {
      // Try to find and update existing shop
      try {
        const { category, categories } = req.body;
        let normalizedCategories = [];
        if (Array.isArray(categories) && categories.length > 0) {
          normalizedCategories = categories.map(c => String(c).trim()).filter(Boolean);
        } else if (category && String(category).trim()) {
          normalizedCategories = [String(category).trim()];
        }
        
        const existingShop = await Vendor.findOne({ userId: req.user._id }).sort({ createdAt: -1 });
        if (existingShop) {
          Object.assign(existingShop, {
            shopName: req.body.shopName?.trim(),
            description: (req.body.description && req.body.description.trim()) || existingShop.description || '',
            category: (req.body.category && req.body.category.trim()) || existingShop.category || '',
            categories: normalizedCategories.length ? normalizedCategories : existingShop.categories || [],
            country: (req.body.country && req.body.country.trim()) || existingShop.country || 'India',
            logoUrl: (req.body.logoUrl && req.body.logoUrl.trim()) || existingShop.logoUrl || '',
            bannerUrl: (req.body.bannerUrl && req.body.bannerUrl.trim()) || existingShop.bannerUrl || '',
            address: (req.body.address && req.body.address.trim()) || existingShop.address || '',
            contactEmail: (req.body.contactEmail && req.body.contactEmail.trim()) || existingShop.contactEmail || '',
            contactPhone: (req.body.contactPhone && req.body.contactPhone.trim()) || existingShop.contactPhone || '',
            onboardingComplete: true
          });
          const updated = await existingShop.save();
          return res.json({
            message: 'Vendor shop updated',
            vendor: updated
          });
        }
      } catch (updateError) {
        console.error('Error updating existing shop:', updateError);
      }
      
      return res.status(400).json({ 
        message: 'A shop already exists for this user. Please update your existing shop or create a shop with a different name.',
        error: 'Duplicate shop'
      });
    }
    
    // Handle Mongoose validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message
      }));
      return res.status(400).json({ 
        message: 'Validation error',
        errors: validationErrors
      });
    }
    
    res.status(500).json({ 
      message: 'Server error', 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Update existing shop
router.post('/profile', authenticate, authorize('vendor'), [
  body('vendorId').optional({ checkFalsy: true }).isMongoId().withMessage('Invalid vendorId'),
  body('shopName').trim().isLength({ min: 3 }).withMessage('Shop name must be at least 3 characters'),
  body('description').optional({ checkFalsy: true }).trim().isLength({ max: 500 }).withMessage('Description too long'),
  body('category').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('categories').optional({ checkFalsy: true }).custom((value) => {
    if (!value) return true;
    return Array.isArray(value) || (typeof value === 'string' && value.trim() === '');
  }).withMessage('Categories must be an array'),
  body('country').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('logoUrl').optional({ checkFalsy: true }).custom(validateUrlOrDataUrl).withMessage('Logo must be a valid URL or data URL'),
  body('bannerUrl').optional({ checkFalsy: true }).custom(validateUrlOrDataUrl).withMessage('Banner must be a valid URL or data URL'),
  body('address').optional({ checkFalsy: true }).trim().isLength({ max: 200 }),
  body('contactEmail').optional({ checkFalsy: true }).custom((value) => {
    if (!value || value.trim() === '') return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }).withMessage('Contact email must be valid'),
  body('contactPhone').optional({ checkFalsy: true }).trim().isLength({ max: 30 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { vendorId, shopName, description, category, categories, country, logoUrl, bannerUrl, address, contactEmail, contactPhone } = req.body;
    let normalizedCategories = [];
    if (Array.isArray(categories) && categories.length > 0) {
      normalizedCategories = categories.map(c => String(c).trim()).filter(Boolean);
    } else if (category && String(category).trim()) {
      normalizedCategories = [String(category).trim()];
    }

    let vendor;
    if (vendorId) {
      vendor = await Vendor.findOne({ _id: vendorId, userId: req.user._id });
      if (!vendor) {
        return res.status(404).json({ message: 'Vendor shop not found' });
      }
    } else {
      vendor = await Vendor.findOne({ userId: req.user._id }).sort({ createdAt: -1 });
      if (!vendor) {
        return res.status(404).json({ message: 'Vendor profile not found' });
      }
    }

    vendor.shopName = shopName;
    vendor.description = description || vendor.description;
    vendor.category = category || vendor.category || '';
    vendor.categories = normalizedCategories.length ? normalizedCategories : vendor.categories || [];
    vendor.country = country || vendor.country || '';
    vendor.logoUrl = logoUrl || vendor.logoUrl || '';
    vendor.bannerUrl = bannerUrl || vendor.bannerUrl || '';
    vendor.address = address || vendor.address || '';
    vendor.contactEmail = contactEmail || vendor.contactEmail || '';
    vendor.contactPhone = contactPhone || vendor.contactPhone || '';
    vendor.onboardingComplete = true;

    await vendor.save();

    res.json({
      message: 'Vendor shop updated',
      vendor
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Public: list shops (optional category filter)
router.get('/shops', async (req, res) => {
  try {
    const { category } = req.query;
    const filter = { onboardingComplete: true };
    if (category) {
      filter.$or = [
        { categories: { $regex: new RegExp(category, 'i') } },
        { category: { $regex: new RegExp(category, 'i') } }
      ];
    }
    const shops = await Vendor.find(filter)
      .select('shopName description logoUrl bannerUrl categories category country averageRating totalRatings');
    res.json(shops);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Public: get a shop and its products
router.get('/:id/public', async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id)
      .select('shopName description logoUrl bannerUrl categories category country contactEmail contactPhone averageRating totalRatings onboardingComplete');
    if (!vendor || !vendor.onboardingComplete) {
      return res.status(404).json({ message: 'Shop not found' });
    }
    const products = await Product.find({ vendorId: vendor._id }).sort({ createdAt: -1 });
    res.json({ vendor, products });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

