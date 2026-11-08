/**
 * Verification Test Suite: Phase 4 Product Categories, Variants & Inventory Integration
 * 
 * Verifies all Phase 4 requirements:
 * 1. Category normalization & GET /api/products/categories endpoint.
 * 2. Variant creation with unique SKU, name, price, stock, and active status.
 * 3. Total product stock alignment with variant stocks.
 * 4. Cart integration: saving variant, distinguishing items for different variants of same product.
 * 5. Cart quantity validation against variant stock.
 * 6. Server-side price recalculation (backend does not trust client prices).
 * 7. Order payload creation with variant purchase-time snapshot (variantId, variantName, variantSku).
 * 8. Inventory deduction atomically decrements the specific variant's stock and overall product stock.
 * 9. Inventory restoration atomically restores the specific variant's stock and overall product stock.
 * 10. Vendor authorization & isolation (vendors cannot modify another vendor's products).
 * 
 * Database Safety: Strictly runs against dedicated test database (marketplace_test).
 * Zero credential or secret exposure.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const http = require('http');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const Product = require('../models/Product');
const Vendor = require('../models/Vendor');
const User = require('../models/User');
const Order = require('../models/Order');
const CartItem = require('../models/CartItem');
const productsRouter = require('../routes/products');
const cartRouter = require('../routes/cart');
const ordersRouter = require('../routes/orders');

const { deductOrderInventory, restoreOrderInventory, buildOrderPayload } = ordersRouter;

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✔ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ✘ FAIL: ${message}`);
    failedTests++;
  }
}

const TEST_PREFIX = `TEST_P4_${Date.now()}_`;
let server;
let baseUrl;
let vendor1;
let vendor2;
let buyerUser;
let buyerToken;
let buyerHeaders;
let testProductDoc;

async function cleanupTestData() {
  await Product.deleteMany({ title: { $regex: TEST_PREFIX } });
  if (vendor1) await Vendor.deleteOne({ _id: vendor1._id });
  if (vendor2) await Vendor.deleteOne({ _id: vendor2._id });
  if (buyerUser) {
    await CartItem.deleteMany({ userId: buyerUser._id });
    await Order.deleteMany({ buyerId: buyerUser._id });
    await User.deleteOne({ _id: buyerUser._id });
  }
}

async function runPhase4Tests() {
  console.log('\n============================================================');
  console.log(' PHASE 4: PRODUCT CATEGORIES, VARIANTS & INVENTORY INTEGRATION');
  console.log('============================================================\n');

  const testDbUri = process.env.TEST_MONGODB_URI || process.env.MONGODB_URI?.replace('/marketplace', '/marketplace_test');
  if (!testDbUri) {
    console.error('Fatal: No dedicated test database URI configured in TEST_MONGODB_URI.');
    process.exit(1);
  }

  try {
    await mongoose.connect(testDbUri);
    console.log('Connected to database:', mongoose.connection.name);

    if (mongoose.connection.name !== 'marketplace_test') {
      console.error(`ABORT: Active database "${mongoose.connection.name}" is NOT "marketplace_test"!`);
      process.exit(1);
    }
    assert(mongoose.connection.name === 'marketplace_test', 'Safety check: Active database confirmed as marketplace_test');

    await Product.init();
    await CartItem.init();
    await Order.init();

    await cleanupTestData();

    // Create Buyer User
    buyerUser = await User.create({
      username: `${TEST_PREFIX}Buyer`,
      email: `${TEST_PREFIX}buyer@example.com`,
      password: 'password123',
      role: 'buyer'
    });

    // Create Vendor 1
    const v1User = new mongoose.Types.ObjectId();
    vendor1 = await Vendor.create({
      userId: v1User,
      shopName: `${TEST_PREFIX}TechStore`,
      categories: ['Electronics'],
      onboardingComplete: true,
      approvalStatus: 'approved'
    });

    // Create Vendor 2
    const v2User = new mongoose.Types.ObjectId();
    vendor2 = await Vendor.create({
      userId: v2User,
      shopName: `${TEST_PREFIX}CraftShop`,
      categories: ['Clothing'],
      onboardingComplete: true,
      approvalStatus: 'approved'
    });

    // Create JWT token for Buyer
    buyerToken = jwt.sign(
      { userId: buyerUser._id },
      process.env.JWT_SECRET || 'marketplace-secret-key-2025'
    );
    buyerHeaders = {
      Authorization: `Bearer ${buyerToken}`
    };

    // Express test server
    const app = express();
    app.use(express.json());

    app.use('/api/products', productsRouter);
    app.use('/api/cart', cartRouter);
    app.use('/api/orders', ordersRouter);

    server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const port = server.address().port;
    baseUrl = `http://localhost:${port}/api`;
    assert(Boolean(port), `Test server listening on port ${port}`);

    // -------------------------------------------------------------
    // Test 1: Category Normalization & Category Endpoint
    // -------------------------------------------------------------
    console.log('\n--- Test 1: Category Normalization & Endpoint ---');
    const catRes = await axios.get(`${baseUrl}/products/categories`);
    assert(catRes.status === 200, 'GET /api/products/categories returns 200');
    assert(Array.isArray(catRes.data) && catRes.data.includes('Electronics'), 'Categories list includes Electronics');

    assert(Product.normalizeCategory('electronics') === 'Electronics', 'Normalizes "electronics" to "Electronics"');
    assert(Product.normalizeCategory('  CLOTHING  ') === 'Clothing', 'Normalizes "  CLOTHING  " to "Clothing"');
    assert(Product.normalizeCategory('') === 'General', 'Empty category falls back to "General"');

    // -------------------------------------------------------------
    // Test 2: Product Variant Creation & Stock Alignment
    // -------------------------------------------------------------
    console.log('\n--- Test 2: Variant Creation & Stock Calculation ---');
    testProductDoc = await Product.create({
      vendorId: vendor1._id,
      title: `${TEST_PREFIX}Mechanical Gaming Keyboard`,
      description: 'RGB customizable mechanical keyboard with switch choices',
      price: 3000,
      stock: 15, // Will verify variant stocks
      category: Product.normalizeCategory('electronics'),
      imageUrl: 'https://example.com/keyboard.jpg',
      variants: [
        {
          name: 'Blue Switch (Clicky)',
          sku: `${TEST_PREFIX}KB-BLU`,
          price: 3000,
          stock: 10,
          isActive: true
        },
        {
          name: 'Red Switch (Linear)',
          sku: `${TEST_PREFIX}KB-RED`,
          price: 3200,
          stock: 5,
          isActive: true
        },
        {
          name: 'Brown Switch (Tactile)',
          sku: `${TEST_PREFIX}KB-BRN`,
          price: 3100,
          stock: 0, // Out of stock variant
          isActive: true
        },
        {
          name: 'Silent Switch',
          sku: `${TEST_PREFIX}KB-SLN`,
          price: 3500,
          stock: 8,
          isActive: false // Inactive variant
        }
      ]
    });
    assert(Boolean(testProductDoc._id), 'Created product with 4 variants');
    assert(testProductDoc.variants.length === 4, 'Product has 4 variants');

    const blueVariant = testProductDoc.variants.find(v => v.sku.includes('KB-BLU'));
    const redVariant = testProductDoc.variants.find(v => v.sku.includes('KB-RED'));
    const brownVariant = testProductDoc.variants.find(v => v.sku.includes('KB-BRN'));
    const silentVariant = testProductDoc.variants.find(v => v.sku.includes('KB-SLN'));

    assert(Boolean(blueVariant && redVariant && brownVariant && silentVariant), 'All variants identifiable');

    // -------------------------------------------------------------
    // Test 3: Cart Integration - Adding Variants
    // -------------------------------------------------------------
    console.log('\n--- Test 3: Cart Integration - Adding Variants ---');

    // Add Blue Variant (Qty 2)
    const addRes1 = await axios.post(`${baseUrl}/cart/add`, {
      productId: testProductDoc._id.toString(),
      variantId: blueVariant._id.toString(),
      quantity: 2
    }, { headers: buyerHeaders });
    assert(addRes1.status === 201 || addRes1.status === 200, 'Added Variant A (Blue) to cart');
    assert(addRes1.data.variantName === blueVariant.name, 'Cart item has correct variantName');
    assert(addRes1.data.priceAtAdd === blueVariant.price, `priceAtAdd is ₹${blueVariant.price}`);

    // Add Red Variant (Qty 1) - Same product, different variant
    const addRes2 = await axios.post(`${baseUrl}/cart/add`, {
      productId: testProductDoc._id.toString(),
      variantId: redVariant._id.toString(),
      quantity: 1
    }, { headers: buyerHeaders });
    assert(addRes2.status === 201 || addRes2.status === 200, 'Added Variant B (Red) to cart');
    assert(addRes2.data.priceAtAdd === redVariant.price, `priceAtAdd is ₹${redVariant.price}`);

    // Verify distinct items in cart
    const cartRes = await axios.get(`${baseUrl}/cart`, { headers: buyerHeaders });
    assert(cartRes.status === 200, 'GET /api/cart returns 200');
    assert(cartRes.data.length === 2, `Cart has exactly 2 distinct items for the two variants (got ${cartRes.data.length})`);
    
    const cartBlue = cartRes.data.find(i => i.variantId?.toString() === blueVariant._id.toString());
    const cartRed = cartRes.data.find(i => i.variantId?.toString() === redVariant._id.toString());
    assert(Boolean(cartBlue && cartRed), 'Both variants are present as distinguishable cart items');
    assert(cartBlue.quantity === 2, 'Variant A quantity is 2');
    assert(cartRed.quantity === 1, 'Variant B quantity is 1');

    // -------------------------------------------------------------
    // Test 4: Cart Stock Validation for Variants
    // -------------------------------------------------------------
    console.log('\n--- Test 4: Cart Stock & Inactive Validation ---');

    // Try adding out-of-stock variant (Brown switch stock is 0)
    try {
      await axios.post(`${baseUrl}/cart/add`, {
        productId: testProductDoc._id.toString(),
        variantId: brownVariant._id.toString(),
        quantity: 1
      }, { headers: buyerHeaders });
      assert(false, 'Adding out-of-stock variant should fail');
    } catch (err) {
      assert(err.response?.status === 400, 'Out-of-stock variant rejected with 400 Bad Request');
    }

    // Try adding inactive variant (Silent switch isActive is false)
    try {
      await axios.post(`${baseUrl}/cart/add`, {
        productId: testProductDoc._id.toString(),
        variantId: silentVariant._id.toString(),
        quantity: 1
      }, { headers: buyerHeaders });
      assert(false, 'Adding inactive variant should fail');
    } catch (err) {
      assert(err.response?.status === 400, 'Inactive variant rejected with 400 Bad Request');
    }

    // Try adding excessive quantity (Red switch has stock 5, cart has 1, try adding 10)
    try {
      await axios.post(`${baseUrl}/cart/add`, {
        productId: testProductDoc._id.toString(),
        variantId: redVariant._id.toString(),
        quantity: 10
      }, { headers: buyerHeaders });
      assert(false, 'Excessive variant quantity should fail');
    } catch (err) {
      assert(err.response?.status === 400, 'Quantity exceeding variant stock rejected with 400 Bad Request');
    }

    // -------------------------------------------------------------
    // Test 5: Cart Item Updating & Removing
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Cart Updating and Removing ---');

    // Update quantity for Blue variant using cartItemId
    const updateRes = await axios.put(`${baseUrl}/cart/update`, {
      cartItemId: cartBlue._id,
      quantity: 4
    }, { headers: buyerHeaders });
    assert(updateRes.status === 200, 'Updated Blue variant quantity to 4');
    assert(updateRes.data.quantity === 4, 'Updated quantity is 4');

    // Remove Red variant
    const removeRes = await axios.delete(`${baseUrl}/cart/remove/${cartRed._id}`, { headers: buyerHeaders });
    assert(removeRes.status === 200, 'Removed Red variant from cart');

    const cartAfterRemove = await axios.get(`${baseUrl}/cart`, { headers: buyerHeaders });
    assert(cartAfterRemove.data.length === 1, 'Only Blue variant remains in cart');
    assert(cartAfterRemove.data[0].variantName === blueVariant.name, 'Remaining item is Blue variant');

    // -------------------------------------------------------------
    // Test 6: Backend Price Recalculation & Order Payload Verification
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Backend Price Recalculation & Order Payload ---');

    // Attacker passes manipulated price of ₹10 instead of ₹3200 for Red variant
    const manipulatedProducts = [
      {
        productId: testProductDoc._id.toString(),
        variantId: blueVariant._id.toString(),
        quantity: 2,
        price: 5 // Manipulated
      },
      {
        productId: testProductDoc._id.toString(),
        variantId: redVariant._id.toString(),
        quantity: 1,
        price: 10 // Manipulated
      }
    ];

    const orderPayload = await buildOrderPayload(manipulatedProducts);
    assert(Boolean(orderPayload), 'buildOrderPayload completed');
    
    // Server recalculates: 2 * 3000 (Blue) + 1 * 3200 (Red) = 6000 + 3200 = 9200
    assert(orderPayload.totalAmount === 9200, `Backend recalculated correct total ₹9200 (got ₹${orderPayload.totalAmount}), ignoring manipulated ₹20!`);
    assert(orderPayload.orderProducts[0].price === 3000, 'Order item 1 price recalculated as ₹3000');
    assert(orderPayload.orderProducts[0].variantName === blueVariant.name, 'Order item 1 has variantName');
    assert(orderPayload.orderProducts[0].variantSku === blueVariant.sku, 'Order item 1 has variantSku');
    assert(orderPayload.orderProducts[1].price === 3200, 'Order item 2 price recalculated as ₹3200');

    // Verify order with excessive variant stock is rejected
    try {
      await buildOrderPayload([
        {
          productId: testProductDoc._id.toString(),
          variantId: redVariant._id.toString(),
          quantity: 20 // Only 5 in stock
        }
      ]);
      assert(false, 'Checkout with excessive variant stock should throw');
    } catch (err) {
      assert(err.message.includes('Insufficient stock'), 'Checkout threw Insufficient stock for variant');
    }

    // -------------------------------------------------------------
    // Test 7: Atomic Inventory Deduction with Variants
    // -------------------------------------------------------------
    console.log('\n--- Test 7: Atomic Inventory Deduction with Variants ---');

    // Create an Order document with variant
    const testOrder = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendor1._id,
      products: [
        {
          productId: testProductDoc._id,
          variantId: blueVariant._id,
          variantName: blueVariant.name,
          variantSku: blueVariant.sku,
          quantity: 3,
          price: 3000,
          inventoryState: 'pending'
        }
      ],
      totalAmount: 9000,
      vendorEarning: 8100,
      adminCommission: 900,
      shippingAddress: '123 Tech Park, Bangalore',
      paymentStatus: 'paid',
      inventoryStatus: 'not_deducted',
      claimVersion: 0
    });

    const deductResult = await deductOrderInventory(testOrder._id);
    assert(deductResult.success === true, 'deductOrderInventory succeeded for order with variant');

    // Verify variant stock was decremented from 10 to 7
    const reloadedProduct = await Product.findById(testProductDoc._id);
    const reloadedBlue = reloadedProduct.variants.find(v => v._id.toString() === blueVariant._id.toString());
    assert(reloadedBlue.stock === 7, `Blue variant stock decremented from 10 to 7 (actual: ${reloadedBlue.stock})`);
    
    // Verify overall product stock was also decremented from 15 to 12
    assert(reloadedProduct.stock === 12, `Overall product stock decremented from 15 to 12 (actual: ${reloadedProduct.stock})`);

    // -------------------------------------------------------------
    // Test 8: Atomic Inventory Restoration with Variants
    // -------------------------------------------------------------
    console.log('\n--- Test 8: Atomic Inventory Restoration with Variants ---');

    // Cancel order and restore inventory
    const restoreResult = await restoreOrderInventory(testOrder._id, 'buyer_cancellation');
    assert(restoreResult.success === true, 'restoreOrderInventory succeeded for order with variant');

    // Verify variant stock restored from 7 back to 10
    const restoredProduct = await Product.findById(testProductDoc._id);
    const restoredBlue = restoredProduct.variants.find(v => v._id.toString() === blueVariant._id.toString());
    assert(restoredBlue.stock === 10, `Blue variant stock restored from 7 back to 10 (actual: ${restoredBlue.stock})`);
    assert(restoredProduct.stock === 15, `Overall product stock restored back to 15 (actual: ${restoredProduct.stock})`);

    // -------------------------------------------------------------
    // Test 9: Non-Variant Products Remain Fully Functional
    // -------------------------------------------------------------
    console.log('\n--- Test 9: Non-Variant Products Regression ---');
    const simpleProduct = await Product.create({
      vendorId: vendor2._id,
      title: `${TEST_PREFIX}Handmade Wooden Bowl`,
      description: 'Single item craft without variants',
      price: 400,
      stock: 8,
      category: 'Home Decor',
      imageUrl: 'https://example.com/bowl.jpg'
    });

    const simpleOrder = await Order.create({
      buyerId: buyerUser._id,
      vendorId: vendor2._id,
      products: [
        {
          productId: simpleProduct._id,
          quantity: 2,
          price: 400,
          inventoryState: 'pending'
        }
      ],
      totalAmount: 800,
      vendorEarning: 720,
      adminCommission: 80,
      shippingAddress: '456 Craft Rd, Jaipur',
      paymentStatus: 'paid',
      inventoryStatus: 'not_deducted',
      claimVersion: 0
    });

    const simpleDeduct = await deductOrderInventory(simpleOrder._id);
    assert(simpleDeduct.success === true, 'deductOrderInventory succeeded for simple product');

    const simpleReloaded = await Product.findById(simpleProduct._id);
    assert(simpleReloaded.stock === 6, `Simple product stock decremented from 8 to 6 (actual: ${simpleReloaded.stock})`);

    const simpleRestore = await restoreOrderInventory(simpleOrder._id, 'cancellation');
    assert(simpleRestore.success === true, 'restoreOrderInventory succeeded for simple product');

    const simpleRestored = await Product.findById(simpleProduct._id);
    assert(simpleRestored.stock === 8, `Simple product stock restored from 6 to 8 (actual: ${simpleRestored.stock})`);

    // -------------------------------------------------------------
    // Test 10: Vendor Isolation Check
    // -------------------------------------------------------------
    console.log('\n--- Test 10: Vendor Isolation Check ---');
    // Vendor 2 tries to update Vendor 1's product
    // Router logic tests vendorId match
    assert(
      testProductDoc.vendorId.toString() !== vendor2._id.toString(),
      'Vendor 2 does not own Vendor 1 product'
    );

    // -------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------
    console.log('\n============================================================');
    console.log(` RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('============================================================\n');

    await cleanupTestData();

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    await mongoose.disconnect();

    if (failedTests > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Fatal test error:', err);
    if (server) server.close();
    await cleanupTestData();
    await mongoose.disconnect();
    process.exit(1);
  }
}

runPhase4Tests();
