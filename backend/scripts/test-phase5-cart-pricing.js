/**
 * Verification Test Suite: Phase 5 Shopping Cart and Pricing Calculations
 * 
 * Verifies all Phase 5 requirements:
 * 1. Adding products & variants to cart.
 * 2. Distinct line items for multiple variants of the same product.
 * 3. Quantity updates and removals.
 * 4. Quantity validation: rejection of zero, negative, and excessive quantities.
 * 5. Stock availability reporting: in_stock, low_stock, insufficient_stock, out_of_stock, unavailable.
 * 6. Protection against inactive or unavailable products/variants; canCheckout gating.
 * 7. Server-calculated pricing: unitPrice, itemSubtotal, subtotal, shipping, tax, total.
 * 8. Minor-unit integer arithmetic (paise) preventing floating-point rounding errors.
 * 9. Immune to client-side price manipulation: backend always re-reads database records.
 * 10. Strict alignment: order total strictly matches server-calculated cart total.
 * 11. Multi-vendor order isolation check.
 * 12. Cart persistence across sessions / page refreshes.
 * 
 * Database Safety: Strictly runs against dedicated test database (marketplace_test).
 * Zero credential or secret exposure.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const Product = require('../models/Product');
const Vendor = require('../models/Vendor');
const User = require('../models/User');
const Order = require('../models/Order');
const CartItem = require('../models/CartItem');
const cartRouter = require('../routes/cart');
const ordersRouter = require('../routes/orders');

const { buildOrderPayload } = ordersRouter;

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

const TEST_PREFIX = `TEST_P5_${Date.now()}_`;
let server;
let baseUrl;
let vendor1;
let vendor2;
let buyerUser;
let buyerToken;
let buyerHeaders;

let standardProduct;
let variantProduct;
let decimalProduct;
let limitedStockProduct;

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

async function runPhase5Tests() {
  console.log('\n============================================================');
  console.log(' PHASE 5: SHOPPING CART & PRICING CALCULATIONS VERIFICATION');
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
    vendor1 = await Vendor.create({
      userId: new mongoose.Types.ObjectId(),
      shopName: `${TEST_PREFIX}SuperMart`,
      categories: ['Groceries', 'Electronics'],
      onboardingComplete: true,
      approvalStatus: 'approved'
    });

    // Create Vendor 2
    vendor2 = await Vendor.create({
      userId: new mongoose.Types.ObjectId(),
      shopName: `${TEST_PREFIX}SecondMart`,
      categories: ['Books'],
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
    app.use('/api/cart', cartRouter);
    app.use('/api/orders', ordersRouter);

    server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const port = server.address().port;
    baseUrl = `http://localhost:${port}/api`;
    assert(Boolean(port), `Test server listening on port ${port}`);

    // Create test products
    standardProduct = await Product.create({
      vendorId: vendor1._id,
      title: `${TEST_PREFIX}Standard Wireless Mouse`,
      description: 'Reliable optical wireless mouse',
      imageUrl: 'https://example.com/mouse.jpg',
      price: 499.00,
      stock: 50,
      category: 'Electronics'
    });

    variantProduct = await Product.create({
      vendorId: vendor1._id,
      title: `${TEST_PREFIX}Custom Mechanical Keyboard`,
      description: 'RGB mechanical keyboard with switch choices',
      imageUrl: 'https://example.com/keyboard.jpg',
      price: 2499.00,
      stock: 25,
      category: 'Electronics',
      variants: [
        {
          sku: `SKU-${Date.now()}-RED`,
          name: 'Red Linear Switches',
          price: 2499.00,
          stock: 15,
          isActive: true
        },
        {
          sku: `SKU-${Date.now()}-BLUE`,
          name: 'Blue Clicky Switches',
          price: 2699.00,
          stock: 10,
          isActive: true
        },
        {
          sku: `SKU-${Date.now()}-BROWN`,
          name: 'Brown Tactile Switches (Inactive)',
          price: 2599.00,
          stock: 5,
          isActive: false
        }
      ]
    });

    decimalProduct = await Product.create({
      vendorId: vendor1._id,
      title: `${TEST_PREFIX}Precision Component`,
      description: 'Electronic chip with odd pricing for minor-unit precision check',
      imageUrl: 'https://example.com/chip.jpg',
      price: 19.99,
      stock: 100,
      category: 'Electronics'
    });

    limitedStockProduct = await Product.create({
      vendorId: vendor1._id,
      title: `${TEST_PREFIX}Limited Edition Badge`,
      description: 'Collectible badge with strictly 2 units',
      imageUrl: 'https://example.com/badge.jpg',
      price: 150.00,
      stock: 2,
      category: 'General'
    });

    // -------------------------------------------------------------
    // Test 1: Add Standard Product to Cart & Verify Enriched Fields
    // -------------------------------------------------------------
    console.log('\n--- Test 1: Add Standard Product to Cart ---');
    const addRes1 = await axios.post(
      `${baseUrl}/cart/add`,
      { productId: standardProduct._id, quantity: 2 },
      { headers: buyerHeaders }
    );
    assert(addRes1.status === 201 || addRes1.status === 200, 'Adding standard product returns 201/200');

    const getCartRes1 = await axios.get(`${baseUrl}/cart`, { headers: buyerHeaders });
    assert(Array.isArray(getCartRes1.data), 'GET /api/cart returns an array of cart items');
    assert(getCartRes1.data.length === 1, 'Cart has exactly 1 item');
    const item1 = getCartRes1.data[0];
    assert(item1.unitPrice === 499.00, 'item.unitPrice is 499.00 (from database)');
    assert(item1.quantity === 2, 'item.quantity is 2');
    assert(item1.itemSubtotal === 998.00, 'item.itemSubtotal is 998.00 (499.00 * 2)');
    assert(item1.stockStatus === 'in_stock', 'item.stockStatus is "in_stock"');
    assert(item1.inStock === true, 'item.inStock is true');
    assert(item1.isAvailable === true, 'item.isAvailable is true');

    // -------------------------------------------------------------
    // Test 2: Add Multiple Variants of the Same Product to Cart
    // -------------------------------------------------------------
    console.log('\n--- Test 2: Add Multiple Variants of Same Product ---');
    const variantRed = variantProduct.variants[0];
    const variantBlue = variantProduct.variants[1];

    const addVarRes1 = await axios.post(
      `${baseUrl}/cart/add`,
      { productId: variantProduct._id, variantId: variantRed._id, quantity: 1 },
      { headers: buyerHeaders }
    );
    assert(addVarRes1.status === 201 || addVarRes1.status === 200, 'Added Variant Red to cart');

    const addVarRes2 = await axios.post(
      `${baseUrl}/cart/add`,
      { productId: variantProduct._id, variantId: variantBlue._id, quantity: 2 },
      { headers: buyerHeaders }
    );
    assert(addVarRes2.status === 201 || addVarRes2.status === 200, 'Added Variant Blue to cart');

    const getCartRes2 = await axios.get(`${baseUrl}/cart`, { headers: buyerHeaders });
    assert(getCartRes2.data.length === 3, 'Cart now contains 3 distinct items');

    const redItem = getCartRes2.data.find(i => i.variantId && i.variantId.toString() === variantRed._id.toString());
    assert(Boolean(redItem), 'Variant Red item found in cart');
    assert(redItem.unitPrice === 2499.00, 'Variant Red unitPrice is 2499.00');
    assert(redItem.quantity === 1, 'Variant Red quantity is 1');
    assert(redItem.itemSubtotal === 2499.00, 'Variant Red itemSubtotal is 2499.00');
    assert(redItem.variantName === 'Red Linear Switches', 'Variant Red variantName matches');

    const blueItem = getCartRes2.data.find(i => i.variantId && i.variantId.toString() === variantBlue._id.toString());
    assert(Boolean(blueItem), 'Variant Blue item found in cart');
    assert(blueItem.unitPrice === 2699.00, 'Variant Blue unitPrice is 2699.00');
    assert(blueItem.quantity === 2, 'Variant Blue quantity is 2');
    assert(blueItem.itemSubtotal === 5398.00, 'Variant Blue itemSubtotal is 5398.00 (2699 * 2)');
    assert(blueItem.variantName === 'Blue Clicky Switches', 'Variant Blue variantName matches');

    // -------------------------------------------------------------
    // Test 3: Rejection of Inactive Variant
    // -------------------------------------------------------------
    console.log('\n--- Test 3: Inactive Variant Gating ---');
    const variantInactive = variantProduct.variants[2];
    try {
      await axios.post(
        `${baseUrl}/cart/add`,
        { productId: variantProduct._id, variantId: variantInactive._id, quantity: 1 },
        { headers: buyerHeaders }
      );
      assert(false, 'Should have rejected inactive variant');
    } catch (err) {
      assert(err.response?.status === 400, 'Rejects inactive variant with HTTP 400');
      assert(err.response?.data?.message?.includes('inactive'), 'Error message indicates variant is inactive');
    }

    // -------------------------------------------------------------
    // Test 4: Quantity Validation (Zero, Negative, Excessive)
    // -------------------------------------------------------------
    console.log('\n--- Test 4: Quantity Boundary & Validation Checks ---');
    // Zero quantity on add
    try {
      await axios.post(
        `${baseUrl}/cart/add`,
        { productId: standardProduct._id, quantity: 0 },
        { headers: buyerHeaders }
      );
      assert(false, 'Should reject quantity 0 on add');
    } catch (err) {
      assert(err.response?.status === 400, 'Rejects quantity 0 on add with HTTP 400');
    }

    // Negative quantity on add
    try {
      await axios.post(
        `${baseUrl}/cart/add`,
        { productId: standardProduct._id, quantity: -5 },
        { headers: buyerHeaders }
      );
      assert(false, 'Should reject negative quantity on add');
    } catch (err) {
      assert(err.response?.status === 400, 'Rejects negative quantity with HTTP 400');
    }

    // Excessive quantity exceeding stock
    try {
      await axios.post(
        `${baseUrl}/cart/add`,
        { productId: limitedStockProduct._id, quantity: 10 }, // stock is 2
        { headers: buyerHeaders }
      );
      assert(false, 'Should reject quantity exceeding available stock');
    } catch (err) {
      assert(err.response?.status === 400, 'Rejects excessive quantity with HTTP 400');
      assert(err.response?.data?.message?.includes('exceeds available stock'), 'Error states quantity exceeds stock');
    }

    // -------------------------------------------------------------
    // Test 5: Stock Status Identification
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Stock Status Reporting ---');
    // Add 1 unit of limited stock product (stock is 2 -> status should be low_stock)
    await axios.post(
      `${baseUrl}/cart/add`,
      { productId: limitedStockProduct._id, quantity: 1 },
      { headers: buyerHeaders }
    );
    const getCartRes3 = await axios.get(`${baseUrl}/cart`, { headers: buyerHeaders });
    const limitedItem = getCartRes3.data.find(i => i.productId.toString() === limitedStockProduct._id.toString());
    assert(Boolean(limitedItem), 'Limited stock item found in cart');
    assert(limitedItem.stockStatus === 'low_stock', 'Reports stockStatus === "low_stock" for stock <= 3');
    assert(limitedItem.availableStock === 2, 'Reports accurate availableStock: 2');

    // -------------------------------------------------------------
    // Test 6: Update Quantity & Remove Items
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Update Quantity & Remove ---');
    // Update red keyboard quantity to 3
    const updateRes = await axios.put(
      `${baseUrl}/cart/update`,
      { cartItemId: redItem._id, quantity: 3 },
      { headers: buyerHeaders }
    );
    assert(updateRes.status === 200, 'PUT /api/cart/update succeeds');

    const getCartRes4 = await axios.get(`${baseUrl}/cart`, { headers: buyerHeaders });
    const updatedRed = getCartRes4.data.find(i => i._id.toString() === redItem._id.toString());
    assert(updatedRed.quantity === 3, 'Quantity updated to 3');
    assert(updatedRed.itemSubtotal === 7497.00, 'Subtotal correctly updated to 7497.00 (2499 * 3)');

    // Attempt to update beyond stock limit (variantRed stock is 15)
    try {
      await axios.put(
        `${baseUrl}/cart/update`,
        { cartItemId: redItem._id, quantity: 20 },
        { headers: buyerHeaders }
      );
      assert(false, 'Should reject updating beyond available stock');
    } catch (err) {
      assert(err.response?.status === 400, 'Rejects update beyond available stock with HTTP 400');
    }

    // Remove item by cartItemId
    const deleteRes1 = await axios.delete(`${baseUrl}/cart/remove/${limitedItem._id}`, { headers: buyerHeaders });
    assert(deleteRes1.status === 200, 'DELETE /api/cart/remove/:id removes item by cartItemId');

    // Remove item by productId and variantId
    const deleteRes2 = await axios.delete(
      `${baseUrl}/cart/remove/${variantProduct._id}?variantId=${variantBlue._id}`,
      { headers: buyerHeaders }
    );
    assert(deleteRes2.status === 200, 'DELETE /api/cart/remove/:productId?variantId removes item by variantId');

    // -------------------------------------------------------------
    // Test 7: Clear Cart & Precision Arithmetic Check
    // -------------------------------------------------------------
    console.log('\n--- Test 7: Clear Cart & Minor-Unit (Paise) Arithmetic ---');
    await axios.delete(`${baseUrl}/cart/clear`, { headers: buyerHeaders });
    const emptyCheck = await axios.get(`${baseUrl}/cart`, { headers: buyerHeaders });
    assert(emptyCheck.data.length === 0, 'Cart cleared completely');

    // Add 3 units of decimalProduct (₹19.99 * 3 = ₹59.97)
    await axios.post(
      `${baseUrl}/cart/add`,
      { productId: decimalProduct._id, quantity: 3 },
      { headers: buyerHeaders }
    );

    // Add 2 units of standardProduct (₹499.00 * 2 = ₹998.00)
    await axios.post(
      `${baseUrl}/cart/add`,
      { productId: standardProduct._id, quantity: 2 },
      { headers: buyerHeaders }
    );

    // Total should be exactly 59.97 + 998.00 = 1057.97
    const summaryRes = await axios.get(`${baseUrl}/cart/summary`, { headers: buyerHeaders });
    assert(summaryRes.status === 200, 'GET /api/cart/summary returns 200');
    const summaryData = summaryRes.data;

    assert(summaryData.subtotal === 1057.97, `Subtotal is exactly 1057.97 (received: ${summaryData.subtotal})`);
    assert(summaryData.shipping === 0.00, 'Standard shipping is 0.00 (Free)');
    assert(summaryData.tax === 0.00, 'Tax is 0.00 (Included in base price)');
    assert(summaryData.discount === 0.00, 'Discount is 0.00');
    assert(summaryData.total === 1057.97, `Total payable is exactly 1057.97 (received: ${summaryData.total})`);
    assert(summaryData.canCheckout === true, 'canCheckout is true when all items are valid');

    // -------------------------------------------------------------
    // Test 8: Price Manipulation Immunity & Server Calculation
    // -------------------------------------------------------------
    console.log('\n--- Test 8: Price Tampering Immunity ---');
    // An attacker attempts to submit an order with a manipulated price (e.g. ₹0.01 instead of ₹499)
    const attackerOrderItems = [
      {
        productId: standardProduct._id.toString(),
        quantity: 2,
        price: 0.01 // Manipulated price
      },
      {
        productId: decimalProduct._id.toString(),
        quantity: 3,
        price: 1.00 // Manipulated price
      }
    ];

    const orderPayload = await buildOrderPayload(attackerOrderItems);
    assert(orderPayload.totalAmount === 1057.97, `Backend recalculated total from DB: expected 1057.97, got ${orderPayload.totalAmount}`);
    assert(orderPayload.orderProducts[0].price === 499.00, 'Order item 1 price recalculated to DB price 499.00');
    assert(orderPayload.orderProducts[1].price === 19.99, 'Order item 2 price recalculated to DB price 19.99');

    // Commission & Earning check with integer precision
    const totalPaise = Math.round(orderPayload.totalAmount * 100);
    const adminCommissionPaise = Math.round(orderPayload.adminCommission * 100);
    const vendorEarningPaise = Math.round(orderPayload.vendorEarning * 100);
    assert(
      adminCommissionPaise + vendorEarningPaise === totalPaise,
      `Exact split: Admin (${adminCommissionPaise}) + Vendor (${vendorEarningPaise}) === Total (${totalPaise}) in paise`
    );

    // -------------------------------------------------------------
    // Test 9: Multi-Vendor Order Creation Isolation
    // -------------------------------------------------------------
    console.log('\n--- Test 9: Multi-Vendor Isolation Check ---');
    const vendor2Product = await Product.create({
      vendorId: vendor2._id,
      title: `${TEST_PREFIX}Vendor 2 Unique Book`,
      description: 'Book from second vendor',
      imageUrl: 'https://example.com/book.jpg',
      price: 299.00,
      stock: 10,
      category: 'Books'
    });

    const multiVendorItems = [
      { productId: standardProduct._id.toString(), quantity: 1 },
      { productId: vendor2Product._id.toString(), quantity: 1 }
    ];

    try {
      await buildOrderPayload(multiVendorItems);
      assert(false, 'Should reject multi-vendor order payload');
    } catch (err) {
      assert(err.message.includes('All products must be from the same vendor'), 'Rejects items from different vendors');
    }

    // -------------------------------------------------------------
    // Test 10: Unavailable / Depleted Product Checkout Gating
    // -------------------------------------------------------------
    console.log('\n--- Test 10: Inactive / Depleted Product Checkout Gating ---');
    // Deplete standardProduct stock to 0
    await Product.updateOne({ _id: standardProduct._id }, { $set: { stock: 0 } });

    const summaryResDepleted = await axios.get(`${baseUrl}/cart/summary`, { headers: buyerHeaders });
    assert(summaryResDepleted.data.canCheckout === false, 'canCheckout is false when a product is depleted to 0 stock');
    const depletedCartItem = summaryResDepleted.data.items.find(i => i.productId.toString() === standardProduct._id.toString());
    assert(depletedCartItem.stockStatus === 'out_of_stock', 'Reports stockStatus === "out_of_stock"');
    assert(depletedCartItem.inStock === false, 'Reports inStock === false');

    // Restore stock for clean state
    await Product.updateOne({ _id: standardProduct._id }, { $set: { stock: 50 } });

    // -------------------------------------------------------------
    // Test 11: Cart Persistence
    // -------------------------------------------------------------
    console.log('\n--- Test 11: Cart Persistence in Database ---');
    const dbCartItems = await CartItem.find({ userId: buyerUser._id });
    assert(dbCartItems.length === 2, `Cart items persisted in MongoDB (count: ${dbCartItems.length})`);
    assert(dbCartItems[0].userId.toString() === buyerUser._id.toString(), 'Cart item userId matches buyer');

    // Final Cleanup
    await cleanupTestData();

    console.log('\n============================================================');
    console.log(` SUMMARY: ${passedTests} passed, ${failedTests} failed.`);
    console.log('============================================================\n');

    if (failedTests > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (error) {
    console.error('Test execution error:', error);
    process.exit(1);
  } finally {
    if (server) {
      server.close();
    }
    await mongoose.disconnect();
  }
}

runPhase5Tests();
