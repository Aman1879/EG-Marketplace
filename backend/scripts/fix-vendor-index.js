// Script to fix unique index on Vendor userId
// Run this once: node backend/scripts/fix-vendor-index.js

const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/marketplace';

async function fixVendorIndex() {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('Connected to MongoDB');
    
    const db = mongoose.connection.db;
    const collection = db.collection('vendors');
    
    // Get all indexes
    const indexes = await collection.indexes();
    console.log('Current indexes:', indexes);
    
    // Drop unique index on userId if it exists
    try {
      await collection.dropIndex('userId_1');
      console.log('Dropped unique index on userId');
    } catch (err) {
      if (err.code === 27) {
        console.log('Index userId_1 does not exist, skipping...');
      } else {
        console.error('Error dropping index:', err.message);
      }
    }
    
    // Create non-unique index on userId (for performance)
    try {
      await collection.createIndex({ userId: 1 }, { unique: false });
      console.log('Created non-unique index on userId');
    } catch (err) {
      console.error('Error creating index:', err.message);
    }
    
    // Verify indexes
    const newIndexes = await collection.indexes();
    console.log('Updated indexes:', newIndexes);
    
    console.log('Done! Vendors can now have multiple shops.');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixVendorIndex();

