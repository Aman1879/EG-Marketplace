const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const CartItem = require('../models/CartItem');
const Product = require('../models/Product');
const { authenticate, authorize } = require('../middleware/auth');

function roundCurrency(value) {
  return Number((value || 0).toFixed(2));
}

function toPaise(value) {
  return Math.round(Number(value || 0) * 100);
}

function computeCartPricing(validItems) {
  let subtotalPaise = 0;
  let totalQuantity = 0;
  let allInStock = true;

  for (const item of validItems) {
    const itemSubtotalPaise = toPaise(item.unitPrice) * item.quantity;
    subtotalPaise += itemSubtotalPaise;
    totalQuantity += item.quantity;
    if (!item.inStock || !item.isAvailable) {
      allInStock = false;
    }
  }

  const subtotal = roundCurrency(subtotalPaise / 100);
  const discount = 0.00;
  const shipping = 0.00;
  const tax = 0.00;
  const total = roundCurrency((subtotalPaise - toPaise(discount) + toPaise(shipping) + toPaise(tax)) / 100);

  return {
    pricing: {
      subtotal,
      discount,
      shipping,
      tax,
      total,
      currency: 'INR'
    },
    subtotal,
    discount,
    shipping,
    tax,
    total,
    itemCount: validItems.length,
    totalQuantity,
    canCheckout: validItems.length > 0 && allInStock
  };
}

