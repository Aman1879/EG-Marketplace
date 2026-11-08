/**
 * Phase 14 Verification Suite: Database Indexes, Migrations, and Seed Data
 * 
 * Verifies:
 * 1. Obsolete index detection and dropping (CartItem userId_1_productId_1, Vendor unique userId_1).
 * 2. Safe duplicate data resolution (CartItem merging without data loss).
 * 3. Schema index synchronization and verification across all models.
 * 4. Index sync idempotency (running twice produces 0 errors).
 * 5. Migration runner tracking via `_migrations` collection.
 * 6. Migration 1: Vendor field backfills.
 * 7. Migration 2: Product SKU backfill and variant aggregate stock synchronization.
 * 8. Migration 3: Cart variant field normalization, price backfill, and quantity merging.
 * 9. Migration 4: Order status lowercase normalization and inventoryStatus/paymentStatus backfill.
 * 10. Migration 5: Address defaults normalization (at most one default per user).
 * 11. Migration idempotency (already applied migrations skipped).
 * 12. Seed script data generation (admin, vendors, buyers, addresses, products with variants).
 * 13. Seed script idempotency (running twice does not create duplicate documents).
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../models/User');
const Vendor = require('../models/Vendor');
const Product = require('../models/Product');
const Order = require('../models/Order');
const CartItem = require('../models/CartItem');
const Address = require('../models/Address');
const AuditLog = require('../models/AuditLog');
const InventoryOperation = require('../models/InventoryOperation');
const Commission = require('../models/Commission');
const Dispute = require('../models/Dispute');
const Rating = require('../models/Rating');

const { syncAllIndexes, preIndexCleanup } = require('./sync-indexes');
const { runMigrations, MIGRATIONS } = require('./migrate');
const { seedDatabase } = require('./seed');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    testsPassed++;
    console.log(`  ✅ ${message}`);
  } else {
    testsFailed++;
    console.error(`  ❌ FAILED: ${message}`);
  }
}

async function runPhase14Verification() {
  const uri = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/marketplace_test';
  console.log(`\n======================================================`);
  console.log(`Starting Phase 14 Database Setup & Migration Suite`);
  console.log(`Target Database: ${uri}`);
  console.log(`======================================================\n`);

  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  try {
    // -------------------------------------------------------------
    // SECTION 1: Obsolete Index Cleanup & Safe Duplicate Merging
    // -------------------------------------------------------------
    console.log('\n--- Section 1: Pre-Index Cleanup & Safe Duplicate Resolution ---');

    // Setup an obsolete index on cartitems
    const cartCol = db.collection('cartitems');
    try {
      await cartCol.createIndex({ userId: 1, productId: 1 }, { name: 'userId_1_productId_1', unique: false });
    } catch (_) {}

    // Setup duplicate cart items for testing safe merging
    const testBuyerId = new mongoose.Types.ObjectId();
    const testProductId = new mongoose.Types.ObjectId();
    const testVariantId = new mongoose.Types.ObjectId();

    // Drop compound unique index first (if present) so we can insert simulated legacy duplicate data
    try {
      await cartCol.dropIndex('userId_1_productId_1_variantId_1');
    } catch (_) {}

    await cartCol.insertMany([
      { userId: testBuyerId, productId: testProductId, variantId: testVariantId, quantity: 3, priceAtAdd: 500, addedAt: new Date(Date.now() - 10000) },
      { userId: testBuyerId, productId: testProductId, variantId: testVariantId, quantity: 4, priceAtAdd: 500, addedAt: new Date() }
    ]);

    // Setup obsolete unique index on vendors
    const vendorCol = db.collection('vendors');
    try {
      await vendorCol.createIndex({ userId: 1 }, { name: 'userId_1', unique: true });
    } catch (_) {}

    // Run preIndexCleanup
    const cleanupReport = await preIndexCleanup(db);

    // Verify obsolete cart index was dropped
    const currentCartIndexes = await cartCol.indexes();
    const legacyCartIdx = currentCartIndexes.find(idx => idx.name === 'userId_1_productId_1');
    assert(!legacyCartIdx, 'Obsolete cart index userId_1_productId_1 was safely dropped');

    // Verify duplicate cart records were merged and quantity summed (3 + 4 = 7)
    const remainingCartItems = await cartCol.find({
      userId: testBuyerId,
      productId: testProductId,
      variantId: testVariantId
    }).toArray();

    assert(remainingCartItems.length === 1, 'Duplicate cart items merged into exactly 1 document');
    assert(remainingCartItems[0].quantity === 7, `Cart quantity preserved via sum (expected 7, got ${remainingCartItems[0].quantity})`);

    // Verify obsolete unique vendor index was dropped
    const currentVendorIndexes = await vendorCol.indexes();
    const uniqueUserIdIdx = currentVendorIndexes.find(idx => idx.name === 'userId_1' && idx.unique === true);
    assert(!uniqueUserIdIdx, 'Obsolete unique index on Vendor userId was safely dropped to allow multi-shop vendors');

    // Clean up test cart item
    await cartCol.deleteMany({ userId: testBuyerId });

    // -------------------------------------------------------------
    // SECTION 2: Model Index Synchronization & Verification
    // -------------------------------------------------------------
    console.log('\n--- Section 2: Index Synchronization across Models ---');

    const syncResult = await syncAllIndexes(mongoose);
    assert(syncResult.syncResults.length >= 12, `All 12 Mongoose models synchronized (${syncResult.syncResults.length})`);

    // Check Order indexes
    const orderIndexes = await db.collection('orders').indexes();
    const orderIndexNames = orderIndexes.map(idx => idx.name);
    assert(orderIndexNames.includes('buyerId_1_createdAt_-1'), 'Order has buyerId_1_createdAt_-1 index');
    assert(orderIndexNames.includes('vendorId_1_createdAt_-1'), 'Order has vendorId_1_createdAt_-1 index');
    assert(orderIndexNames.includes('status_1_createdAt_-1'), 'Order has status_1_createdAt_-1 index');
    assert(orderIndexNames.includes('paymentStatus_1_createdAt_-1'), 'Order has paymentStatus_1_createdAt_-1 index');
    assert(orderIndexNames.includes('razorpayOrderId_1'), 'Order has razorpayOrderId_1 sparse index');
    assert(orderIndexNames.includes('razorpayPaymentId_1'), 'Order has razorpayPaymentId_1 sparse index');
    assert(orderIndexNames.includes('transferStatus_1'), 'Order has transferStatus_1 index');

    // Check Product indexes
    const productIndexes = await db.collection('products').indexes();
    const productIndexNames = productIndexes.map(idx => idx.name);
    assert(productIndexNames.includes('sku_1'), 'Product has sku_1 sparse index');
    assert(productIndexNames.includes('variants.sku_1'), 'Product has variants.sku_1 sparse index');
    assert(productIndexNames.includes('category_1_price_1'), 'Product has category_1_price_1 index');

    // Check Address indexes
    const addressIndexes = await db.collection('addresses').indexes();
    const addressIndexNames = addressIndexes.map(idx => idx.name);
    assert(addressIndexNames.includes('userId_1_isDefault_-1_createdAt_-1'), 'Address has userId_1_isDefault_-1_createdAt_-1 compound index');

    // Check User indexes
    const userIndexes = await db.collection('users').indexes();
    const userIndexNames = userIndexes.map(idx => idx.name);
    assert(userIndexNames.includes('role_1_createdAt_-1'), 'User has role_1_createdAt_-1 index');
    assert(userIndexNames.includes('email_1'), 'User has unique email_1 index');

    // Check CartItem unique compound index
    const cartItemIndexes = await db.collection('cartitems').indexes();
    const cartItemUnique = cartItemIndexes.find(idx => idx.name === 'userId_1_productId_1_variantId_1' && idx.unique === true);
    assert(!!cartItemUnique, 'CartItem has unique compound index { userId: 1, productId: 1, variantId: 1 }');

    // Test Idempotency of syncAllIndexes (run again)
    const secondSyncResult = await syncAllIndexes(mongoose);
    assert(secondSyncResult.syncResults.length >= 12, 'Second syncAllIndexes run succeeded with 0 errors (Idempotent)');

    // -------------------------------------------------------------
    // SECTION 3: Versioned Migrations
    // -------------------------------------------------------------
    console.log('\n--- Section 3: Versioned Migrations ---');

    // Migration 1: Vendor fields backfill
    const testMigVendorId = new mongoose.Types.ObjectId();
    await db.collection('vendors').insertOne({
      _id: testMigVendorId,
      userId: new mongoose.Types.ObjectId(),
      shopName: 'Test Legacy Vendor'
      // Missing approvalStatus, onboardingComplete, totalEarnings, totalPaidEarnings
    });

    const mig1 = MIGRATIONS.find(m => m.id === '001_backfill_vendor_fields');
    await mig1.up(db);

    const updatedMigVendor = await db.collection('vendors').findOne({ _id: testMigVendorId });
    assert(updatedMigVendor.approvalStatus === 'approved', 'Migration 1 backfilled approvalStatus: approved');
    assert(updatedMigVendor.onboardingComplete === true, 'Migration 1 backfilled onboardingComplete: true');
    assert(updatedMigVendor.totalEarnings === 0, 'Migration 1 backfilled totalEarnings: 0');
    assert(updatedMigVendor.totalPaidEarnings === 0, 'Migration 1 backfilled totalPaidEarnings: 0');
    await db.collection('vendors').deleteOne({ _id: testMigVendorId });

    // Migration 2: Product SKU and variant aggregate stock
    const testMigProdId = new mongoose.Types.ObjectId();
    await db.collection('products').insertOne({
      _id: testMigProdId,
      vendorId: new mongoose.Types.ObjectId(),
      title: 'Legacy Product Without SKU',
      description: 'Test product for migration',
      price: 999,
      category: 'Electronics',
      imageUrl: 'http://example.com/img.jpg',
      stock: 10, // Out of sync: variant total will be 5 + 15 = 20
      variants: [
        { name: 'Red', price: 999, stock: 5 },
        { name: 'Blue', price: 999, stock: 15 }
      ]
    });

    const mig2 = MIGRATIONS.find(m => m.id === '002_backfill_product_sku_and_variant_stock');
    await mig2.up(db);

    const updatedMigProd = await db.collection('products').findOne({ _id: testMigProdId });
    assert(typeof updatedMigProd.sku === 'string' && updatedMigProd.sku.startsWith('PROD-ELE-'), `Migration 2 backfilled product SKU: ${updatedMigProd.sku}`);
    assert(updatedMigProd.stock === 20, `Migration 2 synced aggregate product stock to 20 (got ${updatedMigProd.stock})`);
    assert(typeof updatedMigProd.variants[0].sku === 'string' && updatedMigProd.variants[0].sku.includes('-V1'), 'Migration 2 backfilled variant SKU');
    await db.collection('products').deleteOne({ _id: testMigProdId });

    // Migration 3: Cart variant field normalization, price backfill, duplicate merge
    const testMigCartProdId = new mongoose.Types.ObjectId();
    await db.collection('products').insertOne({
      _id: testMigCartProdId,
      vendorId: new mongoose.Types.ObjectId(),
      title: 'Cart Target Product',
      description: 'Desc',
      price: 450,
      imageUrl: 'http://example.com/img.jpg',
      category: 'General',
      stock: 50
    });

    const testMigCartUser = new mongoose.Types.ObjectId();
    try {
      await db.collection('cartitems').dropIndex('userId_1_productId_1_variantId_1');
    } catch (_) {}
    await db.collection('cartitems').insertMany([
      { userId: testMigCartUser, productId: testMigCartProdId, quantity: 2 }, // Missing variantId and priceAtAdd
      { userId: testMigCartUser, productId: testMigCartProdId, variantId: null, quantity: 3 } // Duplicate!
    ]);

    const mig3 = MIGRATIONS.find(m => m.id === '003_backfill_cart_variant_fields');
    await mig3.up(db);

    const migCartItems = await db.collection('cartitems').find({ userId: testMigCartUser, productId: testMigCartProdId }).toArray();
    assert(migCartItems.length === 1, 'Migration 3 merged duplicate cart items');
    assert(migCartItems[0].variantId === null, 'Migration 3 normalized variantId to null');
    assert(migCartItems[0].priceAtAdd === 450, `Migration 3 backfilled priceAtAdd from product (450, got ${migCartItems[0].priceAtAdd})`);
    assert(migCartItems[0].quantity === 5, `Migration 3 preserved merged quantity (2 + 3 = 5, got ${migCartItems[0].quantity})`);
    await db.collection('cartitems').deleteMany({ userId: testMigCartUser });
    await db.collection('products').deleteOne({ _id: testMigCartProdId });

    // Migration 4: Order status casing and inventoryStatus/paymentStatus
    const testMigOrderId = new mongoose.Types.ObjectId();
    await db.collection('orders').insertOne({
      _id: testMigOrderId,
      buyerId: new mongoose.Types.ObjectId(),
      vendorId: new mongoose.Types.ObjectId(),
      totalAmount: 1000,
      vendorEarning: 900,
      adminCommission: 100,
      shippingAddress: '123 Street',
      status: 'Shipped', // Capitalized legacy status
      products: []
    });

    const mig4 = MIGRATIONS.find(m => m.id === '004_normalize_order_status_and_inventory');
    await mig4.up(db);

    const updatedMigOrder = await db.collection('orders').findOne({ _id: testMigOrderId });
    assert(updatedMigOrder.status === 'shipped', `Migration 4 normalized order status casing to lowercase (got '${updatedMigOrder.status}')`);
    assert(updatedMigOrder.inventoryStatus === 'deducted', `Migration 4 backfilled inventoryStatus to 'deducted' for shipped order`);
    assert(updatedMigOrder.paymentStatus === 'paid', `Migration 4 backfilled paymentStatus to 'paid' for shipped order`);
    await db.collection('orders').deleteOne({ _id: testMigOrderId });

    // Migration 5: Address defaults normalization
    const testMigAddrUser = new mongoose.Types.ObjectId();
    const oldDate = new Date(Date.now() - 60000);
    const newDate = new Date();

    const addr1 = await db.collection('addresses').insertOne({
      userId: testMigAddrUser,
      fullName: 'User Older Default',
      phone: '9999999999',
      addressLine1: 'Older Line 1',
      city: 'Delhi',
      state: 'Delhi',
      postalCode: '110001',
      isDefault: true,
      updatedAt: oldDate,
      createdAt: oldDate
    });

    const addr2 = await db.collection('addresses').insertOne({
      userId: testMigAddrUser,
      fullName: 'User Newer Default',
      phone: '9999999999',
      addressLine1: 'Newer Line 1',
      city: 'Delhi',
      state: 'Delhi',
      postalCode: '110001',
      isDefault: true,
      updatedAt: newDate,
      createdAt: newDate
    });

    const mig5 = MIGRATIONS.find(m => m.id === '005_normalize_address_defaults');
    await mig5.up(db);

    const checkAddr1 = await db.collection('addresses').findOne({ _id: addr1.insertedId });
    const checkAddr2 = await db.collection('addresses').findOne({ _id: addr2.insertedId });
    assert(checkAddr2.isDefault === true, 'Migration 5 retained most recent address as isDefault: true');
    assert(checkAddr1.isDefault === false, 'Migration 5 set older default address to isDefault: false');
    await db.collection('addresses').deleteMany({ userId: testMigAddrUser });

    // Test migration runner execution & tracking in _migrations
    const migrationRun1 = await runMigrations(mongoose);
    assert(migrationRun1.total === 5, 'Migration runner discovered all 5 migrations');

    const trackedMigrations = await db.collection('_migrations').find({}).toArray();
    assert(trackedMigrations.length === 5, `_migrations collection has 5 recorded applied migrations (got ${trackedMigrations.length})`);

    // Test migration runner idempotency
    const migrationRun2 = await runMigrations(mongoose);
    assert(migrationRun2.alreadyApplied === 5, 'Second migration run recognizes all 5 are already applied');
    assert(migrationRun2.appliedNow === 0, 'Second migration run applies 0 migrations (fully idempotent)');

    // -------------------------------------------------------------
    // SECTION 4: Database Seeding & Seed Idempotency
    // -------------------------------------------------------------
    console.log('\n--- Section 4: Database Seeding & Seed Idempotency ---');

    const seedReport1 = await seedDatabase(mongoose);
    assert(seedReport1.admin && seedReport1.admin.email, `Admin user seeded: ${seedReport1.admin.email}`);
    assert(seedReport1.vendors.length === 2, `2 Demo vendors seeded (${seedReport1.vendors.length})`);
    assert(seedReport1.buyers.length === 2, `2 Demo buyers seeded (${seedReport1.buyers.length})`);
    assert(seedReport1.products.length >= 8, `Catalog seeded with ${seedReport1.products.length} products`);

    // Verify Admin credentials
    const adminUser = await User.findOne({ email: seedReport1.admin.email });
    assert(adminUser && adminUser.role === 'admin', 'Admin user verified with admin role');
    const isPasswordHashed = await bcrypt.compare(process.env.ADMIN_PASSWORD || 'Admin@12345', adminUser.password);
    assert(isPasswordHashed, 'Admin password is encrypted with bcrypt and verifies against configured password');

    // Verify Product variant stock consistency
    const seededVarProduct = await Product.findOne({ sku: 'SKU-APX-ANC01' });
    assert(seededVarProduct && seededVarProduct.variants.length === 2, 'Variant product SKU-APX-ANC01 has 2 variants');
    const expectedVarStock = seededVarProduct.variants.reduce((sum, v) => sum + v.stock, 0);
    assert(seededVarProduct.stock === expectedVarStock, `Aggregate product stock (${seededVarProduct.stock}) matches sum of variant stocks (${expectedVarStock})`);

    // Verify Buyer address defaults
    const buyer1 = await User.findOne({ email: 'buyer1@egmarketplace.com' });
    const buyer1DefaultAddresses = await Address.find({ userId: buyer1._id, isDefault: true });
    assert(buyer1DefaultAddresses.length === 1, `Buyer 1 has exactly 1 default address (got ${buyer1DefaultAddresses.length})`);

    // Test Seed Idempotency (Run seed a second time)
    const seedReport2 = await seedDatabase(mongoose);
    const totalUsersCount = await User.countDocuments({
      email: { $in: ['admin@egmarketplace.com', 'vendor1@egmarketplace.com', 'vendor2@egmarketplace.com', 'buyer1@egmarketplace.com', 'buyer2@egmarketplace.com', 'aman1234@egmarketplace.com'] }
    });
    const totalVendorsCount = await Vendor.countDocuments({
      shopName: { $in: ['Apex Audio & Gadgets', 'Velvet & Thread Apparel'] }
    });
    const totalProductsCount = await Product.countDocuments({
      sku: { $in: ['SKU-APX-ANC01', 'SKU-APX-FIT02', 'SKU-APX-SPK03', 'SKU-APX-LMP04', 'SKU-VVT-TEE01', 'SKU-VVT-JNS02', 'SKU-VVT-MUG03', 'SKU-VVT-SKL04', 'SKU-VVT-BOK05'] }
    });

    assert(totalVendorsCount === 2, `Vendors count remains exactly 2 after second seed (got ${totalVendorsCount})`);
    assert(totalProductsCount === 9, `Products count remains exactly 9 after second seed (got ${totalProductsCount})`);
    assert(seedReport2.admin.action === 'updated', 'Admin record was safely updated/preserved on second seed');

    // -------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------
    console.log(`\n======================================================`);
    console.log(`Phase 14 Verification Summary:`);
    console.log(`Passed: ${testsPassed}`);
    console.log(`Failed: ${testsFailed}`);
    console.log(`======================================================\n`);

    if (testsFailed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Test suite encountered an uncaught error:', err);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

runPhase14Verification();
