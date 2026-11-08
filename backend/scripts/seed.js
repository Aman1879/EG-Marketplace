/**
 * Database Seed Script for EG-Marketplace
 * 
 * Creates representative seed data:
 * - Secure Admin User (configured via ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_USERNAME)
 * - 2 Approved Vendors with distinct shops
 * - 2 Demo Buyers with saved addresses
 * - Representative Products across categories with variants, SKUs, and stock
 * 
 * 100% Idempotent: Can be run repeatedly without creating duplicates.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../models/User');
const Vendor = require('../models/Vendor');
const Product = require('../models/Product');
const Address = require('../models/Address');

async function seedDatabase(customMongoose = null) {
  const m = customMongoose || mongoose;
  let shouldCloseConnection = false;

  if (m.connection.readyState === 0) {
    const uri = (process.env.NODE_ENV === 'test' ? process.env.TEST_MONGODB_URI : null) || process.env.MONGODB_URI || process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/marketplace';
    await m.connect(uri);
    shouldCloseConnection = true;
    console.log(`[Seed] Connected to MongoDB at: ${uri}`);
  }

  const report = {
    admin: null,
    vendors: [],
    buyers: [],
    addresses: [],
    products: []
  };

  // 1. Seed or Update Admin User
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@egmarketplace.com').toLowerCase().trim();
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@12345';

  let admin = await User.findOne({ $or: [{ email: adminEmail }, { username: adminUsername }] });
  const hashedAdminPassword = await bcrypt.hash(adminPassword, 10);

  if (admin) {
    admin.email = adminEmail;
    admin.username = adminUsername;
    admin.password = hashedAdminPassword;
    admin.role = 'admin';
    await admin.save();
    report.admin = { id: admin._id, email: admin.email, action: 'updated' };
    console.log(`[Seed] Admin user verified/updated: ${adminEmail}`);
  } else {
    admin = await User.create({
      username: adminUsername,
      email: adminEmail,
      password: hashedAdminPassword,
      role: 'admin'
    });
    report.admin = { id: admin._id, email: admin.email, action: 'created' };
    console.log(`[Seed] Admin user created: ${adminEmail}`);
  }

  // 2. Seed Demo Vendors
  const vendorConfigs = [
    {
      user: {
        username: 'apex_tech',
        email: 'vendor1@egmarketplace.com',
        password: 'Password@123',
        role: 'vendor'
      },
      shop: {
        shopName: 'Apex Audio & Gadgets',
        category: 'Electronics',
        categories: ['Electronics', 'Gadgets'],
        description: 'Premium high-fidelity audio equipment and cutting-edge personal gadgets.',
        contactEmail: 'support@apexaudio.com',
        contactPhone: '9876500001',
        approvalStatus: 'approved',
        onboardingComplete: true,
        razorpayAccountStatus: 'activated'
      }
    },
    {
      user: {
        username: 'velvet_thread',
        email: 'vendor2@egmarketplace.com',
        password: 'Password@123',
        role: 'vendor'
      },
      shop: {
        shopName: 'Velvet & Thread Apparel',
        category: 'Clothing',
        categories: ['Clothing', 'Accessories', 'Kitchenware', 'Books'],
        description: 'Artisanal eco-friendly fabrics, contemporary wardrobe essentials, and lifestyle goods.',
        contactEmail: 'hello@velvetandthread.com',
        contactPhone: '9876500002',
        approvalStatus: 'approved',
        onboardingComplete: true,
        razorpayAccountStatus: 'activated'
      }
    }
  ];

  const vendorEntities = [];

  for (const cfg of vendorConfigs) {
    let vendorUser = await User.findOne({ email: cfg.user.email });
    if (!vendorUser) {
      const hashedPassword = await bcrypt.hash(cfg.user.password, 10);
      vendorUser = await User.create({
        username: cfg.user.username,
        email: cfg.user.email,
        password: hashedPassword,
        role: 'vendor'
      });
      console.log(`[Seed] Created vendor user: ${cfg.user.email}`);
    } else {
      vendorUser.role = 'vendor';
      await vendorUser.save();
    }

    let vendor = await Vendor.findOne({ userId: vendorUser._id, shopName: cfg.shop.shopName });
    if (!vendor) {
      vendor = await Vendor.create({
        userId: vendorUser._id,
        ...cfg.shop
      });
      report.vendors.push({ id: vendor._id, shopName: vendor.shopName, action: 'created' });
      console.log(`[Seed] Created shop: ${cfg.shop.shopName}`);
    } else {
      Object.assign(vendor, cfg.shop);
      await vendor.save();
      report.vendors.push({ id: vendor._id, shopName: vendor.shopName, action: 'updated' });
    }
    vendorEntities.push({ user: vendorUser, vendor });
  }

  // 3. Seed Demo Buyers & Addresses
  const buyerConfigs = [
    {
      user: {
        username: 'rahul_sharma',
        email: 'buyer1@egmarketplace.com',
        password: 'Password@123',
        role: 'buyer'
      },
      addresses: [
        {
          fullName: 'Rahul Sharma',
          phone: '9876543210',
          addressLine1: 'Flat 402, Sunshine Heights',
          addressLine2: 'MG Road, Sector 14',
          landmark: 'Near Metro Station',
          city: 'Bengaluru',
          state: 'Karnataka',
          postalCode: '560001',
          isDefault: true
        },
        {
          fullName: 'Rahul Sharma (Office)',
          phone: '9876543210',
          addressLine1: 'Tech Park, Tower B, 5th Floor',
          addressLine2: 'Outer Ring Road',
          landmark: 'Near Marathahalli Bridge',
          city: 'Bengaluru',
          state: 'Karnataka',
          postalCode: '560103',
          isDefault: false
        }
      ]
    },
    {
      user: {
        username: 'priya_patel',
        email: 'buyer2@egmarketplace.com',
        password: 'Password@123',
        role: 'buyer'
      },
      addresses: [
        {
          fullName: 'Priya Patel',
          phone: '9123456789',
          addressLine1: 'B-12, Shanti Niketan Society',
          addressLine2: 'Navrangpura',
          landmark: 'Opposite University Campus',
          city: 'Ahmedabad',
          state: 'Gujarat',
          postalCode: '380009',
          isDefault: true
        }
      ]
    }
  ];

  for (const bCfg of buyerConfigs) {
    let buyer = await User.findOne({ email: bCfg.user.email });
    if (!buyer) {
      const hashedPassword = await bcrypt.hash(bCfg.user.password, 10);
      buyer = await User.create({
        username: bCfg.user.username,
        email: bCfg.user.email,
        password: hashedPassword,
        role: 'buyer'
      });
      report.buyers.push({ id: buyer._id, email: buyer.email, action: 'created' });
      console.log(`[Seed] Created buyer user: ${bCfg.user.email}`);
    } else {
      report.buyers.push({ id: buyer._id, email: buyer.email, action: 'exists' });
    }

    for (const addr of bCfg.addresses) {
      let existingAddr = await Address.findOne({
        userId: buyer._id,
        addressLine1: addr.addressLine1,
        postalCode: addr.postalCode
      });

      if (!existingAddr) {
        existingAddr = await Address.create({
          userId: buyer._id,
          ...addr
        });
        report.addresses.push({ id: existingAddr._id, fullName: addr.fullName, action: 'created' });
      } else {
        Object.assign(existingAddr, addr);
        await existingAddr.save();
        report.addresses.push({ id: existingAddr._id, fullName: addr.fullName, action: 'updated' });
      }
    }
  }

  // 4. Seed Representative Products with Variants & Stock
  const apexVendor = vendorEntities[0].vendor;
  const velvetVendor = vendorEntities[1].vendor;

  const productCatalog = [
    // Vendor 1: Electronics & Gadgets
    {
      vendorId: apexVendor._id,
      sku: 'SKU-APX-ANC01',
      title: 'SonicPro Wireless ANC Headphones',
      description: 'Active Noise Cancelling over-ear Bluetooth headphones with 40h battery life and studio-grade sound reproduction.',
      price: 4999,
      category: 'Electronics',
      imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800',
      images: [
        'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800',
        'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=800'
      ],
      variants: [
        { name: 'Midnight Black', sku: 'SKU-APX-ANC01-BLK', price: 4999, stock: 25, options: ['Color: Midnight Black'] },
        { name: 'Arctic Silver', sku: 'SKU-APX-ANC01-SLV', price: 5299, stock: 15, options: ['Color: Arctic Silver'] }
      ]
    },
    {
      vendorId: apexVendor._id,
      sku: 'SKU-APX-FIT02',
      title: 'PulseFit Smart Fitness Watch',
      description: 'Smartwatch featuring continuous heart rate, SpO2 tracking, sleep analysis, and GPS sports mode.',
      price: 2999,
      category: 'Gadgets',
      imageUrl: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800',
      images: ['https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800'],
      variants: [
        { name: '40mm Obsidian', sku: 'SKU-APX-FIT02-40M', price: 2999, stock: 30, options: ['Size: 40mm'] },
        { name: '44mm Slate Gray', sku: 'SKU-APX-FIT02-44M', price: 3499, stock: 20, options: ['Size: 44mm'] }
      ]
    },
    {
      vendorId: apexVendor._id,
      sku: 'SKU-APX-SPK03',
      title: 'BassBoom Portable Bluetooth Speaker',
      description: 'Rugged IPX7 waterproof wireless speaker delivering 360-degree punchy bass for outdoor adventures.',
      price: 1999,
      stock: 45,
      category: 'Electronics',
      imageUrl: 'https://images.unsplash.com/photo-1545454675-3531b543be5d?w=800',
      images: ['https://images.unsplash.com/photo-1545454675-3531b543be5d?w=800'],
      variants: []
    },
    {
      vendorId: apexVendor._id,
      sku: 'SKU-APX-LMP04',
      title: 'AuraGlow Minimalist Desk Lamp',
      description: 'Architectural aluminum LED desk lamp with touch dimming, 3 color temperatures, and Qi wireless charging pad.',
      price: 1499,
      category: 'Home Decor',
      imageUrl: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800',
      images: ['https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800'],
      variants: [
        { name: 'Matte White', sku: 'SKU-APX-LMP04-WHT', price: 1499, stock: 20, options: ['Finish: White'] },
        { name: 'Brushed Brass', sku: 'SKU-APX-LMP04-BRS', price: 1799, stock: 15, options: ['Finish: Brass'] }
      ]
    },

    // Vendor 2: Clothing, Kitchenware, Books
    {
      vendorId: velvetVendor._id,
      sku: 'SKU-VVT-TEE01',
      title: 'Organic Cotton Classic Crewneck T-Shirt',
      description: '100% GOTS certified organic combed cotton tee. Breathable, hypoallergenic, and ethically crafted.',
      price: 799,
      category: 'Clothing',
      imageUrl: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800',
      images: ['https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800'],
      variants: [
        { name: 'Small / White', sku: 'SKU-VVT-TEE01-S-WHT', price: 799, stock: 20, options: ['Size: S', 'Color: White'] },
        { name: 'Medium / Navy Blue', sku: 'SKU-VVT-TEE01-M-NVY', price: 799, stock: 35, options: ['Size: M', 'Color: Navy'] },
        { name: 'Large / Charcoal', sku: 'SKU-VVT-TEE01-L-CHR', price: 849, stock: 25, options: ['Size: L', 'Color: Charcoal'] }
      ]
    },
    {
      vendorId: velvetVendor._id,
      sku: 'SKU-VVT-JNS02',
      title: 'Tailored Raw Denim Jeans',
      description: 'Japanese selvedge raw denim jeans with a modern slim tapered fit and copper rivet hardware.',
      price: 2199,
      category: 'Clothing',
      imageUrl: 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=800',
      images: ['https://images.unsplash.com/photo-1542272604-787c3835535d?w=800'],
      variants: [
        { name: '30W x 32L', sku: 'SKU-VVT-JNS02-3032', price: 2199, stock: 15, options: ['Waist: 30', 'Length: 32'] },
        { name: '32W x 32L', sku: 'SKU-VVT-JNS02-3232', price: 2199, stock: 20, options: ['Waist: 32', 'Length: 32'] },
        { name: '34W x 32L', sku: 'SKU-VVT-JNS02-3432', price: 2299, stock: 15, options: ['Waist: 34', 'Length: 32'] }
      ]
    },
    {
      vendorId: velvetVendor._id,
      sku: 'SKU-VVT-MUG03',
      title: 'Handcrafted Artisan Ceramic Mug',
      description: 'Wheel-thrown stoneware ceramic coffee mug with durable reactive glaze finish. 350ml capacity.',
      price: 499,
      category: 'Kitchenware',
      imageUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800',
      images: ['https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800'],
      variants: [
        { name: 'Speckled Earth', sku: 'SKU-VVT-MUG03-EAR', price: 499, stock: 30, options: ['Glaze: Earth'] },
        { name: 'Ocean Glaze', sku: 'SKU-VVT-MUG03-OCN', price: 549, stock: 25, options: ['Glaze: Ocean'] }
      ]
    },
    {
      vendorId: velvetVendor._id,
      sku: 'SKU-VVT-SKL04',
      title: 'Pre-Seasoned Cast Iron Skillet 10-Inch',
      description: 'Heavy-duty cast iron pan with natural flaxseed oil seasoning. Superior heat retention for searing and baking.',
      price: 1699,
      stock: 30,
      category: 'Kitchenware',
      imageUrl: 'https://images.unsplash.com/photo-1584990347449-397a61d7634f?w=800',
      images: ['https://images.unsplash.com/photo-1584990347449-397a61d7634f?w=800'],
      variants: []
    },
    {
      vendorId: velvetVendor._id,
      sku: 'SKU-VVT-BOK05',
      title: 'The Architecture of Scalable Systems',
      description: 'Comprehensive engineering guide covering distributed systems, fault tolerance, transaction isolation, and database architecture.',
      price: 1199,
      stock: 40,
      category: 'Books',
      imageUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800',
      images: ['https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800'],
      variants: []
    }
  ];

  for (const item of productCatalog) {
    // If variants exist, calculate aggregate stock from variants
    const totalVariantStock = Array.isArray(item.variants) && item.variants.length > 0
      ? item.variants.reduce((acc, v) => acc + (v.stock || 0), 0)
      : (item.stock || 0);

    const productPayload = {
      ...item,
      stock: totalVariantStock
    };

    let existingProd = await Product.findOne({ sku: item.sku });
    if (!existingProd) {
      existingProd = await Product.create(productPayload);
      report.products.push({ id: existingProd._id, sku: item.sku, title: item.title, action: 'created' });
      console.log(`[Seed] Created product: [${item.sku}] ${item.title}`);
    } else {
      Object.assign(existingProd, productPayload);
      await existingProd.save();
      report.products.push({ id: existingProd._id, sku: item.sku, title: item.title, action: 'updated' });
    }
  }

  if (shouldCloseConnection) {
    await m.connection.close();
    console.log('[Seed] Database connection closed.');
  }

  return report;
}

if (require.main === module) {
  seedDatabase()
    .then(report => {
      console.log('\n=============================================');
      console.log('✅ Database seeded successfully!');
      console.log(`Admin User: ${report.admin.email} (${report.admin.action})`);
      console.log(`Vendors seeded/verified: ${report.vendors.length}`);
      console.log(`Buyers seeded/verified: ${report.buyers.length}`);
      console.log(`Addresses seeded/verified: ${report.addresses.length}`);
      console.log(`Products seeded/verified: ${report.products.length}`);
      console.log('=============================================\n');
      process.exit(0);
    })
    .catch(err => {
      console.error('\n❌ Database seeding failed:', err);
      process.exit(1);
    });
}

module.exports = {
  seedDatabase
};

