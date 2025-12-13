const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
require('dotenv').config();

const createAdmin = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/marketplace');
    console.log('Connected to MongoDB');

    // Admin credentials (you can change these)
    const adminEmail = process.env.ADMIN_EMAIL || 'aman1234@egmarketplace.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Ara12345@';
    const adminUsername = process.env.ADMIN_USERNAME || 'Aman';

    // Check if admin already exists
    const existingAdmin = await User.findOne({ 
      $or: [{ email: adminEmail }, { username: adminUsername }] 
    });

    if (existingAdmin) {
      if (existingAdmin.role === 'admin') {
        // Update password even if admin exists
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        existingAdmin.password = hashedPassword;
        await existingAdmin.save();
        console.log('Admin account already exists! Password updated.');
        console.log(`Email: ${adminEmail}`);
        console.log(`Username: ${adminUsername}`);
        console.log(`Password: ${adminPassword}`);
        console.log('You can log in with these credentials.');
      } else {
        // Update existing user to admin and set password
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        existingAdmin.role = 'admin';
        existingAdmin.password = hashedPassword;
        await existingAdmin.save();
        console.log('Existing user updated to admin role!');
        console.log(`Email: ${adminEmail}`);
        console.log(`Username: ${adminUsername}`);
        console.log(`Password: ${adminPassword}`);
      }
    } else {
      // Create new admin user
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      
      const admin = new User({
        username: adminUsername,
        email: adminEmail,
        password: hashedPassword,
        role: 'admin'
      });

      await admin.save();
      console.log('✅ Admin account created successfully!');
      console.log(`Email: ${adminEmail}`);
      console.log(`Username: ${adminUsername}`);
      console.log(`Password: ${adminPassword}`);
      console.log('\n⚠️  Please change the password after first login!');
    }

    await mongoose.connection.close();
    console.log('\nDatabase connection closed.');
  } catch (error) {
    console.error('Error creating admin:', error);
    process.exit(1);
  }
};

createAdmin();

