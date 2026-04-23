const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Vendor = require('../models/Vendor');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { authenticate, authorize } = require('../middleware/auth');
const { razorpay, hasRazorpayCredentials } = require('../config/razorpay');

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

function maskAccountNumber(accountNumber) {
  const digits = String(accountNumber || '').replace(/\D/g, '');
  return digits ? digits.slice(-4) : '';
}

async function createLinkedAccountForVendor(vendor, bankDetails) {
  if (!hasRazorpayCredentials) {
    throw new Error('Razorpay credentials are not configured on server');
  }

  const fallbackEmail = vendor.contactEmail || `vendor-${vendor._id}@example.com`;
  const fallbackPhone = vendor.contactPhone || '9000000000';

  const payload = {
    email: fallbackEmail,
    phone: fallbackPhone,
    type: 'route',
    reference_id: `vendor_${vendor._id}`,
    legal_business_name: vendor.shopName || 'Marketplace Vendor',
    business_type: 'individual',
    contact_name: vendor.shopName || 'Vendor',
    profile: {
      category: 'services',
      subcategory: 'consulting'
    },
    notes: {
      vendorId: vendor._id.toString(),
      shopName: vendor.shopName || ''
    }
  };

  if (bankDetails?.accountNumber && bankDetails?.ifscCode) {
    payload.bank_account = {
      name: bankDetails.accountHolderName || vendor.shopName || 'Vendor',
      ifsc: bankDetails.ifscCode,
      account_number: String(bankDetails.accountNumber),
      beneficiary_name: bankDetails.beneficiaryName || bankDetails.accountHolderName || vendor.shopName || 'Vendor'
    };
  }

  const account = await razorpay.accounts.create(payload);
  return account;
}

// Create linked account for a shop (Razorpay Route)
router.post('/:id/razorpay/linked-account', authenticate, authorize('vendor'), async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ _id: req.params.id, userId: req.user._id });
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor shop not found' });
    }

    if (vendor.razorpayAccountId) {
      return res.json({
        message: 'Linked account already exists',
        razorpayAccountId: vendor.razorpayAccountId,
        razorpayAccountStatus: vendor.razorpayAccountStatus,
        kycStatus: vendor.kycStatus
      });
    }

    const bankDetails = req.body?.bankDetails || {};
    const account = await createLinkedAccountForVendor(vendor, bankDetails);

    vendor.razorpayAccountId = account.id;
    vendor.razorpayAccountStatus = account.status === 'activated' ? 'activated' : 'created';
    vendor.kycStatus = account.status === 'activated' ? 'verified' : 'pending';
    if (bankDetails.accountNumber) {
      vendor.payoutDetails = {
        accountHolderName: bankDetails.accountHolderName || '',
        accountNumberLast4: maskAccountNumber(bankDetails.accountNumber),
        ifscCode: bankDetails.ifscCode || '',
        bankName: bankDetails.bankName || '',
        beneficiaryName: bankDetails.beneficiaryName || ''
      };
    }
    if (req.body?.upiId) {
      vendor.upiId = String(req.body.upiId).trim();
    }

    await vendor.save();

    res.status(201).json({
      message: 'Vendor linked account created successfully',
      razorpayAccountId: vendor.razorpayAccountId,
      razorpayAccountStatus: vendor.razorpayAccountStatus,
      kycStatus: vendor.kycStatus,
      upiId: vendor.upiId,
      payoutDetails: vendor.payoutDetails
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create Razorpay linked account', error: error.message });
  }
});

