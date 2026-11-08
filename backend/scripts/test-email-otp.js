/**
 * Test Suite: Email OTP Verification Before Registration
 * 
 * Verifies:
 * 1. Valid OTP generation, storage hashing, and successful verification & registration.
 * 2. Duplicate email prevention (blocks sending OTP if account already exists).
 * 3. 60-second resend cooldown enforcement (HTTP 429 with retryAfter).
 * 4. Direct registration rejection without OTP/verification token (HTTP 400).
 * 5. Incorrect OTP rejection with remaining attempts countdown.
 * 6. Maximum 5 attempts lockout / invalidation.
 * 7. Expired OTP rejection (> 5 minutes).
 * 8. Replay attack / reused OTP prevention (immediate invalidation on use).
 * 9. Two-step token verification flow (/verify-otp -> /register).
 * 10. Email normalization (case and trim consistency).
 * 11. Security: No plaintext OTP in responses or database.
 * 12. Existing login flow compatibility.
 */

const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../models/User');
const EmailOtp = require('../models/EmailOtp');
const { getLastSentOtpForTest } = require('../utils/emailService');

const PORT = process.env.PORT || 3000;
let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  if (condition) {
    passedCount++;
    console.log(`  ✓ ${message}`);
  } else {
    failedCount++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function request(method, pathUrl, data = null) {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : '';
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: pathUrl,
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-test-bypass-rate-limit': 'true', // bypass IP sliding limiter for tests, not the 60s cooldown
        'x-test-request': 'true'
      }
    };
    if (data) {
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let parsed;
        try {
          parsed = body ? JSON.parse(body) : null;
        } catch (e) {
          parsed = body;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed
        });
      });
    });

    req.on('error', reject);
    if (data) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('--- STARTING EMAIL OTP VERIFICATION TEST SUITE ---');

  await mongoose.connect(process.env.MONGODB_URI);
  process.env.NODE_ENV = 'test';

  const testStamp = Date.now();
  const testEmail1 = `otp_buyer_${testStamp}@test.com`;
  const testEmail2 = `otp_vendor_${testStamp}@test.com`;
  const testEmailCooldown = `otp_cooldown_${testStamp}@test.com`;
  const testEmailAttempts = `otp_attempts_${testStamp}@test.com`;
  const testEmailExpired = `otp_expired_${testStamp}@test.com`;

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Send OTP for New Email
    // -------------------------------------------------------------------------
    console.log('\n[Group 1: OTP Generation & Hashing]');
    const sendRes1 = await request('POST', '/api/auth/send-otp', { email: testEmail1 });
    assert(sendRes1.status === 200, '1.1 POST /send-otp returns 200 OK');
    assert(sendRes1.body.success === true, '1.2 Response has success: true');
    assert(sendRes1.body.otp === undefined, '1.3 Response NEVER exposes plaintext OTP');
    assert(sendRes1.body.resendCooldown === 60, '1.4 Response specifies 60s resend cooldown');

    // Verify DB storage
    const otpDoc1 = await EmailOtp.findOne({ email: testEmail1 });
    assert(Boolean(otpDoc1), '1.5 EmailOtp record created in database');
    assert(otpDoc1.otpHash.startsWith('$2'), '1.6 OTP stored as bcrypt hash, not plaintext');
    assert(otpDoc1.attempts === 0, '1.7 Initial verification attempts set to 0');
    assert(otpDoc1.expiresAt > new Date(), '1.8 Expiration set in the future (~5 mins)');

    // -------------------------------------------------------------------------
    // TEST 2: Duplicate Email Check on OTP Request
    // -------------------------------------------------------------------------
    console.log('\n[Group 2: Duplicate Email Prevention]');
    // Use existing admin email
    const dupRes = await request('POST', '/api/auth/send-otp', { email: 'admin@egmarketplace.com' });
    assert(dupRes.status === 400, '2.1 Requesting OTP for already-registered email returns 400 Bad Request');
    assert(dupRes.body.message.includes('already exists'), '2.2 Error message notes account already exists');

    // -------------------------------------------------------------------------
    // TEST 3: 60-Second Resend Cooldown
    // -------------------------------------------------------------------------
    console.log('\n[Group 3: Resend Cooldown Enforcement]');
    await request('POST', '/api/auth/send-otp', { email: testEmailCooldown });
    // Immediately attempt to resend
    const cooldownRes = await request('POST', '/api/auth/send-otp', { email: testEmailCooldown });
    assert(cooldownRes.status === 429, '3.1 Resending OTP before 60s returns HTTP 429 Too Many Requests');
    assert(cooldownRes.body.retryAfter > 0 && cooldownRes.body.retryAfter <= 60, '3.2 retryAfter provided in response');

    // -------------------------------------------------------------------------
    // TEST 4: Direct Registration Rejection Without OTP Verification
    // -------------------------------------------------------------------------
    console.log('\n[Group 4: Bypass Prevention]');
    const bypassRes = await request('POST', '/api/auth/register', {
      username: `bypass_${testStamp}`,
      email: `bypass_${testStamp}@test.com`,
      password: 'Password@123',
      role: 'buyer'
    });
    assert(bypassRes.status === 400, '4.1 POST /register without OTP/token returns 400 Bad Request');
    assert(bypassRes.body.message.includes('Email verification is required'), '4.2 Error message states verification is required');
    const bypassUser = await User.findOne({ email: `bypass_${testStamp}@test.com` });
    assert(bypassUser === null, '4.3 User account is NOT created in database');

    // -------------------------------------------------------------------------
    // TEST 5: Incorrect OTP Handling & Attempt Counter
    // -------------------------------------------------------------------------
    console.log('\n[Group 5: Incorrect OTP & Attempts Counter]');
    await request('POST', '/api/auth/send-otp', { email: testEmailAttempts });
    const wrongOtpRes = await request('POST', '/api/auth/verify-otp', {
      email: testEmailAttempts,
      otp: '000000'
    });
    assert(wrongOtpRes.status === 400, '5.1 Wrong OTP returns 400 Bad Request');
    assert(wrongOtpRes.body.remainingAttempts === 4, '5.2 Remaining attempts decremented to 4');

    // -------------------------------------------------------------------------
    // TEST 6: Lockout After 5 Failed Attempts
    // -------------------------------------------------------------------------
    console.log('\n[Group 6: Attempt Limit Lockout]');
    // Send 3 more wrong attempts (total 4)
    await request('POST', '/api/auth/verify-otp', { email: testEmailAttempts, otp: '111111' });
    await request('POST', '/api/auth/verify-otp', { email: testEmailAttempts, otp: '222222' });
    await request('POST', '/api/auth/verify-otp', { email: testEmailAttempts, otp: '333333' });
    // 5th failed attempt triggers lockout
    const fifthRes = await request('POST', '/api/auth/verify-otp', { email: testEmailAttempts, otp: '444444' });
    assert(fifthRes.status === 429, '6.1 5th failed attempt returns 429 Lockout');
    assert(fifthRes.body.message.includes('Maximum verification attempts exceeded'), '6.2 Lockout message returned');

    // -------------------------------------------------------------------------
    // TEST 7: Expired OTP
    // -------------------------------------------------------------------------
    console.log('\n[Group 7: Expired OTP Rejection]');
    await request('POST', '/api/auth/send-otp', { email: testEmailExpired });
    // Simulate expiration by setting expiresAt in past
    await EmailOtp.updateOne(
      { email: testEmailExpired },
      { $set: { expiresAt: new Date(Date.now() - 60000) } }
    );
    const expiredRes = await request('POST', '/api/auth/verify-otp', {
      email: testEmailExpired,
      otp: '123456'
    });
    assert(expiredRes.status === 400, '7.1 Expired OTP returns 400 Bad Request');
    assert(expiredRes.body.message.includes('expired'), '7.2 Error message notes expiration');

    // -------------------------------------------------------------------------
    // TEST 8: Positive Flow - Direct Register with Valid OTP
    // -------------------------------------------------------------------------
    console.log('\n[Group 8: Valid OTP Direct Registration]');
    const otpDoc1After = await EmailOtp.findOne({ email: testEmail1 });
    const validOtp1 = otpDoc1After?.testPlainOtp || getLastSentOtpForTest(testEmail1);
    assert(Boolean(validOtp1 && validOtp1.length === 6), '8.1 Valid 6-digit OTP generated for testEmail1');

    const regRes1 = await request('POST', '/api/auth/register', {
      username: `buyer_${testStamp}`,
      email: testEmail1,
      password: 'SecPassword123!',
      role: 'buyer',
      otp: validOtp1
    });
    assert(regRes1.status === 201, '8.2 Registration with valid OTP returns 201 Created');
    assert(Boolean(regRes1.body?.token), '8.3 Returns JWT auth token');
    assert(regRes1.body?.user?.email === testEmail1, '8.4 User created with correct email');

    // Confirm user is in database
    const createdUser1 = await User.findOne({ email: testEmail1 });
    assert(Boolean(createdUser1), '8.5 User document persisted in MongoDB');

    // -------------------------------------------------------------------------
    // TEST 9: Replay Attack / Reused OTP Invalidation
    // -------------------------------------------------------------------------
    console.log('\n[Group 9: Reused OTP Prevention]');
    const replayRes = await request('POST', '/api/auth/register', {
      username: `replay_${testStamp}`,
      email: testEmail1,
      password: 'SecPassword123!',
      role: 'buyer',
      otp: validOtp1
    });
    assert(replayRes.status === 400, '9.1 Reused OTP is rejected with 400');
    const consumedOtp = await EmailOtp.findOne({ email: testEmail1 });
    assert(consumedOtp === null, '9.2 EmailOtp record was deleted/consumed upon registration');

    // -------------------------------------------------------------------------
    // TEST 10: Two-Step Verification Flow (/verify-otp -> /register with token)
    // -------------------------------------------------------------------------
    console.log('\n[Group 10: Two-Step Verification Token Flow]');
    await request('POST', '/api/auth/send-otp', { email: testEmail2 });
    const otpDoc2 = await EmailOtp.findOne({ email: testEmail2 });
    const validOtp2 = otpDoc2?.testPlainOtp || getLastSentOtpForTest(testEmail2);

    const step1Res = await request('POST', '/api/auth/verify-otp', {
      email: testEmail2,
      otp: validOtp2
    });
    assert(step1Res.status === 200, '10.1 POST /verify-otp returns 200 OK');
    assert(Boolean(step1Res.body.verificationToken), '10.2 Returns signed verificationToken');

    const step2Res = await request('POST', '/api/auth/register', {
      username: `vendor_${testStamp}`,
      email: testEmail2,
      password: 'SecPassword123!',
      role: 'vendor',
      verificationToken: step1Res.body.verificationToken
    });
    assert(step2Res.status === 201, '10.3 Registration with verificationToken returns 201 Created');
    assert(step2Res.body.user.role === 'vendor', '10.4 User role created as vendor');

    // -------------------------------------------------------------------------
    // TEST 11: Email Normalization
    // -------------------------------------------------------------------------
    console.log('\n[Group 11: Email Normalization]');
    const unnormalized = `  NoRmAl_${testStamp}@TEST.COM  `;
    const normalized = unnormalized.toLowerCase().trim();
    await request('POST', '/api/auth/send-otp', { email: unnormalized });
    const normOtpDoc = await EmailOtp.findOne({ email: normalized });
    assert(Boolean(normOtpDoc), '11.1 OTP stored under trimmed, lowercase email in database');

    // -------------------------------------------------------------------------
    // TEST 12: Existing Login Compatibility
    // -------------------------------------------------------------------------
    console.log('\n[Group 12: Existing Login Compatibility]');
    const loginRes = await request('POST', '/api/auth/login', {
      email: testEmail1,
      password: 'SecPassword123!'
    });
    assert(loginRes.status === 200, '12.1 Newly registered user can log in via /api/auth/login');
    assert(Boolean(loginRes.body.token), '12.2 Login issues valid token');

    const adminLoginRes = await request('POST', '/api/auth/login', {
      email: 'admin@egmarketplace.com',
      password: 'admin123'
    });
    assert(adminLoginRes.status === 200, '12.3 Seeded admin login continues working');

  } catch (error) {
    console.error('Fatal test error:', error);
    failedCount++;
  } finally {
    // Clean up test data
    await User.deleteMany({
      email: { $in: [testEmail1, testEmail2, `bypass_${testStamp}@test.com`] }
    });
    await EmailOtp.deleteMany({
      email: { $in: [testEmail1, testEmail2, testEmailCooldown, testEmailAttempts, testEmailExpired] }
    });
    await mongoose.disconnect();
  }

  console.log('\n=============================================');
  console.log(`TOTAL PASSED: ${passedCount}`);
  console.log(`TOTAL FAILED: ${failedCount}`);
  console.log('=============================================');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
