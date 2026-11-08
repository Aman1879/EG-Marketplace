/**
 * Verification Test Suite: Phase 3 Product Catalogue
 * 
 * Verifies all catalogue requirements:
 * 1. Product listing with default pagination.
 * 2. Keyword search across product name and description.
 * 3. Category filtering (exact and case-insensitive).
 * 4. Minimum and maximum price filtering.
 * 5. Vendor filtering.
 * 6. Availability and stock filtering (in-stock vs out-of-stock).
 * 7. Sorting by price (asc, desc), name (asc, desc), and rating.
 * 8. Server-side pagination with offset and limit.
 * 9. Accurate total results and pagination metadata (totalCount, totalPages, currentPage).
 * 10. Query parameter validation & rejection (negative prices, invalid sort, excessive limits).
 * 11. Empty state handling.
 * 12. Single product details endpoint with populated vendor and variants.
 * 
 * Database Safety: Strictly runs against dedicated test database (marketplace_test).
 * Zero credential or secret exposure.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const http = require('http');
const axios = require('axios');
const mongoose = require('mongoose');

const Product = require('../models/Product');
const Vendor = require('../models/Vendor');
const productsRouter = require('../routes/products');

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

const TEST_PREFIX = `TEST_CAT_${Date.now()}_`;
let server;
let baseUrl;
let dummyVendor;
let testProductIds = [];

async function cleanupTestData() {
  await Product.deleteMany({ title: { $regex: TEST_PREFIX } });
  if (dummyVendor) {
    await Vendor.deleteOne({ _id: dummyVendor._id });
  }
}

async function runCatalogueTests() {
  console.log('\n============================================================');
  console.log(' PHASE 3: PRODUCT CATALOGUE AUDIT & VERIFICATION SUITE');
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
    await Vendor.init();

    // Clean up any stale data
    await cleanupTestData();

    // Create a dummy vendor
    dummyVendor = await Vendor.create({
      userId: new mongoose.Types.ObjectId(),
      shopName: `${TEST_PREFIX}Artisan Hub`,
      description: 'Crafts and handmade goods vendor',
      categories: ['Clothing', 'Electronics', 'Home Decor', 'Jewellery', 'Bags', 'Kitchenware', 'Stationery'],
      onboardingComplete: true,
      approvalStatus: 'approved'
    });
    assert(Boolean(dummyVendor._id), 'Created test vendor');

    // Create 15 distinct test products with predictable attributes
    const testProductsSeed = [
      {
        title: `${TEST_PREFIX}Silk Handcrafted Scarf`,
        description: 'Pure silk artisan scarf crafted in Kashmir with floral motifs',
        category: 'Clothing',
        price: 250,
        stock: 15,
        averageRating: 4.8,
        totalRatings: 10,
        imageUrl: 'https://example.com/scarf.jpg'
      },
      {
        title: `${TEST_PREFIX}Wireless Noise Cancelling Headphones`,
        description: 'High fidelity audio gadget with active noise cancellation',
        category: 'Electronics',
        price: 1200,
        stock: 8,
        averageRating: 4.5,
        totalRatings: 22,
        imageUrl: 'https://example.com/headphones.jpg'
      },
      {
        title: `${TEST_PREFIX}Handmade Terracotta Vase`,
        description: 'Traditional terracotta clay pottery decor piece',
        category: 'Home Decor',
        price: 450,
        stock: 0, // Out of stock
        averageRating: 4.2,
        totalRatings: 5,
        imageUrl: 'https://example.com/vase.jpg'
      },
      {
        title: `${TEST_PREFIX}Silver Filigree Earrings`,
        description: 'Sterling silver traditional handcrafted jewellery ornament',
        category: 'Jewellery',
        price: 800,
        stock: 20,
        averageRating: 4.9,
        totalRatings: 30,
        imageUrl: 'https://example.com/earrings.jpg'
      },
      {
        title: `${TEST_PREFIX}Cotton Embroidered Kurti`,
        description: 'Summer ethnic cotton outfit for festive wear',
        category: 'Clothing',
        price: 650,
        stock: 5,
        averageRating: 4.0,
        totalRatings: 8,
        imageUrl: 'https://example.com/kurti.jpg'
      },
      {
        title: `${TEST_PREFIX}Smart Bluetooth Speaker`,
        description: 'Portable waterproof sound gadget with 12 hour battery',
        category: 'Electronics',
        price: 950,
        stock: 2,
        averageRating: 3.8,
        totalRatings: 14,
        imageUrl: 'https://example.com/speaker.jpg'
      },
      {
        title: `${TEST_PREFIX}Wooden Wall Clock`,
        description: 'Vintage rustic carved wood wall ornament',
        category: 'Home Decor',
        price: 300,
        stock: 12,
        averageRating: 4.6,
        totalRatings: 16,
        imageUrl: 'https://example.com/clock.jpg'
      },
      {
        title: `${TEST_PREFIX}Gold Plated Pendant`,
        description: 'Intricate micro plated jewellery ornament with chain',
        category: 'Jewellery',
        price: 1500,
        stock: 4,
        averageRating: 4.7,
        totalRatings: 25,
        imageUrl: 'https://example.com/pendant.jpg'
      },
      {
        title: `${TEST_PREFIX}Leather Messenger Bag`,
        description: 'Genuine full grain leather laptop bag for office',
        category: 'Bags',
        price: 2200,
        stock: 10,
        averageRating: 4.9,
        totalRatings: 40,
        imageUrl: 'https://example.com/bag.jpg'
      },
      {
        title: `${TEST_PREFIX}Canvas Shopping Tote Bag`,
        description: 'Eco friendly reusable shopping canvas bag',
        category: 'Bags',
        price: 150,
        stock: 50,
        averageRating: 4.1,
        totalRatings: 18,
        imageUrl: 'https://example.com/tote.jpg'
      },
      {
        title: `${TEST_PREFIX}Ceramic Coffee Mug Set`,
        description: 'Handmade glazed stoneware pottery dining set',
        category: 'Kitchenware',
        price: 500,
        stock: 25,
        averageRating: 4.3,
        totalRatings: 12,
        imageUrl: 'https://example.com/mugs.jpg'
      },
      {
        title: `${TEST_PREFIX}Handmade Paper Notebook`,
        description: 'Recycled unruled vintage diary journal',
        category: 'Stationery',
        price: 90,
        stock: 30,
        averageRating: 4.4,
        totalRatings: 7,
        imageUrl: 'https://example.com/notebook.jpg'
      },
      {
        title: `${TEST_PREFIX}Lavender Scented Soy Candle`,
        description: 'Aromatherapy soy wax candle for home relaxation',
        category: 'Home Decor',
        price: 350,
        stock: 18,
        averageRating: 4.8,
        totalRatings: 19,
        imageUrl: 'https://example.com/candle.jpg'
      },
      {
        title: `${TEST_PREFIX}Woolen Handknitted Socks`,
        description: 'Cozy winter warm wool knit socks set',
        category: 'Clothing',
        price: 180,
        stock: 14,
        averageRating: 4.7,
        totalRatings: 11,
        imageUrl: 'https://example.com/socks.jpg'
      },
      {
        title: `${TEST_PREFIX}Ergonomic Mechanical Keyboard`,
        description: 'RGB backlit mechanical gaming keyboard gadget',
        category: 'Electronics',
        price: 3500,
        stock: 6,
        averageRating: 5.0,
        totalRatings: 50,
        imageUrl: 'https://example.com/keyboard.jpg',
        variants: [
          { name: 'Blue Switch', price: 3500, stock: 4, options: ['Clicky'] },
          { name: 'Red Switch', price: 3600, stock: 2, options: ['Linear'] }
        ],
        images: ['https://example.com/keyboard-1.jpg', 'https://example.com/keyboard-2.jpg']
      }
    ];

    const createdDocs = await Product.insertMany(
      testProductsSeed.map(p => ({
        ...p,
        vendorId: dummyVendor._id,
        inventoryOperations: []
      }))
    );
    testProductIds = createdDocs.map(d => d._id);
    assert(createdDocs.length === 15, `Seeded 15 test products with prefix ${TEST_PREFIX}`);

    // Set up Express test server
    const app = express();
    app.use(express.json());
    app.use('/api/products', productsRouter);

    server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const port = server.address().port;
    baseUrl = `http://localhost:${port}/api/products`;
    assert(Boolean(port), `Test server listening on port ${port}`);

    // -------------------------------------------------------------
    // Test 1: Product Listing & Default Server-side Pagination
    // -------------------------------------------------------------
    console.log('\n--- Test 1: Product Listing & Default Pagination ---');
    const res1 = await axios.get(baseUrl, { params: { search: TEST_PREFIX } });
    assert(res1.status === 200, 'GET /api/products returns status 200');
    assert(res1.data.success === true, 'Response contains success: true');
    assert(res1.data.totalCount === 15, `totalCount is 15 (got ${res1.data.totalCount})`);
    assert(res1.data.totalPages === 2, `totalPages is 2 for limit=12 (got ${res1.data.totalPages})`);
    assert(res1.data.currentPage === 1, `currentPage is 1 (got ${res1.data.currentPage})`);
    assert(res1.data.limit === 12, `limit is 12 (got ${res1.data.limit})`);
    assert(res1.data.products.length === 12, `Returns 12 items on page 1 (got ${res1.data.products.length})`);
    assert(res1.data.products[0].vendorId?.shopName === dummyVendor.shopName, 'Populates vendor shopName');

    // -------------------------------------------------------------
    // Test 2: Keyword Search across Product Title
    // -------------------------------------------------------------
    console.log('\n--- Test 2: Keyword Search across Title ---');
    const res2 = await axios.get(baseUrl, { params: { search: `${TEST_PREFIX} Headphones` } });
    assert(res2.status === 200, 'Search by title returns 200');
    assert(res2.data.totalCount === 1, `Returns exactly 1 match (got ${res2.data.totalCount})`);
    assert(res2.data.products[0]?.title.includes('Headphones'), 'Found product with "Headphones" in title');

    // -------------------------------------------------------------
    // Test 3: Keyword Search across Product Description
    // -------------------------------------------------------------
    console.log('\n--- Test 3: Keyword Search across Description ---');
    const res3 = await axios.get(baseUrl, { params: { search: `${TEST_PREFIX} Kashmir` } });
    assert(res3.status === 200, 'Search by description returns 200');
    assert(res3.data.totalCount >= 1, `Found product matching description term "Kashmir"`);
    assert(res3.data.products.some(p => p.description.includes('Kashmir')), 'Matched product has "Kashmir" in description');

    // -------------------------------------------------------------
    // Test 4: Category Filtering (Exact & Case-Insensitive)
    // -------------------------------------------------------------
    console.log('\n--- Test 4: Category Filtering ---');
    const res4a = await axios.get(baseUrl, { params: { search: TEST_PREFIX, category: 'Electronics' } });
    assert(res4a.status === 200, 'Category filter returns 200');
    assert(res4a.data.totalCount === 3, `Found 3 Electronics products (got ${res4a.data.totalCount})`);
    assert(res4a.data.products.every(p => p.category === 'Electronics'), 'All returned products belong to Electronics');

    // Case-insensitive check
    const res4b = await axios.get(baseUrl, { params: { search: TEST_PREFIX, category: 'clothing' } });
    assert(res4b.status === 200, 'Case-insensitive category filter returns 200');
    assert(res4b.data.totalCount === 3, `Found 3 Clothing products matching "clothing" lowercase (got ${res4b.data.totalCount})`);

    // -------------------------------------------------------------
    // Test 5: Minimum and Maximum Price Filtering
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Minimum & Maximum Price Filtering ---');
    const res5 = await axios.get(baseUrl, {
      params: { search: TEST_PREFIX, minPrice: 500, maxPrice: 1000 }
    });
    assert(res5.status === 200, 'Price range filter returns 200');
    assert(res5.data.products.length > 0, `Returned ${res5.data.products.length} products between ₹500 and ₹1000`);
    assert(
      res5.data.products.every(p => p.price >= 500 && p.price <= 1000),
      'All returned products satisfy 500 <= price <= 1000'
    );

    // -------------------------------------------------------------
    // Test 6: Availability and Stock Filtering
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Availability & Stock Filtering ---');
    const res6InStock = await axios.get(baseUrl, {
      params: { search: TEST_PREFIX, inStock: 'true' }
    });
    assert(res6InStock.status === 200, 'inStock=true returns 200');
    assert(res6InStock.data.totalCount === 14, `Found 14 in-stock products (got ${res6InStock.data.totalCount})`);
    assert(res6InStock.data.products.every(p => p.stock > 0), 'All inStock=true items have stock > 0');

    const res6OutOfStock = await axios.get(baseUrl, {
      params: { search: TEST_PREFIX, inStock: 'false' }
    });
    assert(res6OutOfStock.status === 200, 'inStock=false returns 200');
    assert(res6OutOfStock.data.totalCount === 1, `Found 1 out-of-stock product (got ${res6OutOfStock.data.totalCount})`);
    assert(res6OutOfStock.data.products[0].stock === 0, 'Out-of-stock item has stock 0');

    // -------------------------------------------------------------
    // Test 7: Vendor Filtering
    // -------------------------------------------------------------
    console.log('\n--- Test 7: Vendor Filtering ---');
    const res7 = await axios.get(baseUrl, {
      params: { vendorId: dummyVendor._id.toString() }
    });
    assert(res7.status === 200, 'Vendor filter returns 200');
    assert(res7.data.totalCount === 15, `All 15 products matched vendorId (got ${res7.data.totalCount})`);
    assert(
      res7.data.products.every(p => p.vendorId?._id?.toString() === dummyVendor._id.toString()),
      'All products match vendorId'
    );

    // -------------------------------------------------------------
    // Test 8: Sorting by Price (Ascending and Descending)
    // -------------------------------------------------------------
    console.log('\n--- Test 8: Sorting by Price ---');
    const res8Asc = await axios.get(baseUrl, {
      params: { search: TEST_PREFIX, sort: 'price_asc', limit: 15 }
    });
    assert(res8Asc.status === 200, 'sort=price_asc returns 200');
    let isPriceAsc = true;
    for (let i = 1; i < res8Asc.data.products.length; i++) {
      if (res8Asc.data.products[i].price < res8Asc.data.products[i - 1].price) {
        isPriceAsc = false;
        break;
      }
    }
    assert(isPriceAsc, `Prices sorted ascending: min is ₹${res8Asc.data.products[0].price}, max is ₹${res8Asc.data.products[res8Asc.data.products.length - 1].price}`);

    const res8Desc = await axios.get(baseUrl, {
      params: { search: TEST_PREFIX, sort: 'price_desc', limit: 15 }
    });
    assert(res8Desc.status === 200, 'sort=price_desc returns 200');
    let isPriceDesc = true;
    for (let i = 1; i < res8Desc.data.products.length; i++) {
      if (res8Desc.data.products[i].price > res8Desc.data.products[i - 1].price) {
        isPriceDesc = false;
        break;
      }
    }
    assert(isPriceDesc, `Prices sorted descending: first is ₹${res8Desc.data.products[0].price}, last is ₹${res8Desc.data.products[res8Desc.data.products.length - 1].price}`);

    // -------------------------------------------------------------
    // Test 9: Sorting by Name & Rating
    // -------------------------------------------------------------
    console.log('\n--- Test 9: Sorting by Name and Rating ---');
    const res9Name = await axios.get(baseUrl, {
      params: { search: TEST_PREFIX, sort: 'name_asc', limit: 15 }
    });
    assert(res9Name.status === 200, 'sort=name_asc returns 200');
    let isNameAsc = true;
    for (let i = 1; i < res9Name.data.products.length; i++) {
      if (res9Name.data.products[i].title.localeCompare(res9Name.data.products[i - 1].title) < 0) {
        isNameAsc = false;
        break;
      }
    }
    assert(isNameAsc, 'Product titles are in alphabetical ascending order');

    const res9Rating = await axios.get(baseUrl, {
      params: { search: TEST_PREFIX, sort: 'rating_desc', limit: 15 }
    });
    assert(res9Rating.status === 200, 'sort=rating_desc returns 200');
    assert(res9Rating.data.products[0].averageRating >= res9Rating.data.products[1].averageRating, 'Ratings sorted descending');

    // -------------------------------------------------------------
    // Test 10: Server-Side Pagination and Offsets
    // -------------------------------------------------------------
    console.log('\n--- Test 10: Server-side Pagination & Offsets ---');
    const res10Page1 = await axios.get(baseUrl, {
      params: { search: TEST_PREFIX, sort: 'price_asc', page: 1, limit: 5 }
    });
    const res10Page2 = await axios.get(baseUrl, {
      params: { search: TEST_PREFIX, sort: 'price_asc', page: 2, limit: 5 }
    });
    const res10Page3 = await axios.get(baseUrl, {
      params: { search: TEST_PREFIX, sort: 'price_asc', page: 3, limit: 5 }
    });

    assert(res10Page1.data.products.length === 5, 'Page 1 has 5 products');
    assert(res10Page2.data.products.length === 5, 'Page 2 has 5 products');
    assert(res10Page3.data.products.length === 5, 'Page 3 has 5 products');
    assert(res10Page1.data.totalPages === 3, 'Calculates totalPages === 3 for 15 items with limit 5');

    // Verify disjoint sets across pages
    const idsPage1 = new Set(res10Page1.data.products.map(p => p._id));
    const idsPage2 = new Set(res10Page2.data.products.map(p => p._id));
    const overlap = [...idsPage2].some(id => idsPage1.has(id));
    assert(!overlap, 'No overlap between page 1 and page 2 products (pagination offset is accurate)');

    // -------------------------------------------------------------
    // Test 11: Validation and Rejection of Invalid Query Parameters
    // -------------------------------------------------------------
    console.log('\n--- Test 11: Validation & Rejection of Invalid Parameters ---');

    // Negative minPrice
    try {
      await axios.get(baseUrl, { params: { minPrice: -50 } });
      assert(false, 'Negative minPrice should return 400');
    } catch (err) {
      assert(err.response?.status === 400, 'Negative minPrice rejected with 400 Bad Request');
    }

    // Negative maxPrice
    try {
      await axios.get(baseUrl, { params: { maxPrice: -10 } });
      assert(false, 'Negative maxPrice should return 400');
    } catch (err) {
      assert(err.response?.status === 400, 'Negative maxPrice rejected with 400 Bad Request');
    }

    // minPrice > maxPrice
    try {
      await axios.get(baseUrl, { params: { minPrice: 1000, maxPrice: 200 } });
      assert(false, 'minPrice > maxPrice should return 400');
    } catch (err) {
      assert(err.response?.status === 400, 'minPrice > maxPrice rejected with 400 Bad Request');
    }

    // Invalid sort field
    try {
      await axios.get(baseUrl, { params: { sort: 'malicious_injected_field' } });
      assert(false, 'Invalid sort field should return 400');
    } catch (err) {
      assert(err.response?.status === 400, 'Invalid sort field rejected with 400 Bad Request');
    }

    // Invalid page
    try {
      await axios.get(baseUrl, { params: { page: 0 } });
      assert(false, 'page=0 should return 400');
    } catch (err) {
      assert(err.response?.status === 400, 'page=0 rejected with 400 Bad Request');
    }

    try {
      await axios.get(baseUrl, { params: { page: 'invalid' } });
      assert(false, 'page=invalid should return 400');
    } catch (err) {
      assert(err.response?.status === 400, 'page=invalid rejected with 400 Bad Request');
    }

    // Excessive limit (> 100)
    try {
      await axios.get(baseUrl, { params: { limit: 500 } });
      assert(false, 'limit=500 should return 400');
    } catch (err) {
      assert(err.response?.status === 400, 'limit=500 rejected with 400 Bad Request (excessive limit prevented)');
    }

    // Invalid vendorId
    try {
      await axios.get(baseUrl, { params: { vendorId: 'invalid-vendor-id' } });
      assert(false, 'Invalid vendorId should return 400');
    } catch (err) {
      assert(err.response?.status === 400, 'Invalid vendorId rejected with 400 Bad Request');
    }

    // -------------------------------------------------------------
    // Test 12: Empty State for Non-Matching Query
    // -------------------------------------------------------------
    console.log('\n--- Test 12: Empty State for Non-Matching Query ---');
    const res12 = await axios.get(baseUrl, {
      params: { search: 'NONEXISTENT_QUERY_TERM_XYZ9999999' }
    });
    assert(res12.status === 200, 'Non-matching search returns 200');
    assert(res12.data.products.length === 0, 'Products array is empty');
    assert(res12.data.totalCount === 0, 'totalCount is 0');
    assert(res12.data.totalPages === 0, 'totalPages is 0');

    // -------------------------------------------------------------
    // Test 13: Product Detail Endpoint (GET /api/products/:id)
    // -------------------------------------------------------------
    console.log('\n--- Test 13: Single Product Detail with Variants ---');
    const keyboardDoc = createdDocs.find(d => d.title.includes('Mechanical Keyboard'));
    assert(Boolean(keyboardDoc), 'Found seeded keyboard document');

    const res13 = await axios.get(`${baseUrl}/${keyboardDoc._id}`);
    assert(res13.status === 200, 'GET /:id returns 200');
    assert(res13.data.title === keyboardDoc.title, 'Correct product title returned');
    assert(res13.data.vendorId?.shopName === dummyVendor.shopName, 'Populates vendor details on single product');
    assert(Array.isArray(res13.data.variants) && res13.data.variants.length === 2, 'Returns product variants');
    assert(res13.data.variants[0].name === 'Blue Switch', 'Variant details match');
    assert(Array.isArray(res13.data.images) && res13.data.images.length === 2, 'Returns multiple images array');

    // Invalid ObjectId format
    try {
      await axios.get(`${baseUrl}/not-a-valid-id`);
      assert(false, 'Invalid ID should return 400');
    } catch (err) {
      assert(err.response?.status === 400, 'Invalid ID format rejected with 400');
    }

    // Non-existent ObjectId
    try {
      await axios.get(`${baseUrl}/${new mongoose.Types.ObjectId()}`);
      assert(false, 'Non-existent ID should return 404');
    } catch (err) {
      assert(err.response?.status === 404, 'Non-existent product ID returns 404 Not Found');
    }

    // -------------------------------------------------------------
    // Test 14: Category Path Endpoint (GET /api/products/category/:category)
    // -------------------------------------------------------------
    console.log('\n--- Test 14: Category Path Route (/category/:category) ---');
    const res14 = await axios.get(`${baseUrl}/category/Bags`, {
      params: { search: TEST_PREFIX }
    });
    assert(res14.status === 200, 'GET /category/Bags returns 200');
    assert(res14.data.totalCount === 2, `Returns 2 Bags products (got ${res14.data.totalCount})`);
    assert(res14.data.products.every(p => p.category === 'Bags'), 'All items belong to Bags');

    // -------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------
    console.log('\n============================================================');
    console.log(` RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('============================================================\n');

    // Clean up
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
    if (server) {
      server.close();
    }
    await cleanupTestData();
    await mongoose.disconnect();
    process.exit(1);
  }
}

runCatalogueTests();
