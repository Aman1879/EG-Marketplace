/**
 * Lightweight, Versioned Migration Runner for EG-Marketplace
 * 
 * Tracks applied migrations in the `_migrations` collection.
 * Idempotent: Can be run multiple times safely.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const MIGRATIONS = [
  {
    id: '001_backfill_vendor_fields',
    name: 'Backfill legacy vendor approval status, onboarding status, and earnings',
    up: async (db) => {
      const vendors = db.collection('vendors');
      
      // Backfill missing approvalStatus
      const resApproval = await vendors.updateMany(
        { approvalStatus: { $exists: false } },
        { $set: { approvalStatus: 'approved' } }
      );

      // Backfill missing onboardingComplete
      const resOnboarding = await vendors.updateMany(
        { onboardingComplete: { $exists: false } },
        { $set: { onboardingComplete: true } }
      );

      // Backfill missing earnings
      const resEarnings = await vendors.updateMany(
        { totalEarnings: { $exists: false } },
        { $set: { totalEarnings: 0 } }
      );

      const resPaidEarnings = await vendors.updateMany(
        { totalPaidEarnings: { $exists: false } },
        { $set: { totalPaidEarnings: 0 } }
      );

      return {
        approvalUpdated: resApproval.modifiedCount,
        onboardingUpdated: resOnboarding.modifiedCount,
        earningsUpdated: resEarnings.modifiedCount,
        paidEarningsUpdated: resPaidEarnings.modifiedCount
      };
    }
  },
  {
    id: '002_backfill_product_sku_and_variant_stock',
    name: 'Backfill missing product SKUs, variant SKUs, and sync variant aggregate stock',
    up: async (db) => {
      const products = db.collection('products');
      const cursor = products.find({});
      let skuBackfilled = 0;
      let stockSynced = 0;

      while (await cursor.hasNext()) {
        const prod = await cursor.next();
        let needsUpdate = false;
        const updateDoc = {};

        // 1. Backfill product SKU if missing
        let productSku = prod.sku;
        if (!productSku || typeof productSku !== 'string' || productSku.trim() === '') {
          const categoryPrefix = (prod.category || 'GEN').substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X');
          const idSuffix = prod._id.toString().slice(-6).toUpperCase();
          productSku = `PROD-${categoryPrefix}-${idSuffix}`;
          updateDoc.sku = productSku;
          needsUpdate = true;
          skuBackfilled++;
        }

        // 2. Variants: backfill SKU and sync aggregate stock
        if (Array.isArray(prod.variants) && prod.variants.length > 0) {
          let variantsModified = false;
          let calculatedTotalStock = 0;

          const updatedVariants = prod.variants.map((v, idx) => {
            const vStock = typeof v.stock === 'number' && v.stock >= 0 ? v.stock : 0;
            calculatedTotalStock += vStock;

            let vSku = v.sku;
            if (!vSku || typeof vSku !== 'string' || vSku.trim() === '') {
              vSku = `${productSku}-V${idx + 1}`;
              variantsModified = true;
            }

            return {
              ...v,
              sku: vSku,
              stock: vStock
            };
          });

          if (variantsModified) {
            updateDoc.variants = updatedVariants;
            needsUpdate = true;
          }

          if (prod.stock !== calculatedTotalStock) {
            updateDoc.stock = calculatedTotalStock;
            needsUpdate = true;
            stockSynced++;
          }
        }

        if (needsUpdate) {
          await products.updateOne({ _id: prod._id }, { $set: updateDoc });
        }
      }

      return { skuBackfilled, stockSynced };
    }
  },
  {
    id: '003_backfill_cart_variant_fields',
    name: 'Normalize cart item variantId, backfill priceAtAdd, and merge duplicates',
    up: async (db) => {
      const cartCollection = db.collection('cartitems');
      const productsCollection = db.collection('products');

      // 1. Ensure variantId is null where missing
      const resVariantNull = await cartCollection.updateMany(
        { variantId: { $exists: false } },
        { $set: { variantId: null } }
      );

      // 2. Backfill missing priceAtAdd from product catalogue
      const unpricedItems = await cartCollection.find({
        $or: [{ priceAtAdd: { $exists: false } }, { priceAtAdd: null }, { priceAtAdd: { $lt: 0 } }]
      }).toArray();

      let pricesBackfilled = 0;
      for (const item of unpricedItems) {
        const prod = await productsCollection.findOne({ _id: item.productId });
        let resolvedPrice = 0;
        if (prod) {
          if (item.variantId && Array.isArray(prod.variants)) {
            const v = prod.variants.find(varItem => varItem._id && varItem._id.toString() === item.variantId.toString());
            resolvedPrice = v && typeof v.price === 'number' ? v.price : prod.price;
          } else {
            resolvedPrice = prod.price || 0;
          }
        }
        await cartCollection.updateOne(
          { _id: item._id },
          { $set: { priceAtAdd: resolvedPrice } }
        );
        pricesBackfilled++;
      }

      // 3. Merge duplicate cart items safely without losing customer cart items
      const duplicates = await cartCollection.aggregate([
        {
          $group: {
            _id: {
              userId: '$userId',
              productId: '$productId',
              variantId: { $ifNull: ['$variantId', null] }
            },
            count: { $sum: 1 },
            ids: { $push: '$_id' },
            totalQty: { $sum: '$quantity' }
          }
        },
        { $match: { count: { $gt: 1 } } }
      ]).toArray();

      let duplicatesMerged = 0;
      for (const dup of duplicates) {
        const [keepId, ...dropIds] = dup.ids;
        await cartCollection.updateOne(
          { _id: keepId },
          { $set: { quantity: dup.totalQty, variantId: dup._id.variantId } }
        );
        if (dropIds.length > 0) {
          await cartCollection.deleteMany({ _id: { $in: dropIds } });
        }
        duplicatesMerged += dropIds.length;
      }

      return {
        variantNullBackfilled: resVariantNull.modifiedCount,
        pricesBackfilled,
        duplicatesMerged
      };
    }
  },
  {
    id: '004_normalize_order_status_and_inventory',
    name: 'Normalize order status casing and backfill inventoryStatus and paymentStatus',
    up: async (db) => {
      const orders = db.collection('orders');
      const cursor = orders.find({});
      let statusNormalized = 0;
      let inventoryStatusBackfilled = 0;
      let paymentStatusBackfilled = 0;

      while (await cursor.hasNext()) {
        const order = await cursor.next();
        let needsUpdate = false;
        const updateDoc = {};

        // 1. Normalize status casing
        if (order.status && typeof order.status === 'string') {
          const lowerStatus = order.status.toLowerCase();
          if (order.status !== lowerStatus) {
            updateDoc.status = lowerStatus;
            needsUpdate = true;
            statusNormalized++;
          }
        }

        // 2. Ensure inventoryStatus exists
        if (!order.inventoryStatus) {
          const currentStatus = (updateDoc.status || order.status || '').toLowerCase();
          if (['confirmed', 'processing', 'shipped', 'delivered'].includes(currentStatus)) {
            updateDoc.inventoryStatus = 'deducted';
          } else if (['cancelled', 'refunded'].includes(currentStatus)) {
            updateDoc.inventoryStatus = 'restored';
          } else {
            updateDoc.inventoryStatus = 'not_deducted';
          }
          needsUpdate = true;
          inventoryStatusBackfilled++;
        }

        // 3. Ensure paymentStatus exists
        if (!order.paymentStatus) {
          const currentStatus = (updateDoc.status || order.status || '').toLowerCase();
          if (order.razorpayPaymentId || ['confirmed', 'processing', 'shipped', 'delivered'].includes(currentStatus)) {
            updateDoc.paymentStatus = 'paid';
          } else if (currentStatus === 'refunded') {
            updateDoc.paymentStatus = 'refunded';
          } else if (currentStatus === 'cancelled') {
            updateDoc.paymentStatus = 'failed';
          } else {
            updateDoc.paymentStatus = 'created';
          }
          needsUpdate = true;
          paymentStatusBackfilled++;
        }

        if (needsUpdate) {
          await orders.updateOne({ _id: order._id }, { $set: updateDoc });
        }
      }

      return {
        statusNormalized,
        inventoryStatusBackfilled,
        paymentStatusBackfilled
      };
    }
  },
  {
    id: '005_normalize_address_defaults',
    name: 'Ensure at most one default address per customer',
    up: async (db) => {
      const addresses = db.collection('addresses');

      // Find all users who have default addresses
      const userDefaults = await addresses.aggregate([
        { $match: { isDefault: true } },
        {
          $group: {
            _id: '$userId',
            count: { $sum: 1 },
            ids: { $push: '$_id' }
          }
        },
        { $match: { count: { $gt: 1 } } }
      ]).toArray();

      let customersNormalized = 0;
      let nonDefaultsSet = 0;

      for (const group of userDefaults) {
        // Find documents sorted by updatedAt desc, createdAt desc
        const docs = await addresses.find({ _id: { $in: group.ids } })
          .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
          .toArray();

        // Keep the most recent as default, clear the others
        const [keepDefault, ...clearDefaults] = docs;
        if (clearDefaults.length > 0) {
          const clearIds = clearDefaults.map(d => d._id);
          const updateResult = await addresses.updateMany(
            { _id: { $in: clearIds } },
            { $set: { isDefault: false } }
          );
          nonDefaultsSet += updateResult.modifiedCount;
          customersNormalized++;
        }
      }

      return {
        customersNormalized,
        nonDefaultsSet
      };
    }
  }
];

/**
 * Execute all pending migrations.
 */
