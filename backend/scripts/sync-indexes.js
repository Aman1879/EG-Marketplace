/**
 * Database Index Synchronization Script
 * 
 * Safely cleans up obsolete or conflicting indexes, resolves duplicate data without data loss,
 * and synchronizes required indexes across all Mongoose models.
 * 
 * Safe to run repeatedly (idempotent).
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

// Import all models
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
const ContactMessage = require('../models/ContactMessage');
const EmailOtp = require('../models/EmailOtp');

const ALL_MODELS = [
  { name: 'User', model: User },
  { name: 'Vendor', model: Vendor },
  { name: 'Product', model: Product },
  { name: 'Order', model: Order },
  { name: 'CartItem', model: CartItem },
  { name: 'Address', model: Address },
  { name: 'AuditLog', model: AuditLog },
  { name: 'InventoryOperation', model: InventoryOperation },
  { name: 'Commission', model: Commission },
  { name: 'Dispute', model: Dispute },
  { name: 'Rating', model: Rating },
  { name: 'ContactMessage', model: ContactMessage },
  { name: 'EmailOtp', model: EmailOtp }
];

/**
 * Clean up obsolete or conflicting indexes and merge duplicate data safely.
 */
async function preIndexCleanup(db) {
  const cleanupReport = {
    droppedIndexes: [],
    mergedDuplicates: []
  };

  // 1. CartItem collection cleanup
  try {
    const cartCollection = db.collection('cartitems');
    const existingCartIndexes = await cartCollection.indexes().catch(() => []);

    // Check for obsolete legacy unique index: userId_1_productId_1
    const legacyCartIndex = existingCartIndexes.find(
      idx => idx.name === 'userId_1_productId_1' || 
             (idx.key && idx.key.userId === 1 && idx.key.productId === 1 && Object.keys(idx.key).length === 2 && idx.unique)
    );

    if (legacyCartIndex) {
      await cartCollection.dropIndex(legacyCartIndex.name);
      cleanupReport.droppedIndexes.push({
        collection: 'cartitems',
        index: legacyCartIndex.name,
        reason: 'Legacy unique index conflicts with product variant support'
      });
      console.log(`[Indexes] Dropped obsolete index '${legacyCartIndex.name}' from cartitems`);
    }

    // Merge duplicate cart rows for (userId, productId, variantId) without losing quantities
    const duplicateCartGroups = await cartCollection.aggregate([
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

    for (const group of duplicateCartGroups) {
      const [primaryId, ...duplicateIds] = group.ids;
      // Update primary cart item with the merged total quantity
      await cartCollection.updateOne(
        { _id: primaryId },
        { $set: { quantity: group.totalQty, variantId: group._id.variantId } }
      );
      // Remove only the merged duplicate document records
      if (duplicateIds.length > 0) {
        await cartCollection.deleteMany({ _id: { $in: duplicateIds } });
      }
      cleanupReport.mergedDuplicates.push({
        collection: 'cartitems',
        userId: group._id.userId,
        productId: group._id.productId,
        variantId: group._id.variantId,
        mergedCount: duplicateIds.length,
        finalQuantity: group.totalQty
      });
      console.log(`[Indexes] Merged ${group.count} duplicate cart items for user ${group._id.userId} into 1 (qty: ${group.totalQty})`);
    }
  } catch (err) {
    console.warn('[Indexes] Warning during cartitems pre-index cleanup:', err.message);
  }

  // 2. Vendor collection cleanup
  try {
    const vendorCollection = db.collection('vendors');
    const existingVendorIndexes = await vendorCollection.indexes().catch(() => []);

    // Check for legacy unique index on userId alone
    const legacyVendorIndex = existingVendorIndexes.find(
      idx => (idx.name === 'userId_1' || (idx.key && idx.key.userId === 1 && Object.keys(idx.key).length === 1)) && idx.unique
    );

    if (legacyVendorIndex) {
      await vendorCollection.dropIndex(legacyVendorIndex.name);
      cleanupReport.droppedIndexes.push({
        collection: 'vendors',
        index: legacyVendorIndex.name,
        reason: 'Legacy unique index prevented vendors from creating multiple shops'
      });
      console.log(`[Indexes] Dropped obsolete unique index '${legacyVendorIndex.name}' from vendors`);
    }
  } catch (err) {
    console.warn('[Indexes] Warning during vendors pre-index cleanup:', err.message);
  }

  return cleanupReport;
}

/**
 * Synchronize indexes across all models.
 */
async function syncAllIndexes(customMongoose = null) {
  const m = customMongoose || mongoose;
  let shouldCloseConnection = false;

  if (m.connection.readyState === 0) {
    const uri = (process.env.NODE_ENV === 'test' ? process.env.TEST_MONGODB_URI : null) || process.env.MONGODB_URI || process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/marketplace';
    await m.connect(uri);
    shouldCloseConnection = true;
    console.log(`[Indexes] Connected to MongoDB at: ${uri}`);
  }

  const db = m.connection.db;
  console.log('[Indexes] Running pre-index cleanup & conflict resolution...');
  const cleanupReport = await preIndexCleanup(db);

  console.log('[Indexes] Synchronizing model indexes via syncIndexes()...');
  const syncResults = [];

  for (const { name, model } of ALL_MODELS) {
    try {
      // syncIndexes ensures indexes defined in the schema exist and drops unmanaged indexes
      await model.syncIndexes();
      const currentIndexes = await model.collection.indexes().catch(() => []);
      syncResults.push({
        model: name,
        status: 'synced',
        indexCount: currentIndexes.length,
        indexes: currentIndexes.map(idx => idx.name)
      });
      console.log(`[Indexes] ✅ Synced ${name} (${currentIndexes.length} indexes)`);
    } catch (err) {
      console.error(`[Indexes] ❌ Failed to sync ${name}:`, err.message);
      syncResults.push({
        model: name,
        status: 'error',
        error: err.message
      });
      throw err;
    }
  }

  if (shouldCloseConnection) {
    await m.connection.close();
    console.log('[Indexes] Database connection closed.');
  }

  return {
    cleanupReport,
    syncResults
  };
}

if (require.main === module) {
  syncAllIndexes()
    .then(result => {
      console.log('\n=============================================');
      console.log('✅ All indexes synchronized successfully!');
      console.log(`Total models synced: ${result.syncResults.length}`);
      if (result.cleanupReport.droppedIndexes.length > 0) {
        console.log(`Dropped obsolete indexes: ${result.cleanupReport.droppedIndexes.length}`);
      }
      if (result.cleanupReport.mergedDuplicates.length > 0) {
        console.log(`Merged duplicate cart entries: ${result.cleanupReport.mergedDuplicates.length}`);
      }
      console.log('=============================================\n');
      process.exit(0);
    })
    .catch(err => {
      console.error('\n❌ Index synchronization failed:', err);
      process.exit(1);
    });
}

module.exports = {
  syncAllIndexes,
  preIndexCleanup,
  ALL_MODELS
};

