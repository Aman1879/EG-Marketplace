const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Address = require('../models/Address');
const { authenticate, authorize } = require('../middleware/auth');

/**
 * Validate and clean address input fields.
 * Returns { isValid, errors, sanitized }
 */
function sanitizeAndValidateAddress(data) {
  const errors = [];

  const fullName = String(data.fullName || data.name || data.recipientName || '').trim();
  if (!fullName) {
    errors.push('Recipient full name is required');
  }

  const rawPhone = String(data.phone || data.mobile || '').trim();
  const cleanPhone = rawPhone.replace(/^(\+91[\-\s]?|0)/, '').replace(/[\s\-]/g, '');
  if (!cleanPhone || !/^[6-9]\d{9}$/.test(cleanPhone)) {
    errors.push('Valid 10-digit Indian phone number is required (starts with 6, 7, 8, or 9)');
  }

  const addressLine1 = String(data.addressLine1 || data.house || '').trim();
  if (!addressLine1) {
    errors.push('Address line 1 (house/flat/building) is required');
  }

  const addressLine2 = String(data.addressLine2 || data.street || '').trim();
  const landmark = String(data.landmark || '').trim();

  const city = String(data.city || '').trim();
  if (!city) {
    errors.push('City is required');
  }

  const state = String(data.state || '').trim();
  if (!state) {
    errors.push('State is required');
  }

  const postalCode = String(data.postalCode || data.pin || '').trim();
  if (!postalCode || !/^\d{6}$/.test(postalCode)) {
    errors.push('Valid 6-digit postal code / PIN is required');
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: {
      fullName,
      phone: cleanPhone,
      addressLine1,
      addressLine2,
      landmark,
      city,
      state,
      postalCode,
      isDefault: Boolean(data.isDefault)
    }
  };
}

// GET /api/addresses - List all saved addresses for the authenticated user
router.get('/', authenticate, async (req, res) => {
  try {
    const addresses = await Address.find({ userId: req.user._id })
      .sort({ isDefault: -1, updatedAt: -1, createdAt: -1 });

    res.json({
      success: true,
      count: addresses.length,
      addresses
    });
  } catch (error) {
    console.error('Error fetching addresses:', error);
    res.status(500).json({ message: 'Error fetching addresses', error: error.message });
  }
});

// POST /api/addresses - Create a new saved delivery address
router.post('/', authenticate, async (req, res) => {
  try {
    const { isValid, errors, sanitized } = sanitizeAndValidateAddress(req.body);
    if (!isValid) {
      return res.status(400).json({
        message: errors[0],
        errors
      });
    }

    const existingCount = await Address.countDocuments({ userId: req.user._id });
    // If this is the user's first address, ensure it is set as default
    if (existingCount === 0) {
      sanitized.isDefault = true;
    }

    // If marked as default, atomically unset any existing default address
    if (sanitized.isDefault) {
      await Address.updateMany(
        { userId: req.user._id },
        { $set: { isDefault: false } }
      );
    }

    const newAddress = new Address({
      userId: req.user._id,
      ...sanitized
    });

    await newAddress.save();

    res.status(201).json({
      success: true,
      message: 'Address saved successfully',
      address: newAddress
    });
  } catch (error) {
    console.error('Error creating address:', error);
    res.status(500).json({ message: 'Error creating address', error: error.message });
  }
});

// GET /api/addresses/:id - Get a single saved address by ID (ownership enforced)
router.get('/:id', authenticate, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid address ID format' });
    }

    const address = await Address.findById(req.params.id);
    if (!address) {
      return res.status(404).json({ message: 'Address not found' });
    }

    if (address.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied: You do not own this address' });
    }

    res.json({
      success: true,
      address
    });
  } catch (error) {
    console.error('Error fetching address:', error);
    res.status(500).json({ message: 'Error fetching address', error: error.message });
  }
});

// PUT /api/addresses/:id - Update an existing saved address (ownership enforced)
router.put('/:id', authenticate, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid address ID format' });
    }

    const address = await Address.findById(req.params.id);
    if (!address) {
      return res.status(404).json({ message: 'Address not found' });
    }

    if (address.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied: You do not own this address' });
    }

    const { isValid, errors, sanitized } = sanitizeAndValidateAddress(req.body);
    if (!isValid) {
      return res.status(400).json({
        message: errors[0],
        errors
      });
    }

    // If updating to default, unset other addresses
    if (sanitized.isDefault) {
      await Address.updateMany(
        { userId: req.user._id, _id: { $ne: address._id } },
        { $set: { isDefault: false } }
      );
    }

    // Apply updates
    address.fullName = sanitized.fullName;
    address.phone = sanitized.phone;
    address.addressLine1 = sanitized.addressLine1;
    address.addressLine2 = sanitized.addressLine2;
    address.landmark = sanitized.landmark;
    address.city = sanitized.city;
    address.state = sanitized.state;
    address.postalCode = sanitized.postalCode;
    address.isDefault = sanitized.isDefault;
    address.updatedAt = new Date();

    await address.save();

    res.json({
      success: true,
      message: 'Address updated successfully',
      address
    });
  } catch (error) {
    console.error('Error updating address:', error);
    res.status(500).json({ message: 'Error updating address', error: error.message });
  }
});

// DELETE /api/addresses/:id - Delete a saved address (ownership enforced)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid address ID format' });
    }

    const address = await Address.findById(req.params.id);
    if (!address) {
      return res.status(404).json({ message: 'Address not found' });
    }

    if (address.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied: You do not own this address' });
    }

    const wasDefault = address.isDefault;
    await Address.deleteOne({ _id: address._id });

    // If the deleted address was default, promote the next available address as default
    if (wasDefault) {
      const nextDefault = await Address.findOne({ userId: req.user._id })
        .sort({ updatedAt: -1, createdAt: -1 });

      if (nextDefault) {
        nextDefault.isDefault = true;
        await nextDefault.save();
      }
    }

    res.json({
      success: true,
      message: 'Address deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting address:', error);
    res.status(500).json({ message: 'Error deleting address', error: error.message });
  }
});

// PATCH /api/addresses/:id/default - Set an address as default (ownership enforced)
router.patch('/:id/default', authenticate, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid address ID format' });
    }

    const address = await Address.findById(req.params.id);
    if (!address) {
      return res.status(404).json({ message: 'Address not found' });
    }

    if (address.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied: You do not own this address' });
    }

    // Atomically unset other addresses' isDefault
    await Address.updateMany(
      { userId: req.user._id, _id: { $ne: address._id } },
      { $set: { isDefault: false } }
    );

    address.isDefault = true;
    address.updatedAt = new Date();
    await address.save();

    res.json({
      success: true,
      message: 'Default address updated successfully',
      address
    });
  } catch (error) {
    console.error('Error setting default address:', error);
    res.status(500).json({ message: 'Error setting default address', error: error.message });
  }
});

module.exports = router;