// Update payout settings for a specific shop
router.put('/:id/payout-settings', authenticate, authorize('vendor'), async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ _id: req.params.id, userId: req.user._id });
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor shop not found' });
    }

    const {
      upiId,
      accountHolderName,
      accountNumber,
      ifscCode,
      bankName,
      beneficiaryName,
      autoCreateLinkedAccount
    } = req.body;

    if (typeof upiId === 'string') {
      vendor.upiId = upiId.trim();
    }

    const hasBankPayload = accountNumber || ifscCode || accountHolderName || bankName || beneficiaryName;
    if (hasBankPayload) {
      vendor.payoutDetails = {
        accountHolderName: String(accountHolderName || vendor.payoutDetails?.accountHolderName || '').trim(),
        accountNumberLast4: accountNumber ? maskAccountNumber(accountNumber) : vendor.payoutDetails?.accountNumberLast4 || '',
        ifscCode: String(ifscCode || vendor.payoutDetails?.ifscCode || '').trim().toUpperCase(),
        bankName: String(bankName || vendor.payoutDetails?.bankName || '').trim(),
        beneficiaryName: String(beneficiaryName || vendor.payoutDetails?.beneficiaryName || '').trim()
      };
    }

    if (!vendor.razorpayAccountId && autoCreateLinkedAccount) {
      const account = await createLinkedAccountForVendor(vendor, {
        accountHolderName,
        accountNumber,
        ifscCode,
        bankName,
        beneficiaryName
      });
      vendor.razorpayAccountId = account.id;
      vendor.razorpayAccountStatus = account.status === 'activated' ? 'activated' : 'created';
      vendor.kycStatus = account.status === 'activated' ? 'verified' : 'pending';
    }

    await vendor.save();

    res.json({
      message: 'Payout settings updated',
      vendor: {
        _id: vendor._id,
        shopName: vendor.shopName,
        upiId: vendor.upiId,
        payoutDetails: vendor.payoutDetails,
        razorpayAccountId: vendor.razorpayAccountId,
        razorpayAccountStatus: vendor.razorpayAccountStatus,
        kycStatus: vendor.kycStatus
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update payout settings', error: error.message });
  }
});

// Get payout settings for selected shop
router.get('/:id/payout-settings', authenticate, authorize('vendor'), async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ _id: req.params.id, userId: req.user._id });
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor shop not found' });
    }

    const paidOrdersCount = await Order.countDocuments({ vendorId: vendor._id, paymentStatus: 'paid' });
    const totals = await Order.aggregate([
      { $match: { vendorId: vendor._id, paymentStatus: 'paid' } },
      {
        $group: {
          _id: null,
          totalOrderVolume: { $sum: '$totalAmount' },
          totalCommissionPaid: { $sum: '$adminCommission' }
        }
      }
    ]);

    res.json({
      _id: vendor._id,
      shopName: vendor.shopName,
      upiId: vendor.upiId,
      payoutDetails: vendor.payoutDetails,
      razorpayAccountId: vendor.razorpayAccountId,
      razorpayAccountStatus: vendor.razorpayAccountStatus,
      kycStatus: vendor.kycStatus,
      totalEarnings: vendor.totalEarnings || 0,
      totalPaidEarnings: vendor.totalPaidEarnings || 0,
      paidOrdersCount,
      totalOrderVolume: totals?.[0]?.totalOrderVolume || 0,
      totalCommissionPaid: totals?.[0]?.totalCommissionPaid || 0
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch payout settings', error: error.message });
  }
});

// Earnings summary for all shops of current vendor
router.get('/my/earnings-summary', authenticate, authorize('vendor'), async (req, res) => {
  try {
    const shops = await Vendor.find({ userId: req.user._id }).sort({ createdAt: -1 });

    const summary = await Promise.all(
      shops.map(async (shop) => {
        const paidOrdersCount = await Order.countDocuments({ vendorId: shop._id, paymentStatus: 'paid' });
        const totalOrderVolume = await Order.aggregate([
          { $match: { vendorId: shop._id, paymentStatus: 'paid' } },
          { $group: { _id: null, amount: { $sum: '$totalAmount' }, commission: { $sum: '$adminCommission' } } }
        ]);

        return {
          vendorId: shop._id,
          shopName: shop.shopName,
          paidOrdersCount,
          totalPaidEarnings: shop.totalPaidEarnings || 0,
          totalEarnings: shop.totalEarnings || 0,
          totalOrderVolume: totalOrderVolume?.[0]?.amount || 0,
          totalCommissionPaid: totalOrderVolume?.[0]?.commission || 0,
          razorpayAccountStatus: shop.razorpayAccountStatus,
          kycStatus: shop.kycStatus
        };
      })
    );

    res.json(summary);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch earnings summary', error: error.message });
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