async function runMigrations(customMongoose = null) {
  const m = customMongoose || mongoose;
  let shouldCloseConnection = false;

  if (m.connection.readyState === 0) {
    const uri = (process.env.NODE_ENV === 'test' ? process.env.TEST_MONGODB_URI : null) || process.env.MONGODB_URI || process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/marketplace';
    await m.connect(uri);
    shouldCloseConnection = true;
    console.log(`[Migrations] Connected to MongoDB at: ${uri}`);
  }

  const db = m.connection.db;
  const migrationsCollection = db.collection('_migrations');

  // Ensure index on migration id
  await migrationsCollection.createIndex({ id: 1 }, { unique: true });

  const appliedMigrations = await migrationsCollection.find({}).toArray();
  const appliedIds = new Set(appliedMigrations.map(m => m.id));

  const pendingMigrations = MIGRATIONS.filter(m => !appliedIds.has(m.id));

  console.log(`[Migrations] Total migrations defined: ${MIGRATIONS.length}`);
  console.log(`[Migrations] Already applied: ${appliedIds.size}`);
  console.log(`[Migrations] Pending: ${pendingMigrations.length}`);

  const results = [];

  for (const migration of pendingMigrations) {
    console.log(`[Migrations] Applying: ${migration.id} - ${migration.name}...`);
    const startTime = Date.now();
    try {
      const details = await migration.up(db);
      const durationMs = Date.now() - startTime;

      await migrationsCollection.insertOne({
        id: migration.id,
        name: migration.name,
        appliedAt: new Date(),
        durationMs,
        details
      });

      console.log(`[Migrations] ✅ Applied: ${migration.id} (${durationMs}ms)`);
      results.push({
        id: migration.id,
        status: 'applied',
        durationMs,
        details
      });
    } catch (err) {
      console.error(`[Migrations] ❌ Migration ${migration.id} failed:`, err);
      throw err;
    }
  }

  if (shouldCloseConnection) {
    await m.connection.close();
    console.log('[Migrations] Database connection closed.');
  }

  return {
    total: MIGRATIONS.length,
    alreadyApplied: appliedIds.size,
    appliedNow: results.length,
    results
  };
}

if (require.main === module) {
  runMigrations()
    .then(result => {
      console.log('\n=============================================');
      console.log('✅ Migrations completed successfully!');
      console.log(`Total: ${result.total}, Previously applied: ${result.alreadyApplied}, Newly applied: ${result.appliedNow}`);
      console.log('=============================================\n');
      process.exit(0);
    })
    .catch(err => {
      console.error('\n❌ Migration failed:', err);
      process.exit(1);
    });
}

module.exports = {
  runMigrations,
  MIGRATIONS
};