async function handleGetCart(req, res) {
  try {
    const items = await CartItem.find({ userId: req.user._id })
      .populate('productId');

    // Remove items whose products no longer exist in database
    const validItems = [];
    for (const item of items) {
      if (!item.productId) {
        await CartItem.deleteOne({ _id: item._id });
        continue;
      }

      let matchedVariant = null;
      if (item.variantId && Array.isArray(item.productId.variants)) {
        matchedVariant = item.productId.variants.find(
          v => v._id.toString() === item.variantId.toString()
        );
      }

      const unitPrice = (matchedVariant && matchedVariant.price !== undefined && matchedVariant.price !== null)
        ? Number(matchedVariant.price)
        : Number(item.productId.price);

      const availableStock = matchedVariant
        ? Number(matchedVariant.stock)
        : Number(item.productId.stock);

      const isAvailable = Boolean(item.productId) && (matchedVariant ? matchedVariant.isActive !== false : true);
      const inStock = isAvailable && availableStock >= item.quantity;

      let stockStatus = 'in_stock';
      if (!isAvailable) {
        stockStatus = 'unavailable';
      } else if (availableStock <= 0) {
        stockStatus = 'out_of_stock';
      } else if (availableStock < item.quantity) {
        stockStatus = 'insufficient_stock';
      } else if (availableStock <= 3) {
        stockStatus = 'low_stock';
      }

      const itemSubtotalPaise = toPaise(unitPrice) * item.quantity;
      const itemSubtotal = roundCurrency(itemSubtotalPaise / 100);

      validItems.push({
        _id: item._id,
        productId: item.productId._id,
        variantId: item.variantId || null,
        variantName: item.variantName || (matchedVariant ? matchedVariant.name : ''),
        variantSku: item.variantSku || (matchedVariant ? matchedVariant.sku : ''),
        quantity: item.quantity,
        unitPrice,
        price: unitPrice,
        priceAtAdd: item.priceAtAdd,
        itemSubtotal,
        availableStock,
        stockStatus,
        inStock,
        isAvailable,
        addedAt: item.addedAt,
        product: item.productId,
        variant: matchedVariant
      });
    }

    if (req.query.format === 'summary' || req.originalUrl.includes('/summary')) {
      const summary = computeCartPricing(validItems);
      return res.json({
        success: true,
        items: validItems,
        ...summary
      });
    }

    res.json(validItems);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
}

// Get cart for current buyer
router.get('/', authenticate, authorize('buyer'), handleGetCart);

// Get server-calculated cart pricing breakdown and summary
router.get('/summary', authenticate, authorize('buyer'), handleGetCart);

// Add item to cart (upsert with variant support)
router.post('/add', authenticate, authorize('buyer'), [
  body('productId').notEmpty().withMessage('Product ID is required'),
  body('quantity').optional().isInt({ min: 1 }).withMessage('Quantity must be at least 1')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { productId, quantity = 1, variantId = null } = req.body;
    const parsedQty = parseInt(quantity, 10);
    if (isNaN(parsedQty) || parsedQty <= 0) {
      return res.status(400).json({ message: 'Quantity must be a positive integer' });
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: 'Invalid product ID' });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    let effectivePrice = product.price;
    let availableStock = product.stock;
    let variantName = '';
    let variantSku = '';
    let targetVariantId = null;

    if (variantId) {
      if (!mongoose.Types.ObjectId.isValid(variantId)) {
        return res.status(400).json({ message: 'Invalid variant ID' });
      }

      const variant = (product.variants || []).find(v => v._id.toString() === variantId.toString());
      if (!variant) {
        return res.status(404).json({ message: 'Selected variant not found on this product' });
      }

      if (variant.isActive === false) {
        return res.status(400).json({ message: `Variant "${variant.name}" is currently inactive` });
      }

      targetVariantId = variant._id;
      variantName = variant.name;
      variantSku = variant.sku || '';
      availableStock = variant.stock;
      if (variant.price !== undefined && variant.price !== null) {
        effectivePrice = variant.price;
      }
    } else if (product.variants && product.variants.length > 0) {
      // Product has variants but no variant specified: use first active variant
      const defaultVariant = product.variants.find(v => v.isActive !== false) || product.variants[0];
      if (defaultVariant) {
        targetVariantId = defaultVariant._id;
        variantName = defaultVariant.name;
        variantSku = defaultVariant.sku || '';
        availableStock = defaultVariant.stock;
        if (defaultVariant.price !== undefined && defaultVariant.price !== null) {
          effectivePrice = defaultVariant.price;
        }
      }
    }

    if (availableStock <= 0) {
      const label = variantName ? `"${product.title} (${variantName})"` : `"${product.title}"`;
      return res.status(400).json({ message: `${label} is currently out of stock` });
    }

    // Look for existing cart item with the same product and variant
    const query = {
      userId: req.user._id,
      productId: product._id,
      variantId: targetVariantId ? targetVariantId : null
    };

    const existing = await CartItem.findOne(query);
    const targetQuantity = existing ? existing.quantity + parsedQty : parsedQty;

    if (targetQuantity > availableStock) {
      const label = variantName ? `"${product.title} (${variantName})"` : `"${product.title}"`;
      return res.status(400).json({
        message: `Requested quantity exceeds available stock for ${label} (${availableStock} available)`
      });
    }

    if (existing) {
      existing.quantity = targetQuantity;
      existing.priceAtAdd = effectivePrice;
      if (variantName) existing.variantName = variantName;
      if (variantSku) existing.variantSku = variantSku;
      await existing.save();
      return res.json(existing);
    }

    const item = new CartItem({
      userId: req.user._id,
      productId: product._id,
      variantId: targetVariantId,
      variantName,
      variantSku,
      quantity: parsedQty,
      priceAtAdd: effectivePrice
    });
    await item.save();
    return res.status(201).json(item);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update quantity (by cartItemId or productId + variantId)
router.put('/update', authenticate, authorize('buyer'), async (req, res) => {
  try {
    const { cartItemId, productId, variantId, quantity } = req.body;
    const parsedQty = parseInt(quantity, 10);
    if (isNaN(parsedQty)) {
      return res.status(400).json({ message: 'Quantity must be a valid integer' });
    }

    if (cartItemId && !mongoose.Types.ObjectId.isValid(cartItemId)) {
      return res.status(400).json({ message: 'Invalid cart item ID format' });
    }
    if (productId && !mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: 'Invalid product ID format' });
    }

    let item;
    if (cartItemId && mongoose.Types.ObjectId.isValid(cartItemId)) {
      item = await CartItem.findOne({ _id: cartItemId, userId: req.user._id });
    } else if (productId) {
      const q = { userId: req.user._id, productId };
      if (variantId !== undefined) {
        q.variantId = variantId ? variantId : null;
      }
      item = await CartItem.findOne(q);
    }

    if (!item) {
      return res.status(404).json({ message: 'Cart item not found' });
    }

    if (parsedQty <= 0) {
      await CartItem.deleteOne({ _id: item._id });
      return res.json({ message: 'Item removed' });
    }

    const product = await Product.findById(item.productId);
    if (!product) {
      await CartItem.deleteOne({ _id: item._id });
      return res.status(404).json({ message: 'Product is no longer available' });
    }

    let availableStock = product.stock;
    let label = `"${product.title}"`;

    if (item.variantId) {
      const variant = (product.variants || []).find(v => v._id.toString() === item.variantId.toString());
      if (variant) {
        availableStock = variant.stock;
        label = `"${product.title} (${variant.name})"`;
      }
    }

    if (parsedQty > availableStock) {
      return res.status(400).json({
        message: `Requested quantity exceeds available stock for ${label} (${availableStock} available)`
      });
    }

    item.quantity = parsedQty;
    await item.save();
    return res.json(item);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Remove item (by cartItemId or productId)
router.delete('/remove/:id', authenticate, authorize('buyer'), async (req, res) => {
  try {
    const { id } = req.params;
    const { variantId } = req.query;

    if (mongoose.Types.ObjectId.isValid(id)) {
      // First try to delete by CartItem._id
      const deletedById = await CartItem.findOneAndDelete({ _id: id, userId: req.user._id });
      if (deletedById) {
        return res.json({ message: 'Item removed' });
      }

      // If not matching CartItem._id, try by productId
      const query = { userId: req.user._id, productId: id };
      if (variantId !== undefined) {
        query.variantId = variantId ? variantId : null;
      }
      await CartItem.deleteOne(query);
      return res.json({ message: 'Item removed' });
    }

    res.status(400).json({ message: 'Invalid identifier' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Clear cart
router.delete('/clear', authenticate, authorize('buyer'), async (req, res) => {
  try {
    await CartItem.deleteMany({ userId: req.user._id });
    res.json({ message: 'Cart cleared' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;



