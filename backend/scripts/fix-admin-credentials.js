const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
require('dotenv').config();

const fixAdminCredentials = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/marketplace');
    console.log('Connected to MongoDB');

    // Find user by username
    const user = await User.findOne({ username: 'Aman' });
    
    if (!user) {
      console.log('❌ User not found!');
      await mongoose.connection.close();
      return;
    }

    console.log('✅ User found!');
    console.log('Current email:', user.email);
    console.log('Current username:', user.username);
    console.log('Current role:', user.role);

    // Update email and password
    const newEmail = 'aman1234@egmarketplace.com';
    const newPassword = 'Ara12345@';
    
    // Check if new email already exists for another user
    const emailExists = await User.findOne({ 
      email: newEmail,
      _id: { $ne: user._id }
    });
    
    if (emailExists) {
      console.log('❌ Email already exists for another user!');
      await mongoose.connection.close();
      return;
    }

    // Update email, password, and ensure role is admin
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.email = newEmail;
    user.password = hashedPassword;
    user.role = 'admin';
    
    await user.save();
    
    console.log('\n✅ Credentials updated successfully!');
    console.log('New email:', user.email);
    console.log('Username:', user.username);
    console.log('Password:', newPassword);
    console.log('Role:', user.role);
    
    // Verify password
    const isMatch = await bcrypt.compare(newPassword, user.password);
    console.log('\nPassword verification:', isMatch ? '✅ Match' : '❌ No match');

    await mongoose.connection.close();
    console.log('\nDatabase connection closed.');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

fixAdminCredentials();

