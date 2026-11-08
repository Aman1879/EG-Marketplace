const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Vendor = require('../models/Vendor');
const EmailOtp = require('../models/EmailOtp');
const { authenticate } = require('../middleware/auth');
const { recordAuditLog } = require('../utils/auditLogger');
const { sendOtpEmail } = require('../utils/emailService');
const { otpLimiter } = require('../middleware/security');

const isProduction = process.env.NODE_ENV === 'production';
const authCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000
};

// Send Email OTP for Registration
router.post('/send-otp', otpLimiter, [
  body('email').trim().isEmail().withMessage('Please provide a valid email address')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const normalizedEmail = req.body.email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ message: 'An account with this email address already exists. Please log in.' });
    }

    // Check 60-second resend cooldown
    const existingOtp = await EmailOtp.findOne({ email: normalizedEmail });
    if (existingOtp && existingOtp.resendAvailableAt && existingOtp.resendAvailableAt > new Date()) {
      const waitSeconds = Math.max(1, Math.ceil((existingOtp.resendAvailableAt.getTime() - Date.now()) / 1000));
      return res.status(429).json({
        message: `Please wait ${waitSeconds} seconds before requesting a new verification code.`,
        retryAfter: waitSeconds
      });
    }

    // Generate cryptographically secure random 6-digit OTP (100000 - 999999)
    const otp = crypto.randomInt(100000, 1000000).toString();

    // Securely hash OTP before database storage (never store plaintext)
    const otpHash = await bcrypt.hash(otp, 10);

    // 5-minute expiration and 60-second resend cooldown
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const resendAvailableAt = new Date(Date.now() + 60 * 1000);

    const isTestRequest = process.env.NODE_ENV !== 'production' && req.headers['x-test-request'] === 'true';

    const updateData = {
      otpHash,
      attempts: 0,
      expiresAt,
      resendAvailableAt,
      verified: false,
      verifiedAt: null,
      verificationToken: null
    };

    if (isTestRequest) {
      updateData.testPlainOtp = otp;
    }

    // Attempt email delivery first; do not persist OTP if provider rejects delivery
    try {
      await sendOtpEmail(normalizedEmail, otp);
    } catch (deliveryError) {
      console.error(`[Auth] Email delivery rejected for ${normalizedEmail}: ${deliveryError.message}`);
      return res.status(502).json({
        message: 'Failed to deliver verification email. The email provider rejected delivery. Please verify your email address or try again later.'
      });
    }

    // Persist OTP record in database ONLY after email delivery succeeds
    await EmailOtp.findOneAndUpdate(
      { email: normalizedEmail },
      updateData,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await recordAuditLog({
      actorId: null,
      actorRole: 'anonymous',
      action: 'auth.otp_sent',
      resourceType: 'EmailOtp',
      resourceId: normalizedEmail,
      before: null,
      after: { email: normalizedEmail, expiresAt },
      metadata: { ip: req.ip }
    });

    // Never expose the OTP in response
    return res.status(200).json({
      success: true,
      message: 'Verification code sent to your email address.',
      expiresIn: 300,
      resendCooldown: 60
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to send verification code. Please try again.', error: error.message });
  }
});

