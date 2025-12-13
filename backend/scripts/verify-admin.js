const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
require('dotenv').config();

const verifyAdmin = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/marketplace');
    console.log('Connected to MongoDB');

    const adminEmail = 'aman1234@egmarketplace.com';
    const adminPassword = 'Ara12345@';

    // Find user by email
    const user = await User.findOne({ email: adminEmail });
    
    if (!user) {
      console.log('❌ User not found with email:', adminEmail);
      console.log('Checking by username...');
      const userByUsername = await User.findOne({ username: 'Aman' });
      if (userByUsername) {
        console.log('Found user by username:', userByUsername.email);
        console.log('User role:', userByUsername.role);
      } else {
        console.log('❌ User not found by username either');
      }
    } else {
      console.log('✅ User found!');
      console.log('Email:', user.email);
      console.log('Username:', user.username);
      console.log('Role:', user.role);
      console.log('Password hash exists:', !!user.password);
      
      // Test password
      const isMatch = await bcrypt.compare(adminPassword, user.password);
      console.log('\nPassword verification:');
      console.log('Expected password:', adminPassword);
      console.log('Password matches:', isMatch);
      
      if (!isMatch) {
        console.log('\n⚠️  Password does not match! Updating password...');
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        user.password = hashedPassword;
        await user.save();
        console.log('✅ Password updated successfully!');
        
        // Verify again
        const isMatchAfter = await bcrypt.compare(adminPassword, user.password);
        console.log('Password matches after update:', isMatchAfter);
      }
    }

    await mongoose.connection.close();
    console.log('\nDatabase connection closed.');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

verifyAdmin();