// Verify Email OTP (Standalone check / Token issue)
router.post('/verify-otp', [
  body('email').trim().isEmail().withMessage('Please provide a valid email address'),
  body('otp').trim().isLength({ min: 6, max: 6 }).isNumeric().withMessage('Verification code must be 6 digits')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const normalizedEmail = req.body.email.toLowerCase().trim();
    const submittedOtp = req.body.otp.trim();

    const otpRecord = await EmailOtp.findOne({ email: normalizedEmail });
    if (!otpRecord || !otpRecord.expiresAt || otpRecord.expiresAt < new Date()) {
      if (otpRecord) await EmailOtp.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({ message: 'Verification code has expired or is invalid. Please request a new code.' });
    }

    // Limit to maximum 5 verification attempts
    if (otpRecord.attempts >= 5) {
      await EmailOtp.deleteOne({ _id: otpRecord._id });
      return res.status(429).json({ message: 'Maximum verification attempts exceeded. Please request a new verification code.' });
    }

    const isMatch = await bcrypt.compare(submittedOtp, otpRecord.otpHash);
    if (!isMatch) {
      otpRecord.attempts += 1;
      if (otpRecord.attempts >= 5) {
        await EmailOtp.deleteOne({ _id: otpRecord._id });
        return res.status(429).json({ message: 'Maximum verification attempts exceeded. Please request a new verification code.' });
      }
      await otpRecord.save();
      const remainingAttempts = 5 - otpRecord.attempts;
      return res.status(400).json({
        message: `Invalid verification code. ${remainingAttempts} ${remainingAttempts === 1 ? 'attempt' : 'attempts'} remaining.`,
        remainingAttempts
      });
    }

    // OTP matched - generate short-lived verification token
    const verificationToken = jwt.sign(
      { email: normalizedEmail, purpose: 'email_verification', otpId: otpRecord._id.toString() },
      process.env.JWT_SECRET || 'marketplace-secret-key-2025',
      { expiresIn: '10m' }
    );

    otpRecord.verified = true;
    otpRecord.verifiedAt = new Date();
    otpRecord.verificationToken = verificationToken;
    await otpRecord.save();

    return res.status(200).json({
      success: true,
      message: 'Email verified successfully.',
      verificationToken
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to verify code.', error: error.message });
  }
});

// Register
router.post('/register', [
  body('username').trim().isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
  body('email').isEmail().withMessage('Invalid email'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password, role, otp, verificationToken } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email: normalizedEmail }, { username: username.trim() }] });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // -------------------------------------------------------------------------
    // EMAIL OTP VERIFICATION ENFORCEMENT
    // -------------------------------------------------------------------------
    if (!otp && !verificationToken) {
      return res.status(400).json({
        message: 'Email verification is required before registration. Please verify your email with the OTP.'
      });
    }

    if (verificationToken) {
      // Flow 1: Pre-verified via /verify-otp
      try {
        const decoded = jwt.verify(verificationToken, process.env.JWT_SECRET || 'marketplace-secret-key-2025');
        if (decoded.email !== normalizedEmail || decoded.purpose !== 'email_verification') {
          return res.status(400).json({ message: 'Invalid verification token for this email address.' });
        }
      } catch (err) {
        return res.status(400).json({ message: 'Verification token has expired or is invalid. Please request a new code.' });
      }

      const validRecord = await EmailOtp.findOne({
        email: normalizedEmail,
        verified: true,
        verificationToken
      });

      if (!validRecord) {
        return res.status(400).json({ message: 'Verification token is invalid or has already been used. Please verify your email again.' });
      }

      // Invalidate immediately upon consumption so it cannot be reused
      await EmailOtp.deleteOne({ _id: validRecord._id });
    } else if (otp) {
      // Flow 2: Direct OTP submission in registration payload
      const otpRecord = await EmailOtp.findOne({ email: normalizedEmail });
      if (!otpRecord || !otpRecord.expiresAt || otpRecord.expiresAt < new Date()) {
        if (otpRecord) await EmailOtp.deleteOne({ _id: otpRecord._id });
        return res.status(400).json({ message: 'Verification code has expired or is invalid. Please request a new code.' });
      }

      if (otpRecord.attempts >= 5) {
        await EmailOtp.deleteOne({ _id: otpRecord._id });
        return res.status(429).json({ message: 'Maximum verification attempts exceeded. Please request a new verification code.' });
      }

      const isMatch = await bcrypt.compare(String(otp).trim(), otpRecord.otpHash);
      if (!isMatch) {
        otpRecord.attempts += 1;
        if (otpRecord.attempts >= 5) {
          await EmailOtp.deleteOne({ _id: otpRecord._id });
          return res.status(429).json({ message: 'Maximum verification attempts exceeded. Please request a new verification code.' });
        }
        await otpRecord.save();
        const remainingAttempts = 5 - otpRecord.attempts;
        return res.status(400).json({
          message: `Invalid verification code. ${remainingAttempts} ${remainingAttempts === 1 ? 'attempt' : 'attempts'} remaining.`,
          remainingAttempts
        });
      }

      // Invalidate immediately upon successful registration
      await EmailOtp.deleteOne({ _id: otpRecord._id });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = new User({
      username,
      email: normalizedEmail,
      password: hashedPassword,
      role: role === 'vendor' || role === 'seller' ? 'vendor' : 'buyer'
    });
    await user.save();

    await recordAuditLog({
      actorId: user._id,
      actorRole: user.role,
      action: 'user.register',
      resourceType: 'User',
      resourceId: user._id.toString(),
      before: null,
      after: { username: user.username, email: user.email, role: user.role },
      metadata: { ip: req.ip }
    });

    // Generate token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'marketplace-secret-key-2025', { expiresIn: '7d' });

    // Set cookie for immediate login
    res.cookie('token', token, authCookieOptions);

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'User already exists' });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Login
router.post('/login', [
  body('email').isEmail().withMessage('Invalid email'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Fetch vendor profile if applicable
    let vendorProfile = null;
    if (user.role === 'vendor') {
      vendorProfile = await Vendor.findOne({ userId: user._id });
    }

    // Generate token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'marketplace-secret-key-2025', { expiresIn: '7d' });

    // Set cookie
    res.cookie('token', token, authCookieOptions);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role
      },
      vendorProfile
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get current user
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    let vendorProfile = null;

    if (user.role === 'vendor') {
      vendorProfile = await Vendor.findOne({ userId: user._id });
    }

    res.json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role
      },
      vendorProfile
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax'
  });
  res.json({ message: 'Logout successful' });
});

module.exports = router;

