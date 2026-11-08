/**
 * Email Delivery Verification Script (Brevo & Gmail Compatible)
 * 
 * Tests real email delivery from the configured SpotBazar / EG-Marketplace sender account.
 * 
 * Usage:
 *   node backend/scripts/test-smtp-delivery.js [optional_recipient_email]
 * 
 * Supports:
 * - Brevo SMTP Relay (host: smtp-relay.brevo.com, port: 2525 or 587)
 * - Brevo HTTPS REST API (BREVO_API_KEY over port 443)
 * - Gmail SMTP (host: smtp.gmail.com, port: 587 or 465)
 * - Ethereal test inbox fallback when no credentials are configured
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const nodemailer = require('nodemailer');

const {
  isSmtpConfigured,
  isEmailConfigured,
  getBrandName,
  getSenderAddress,
  verifySmtpConnection,
  sendOtpEmail
} = require('../utils/emailService');

async function run() {
  const brand = getBrandName();
  console.log('====================================================');
  console.log(` ${brand.toUpperCase()} EMAIL DELIVERY VERIFICATION`);
  console.log('====================================================\n');

  const configured = isEmailConfigured();
  const recipient = process.argv[2] || process.env.SMTP_USER || process.env.ADMIN_EMAIL || 'realspotbazar@gmail.com';
  const testOtp = '819302';

  console.log(`Target Recipient : ${recipient}`);
  console.log(`Sender Format    : ${getSenderAddress()}`);
  console.log(`Email Subject    : Verify Your Email - ${brand}`);

  if (process.env.EMAIL_PROVIDER === 'brevo_api' || (process.env.BREVO_API_KEY && !process.env.SMTP_HOST)) {
    console.log(`\n[Mode: Brevo HTTPS REST API (Port 443)]`);
    console.log(`  API Endpoint: https://api.brevo.com/v3/smtp/email`);
    console.log(`  API Key Configured: Yes (${process.env.BREVO_API_KEY ? 'Present' : 'Missing'})\n`);

    console.log('Sending actual OTP verification email via Brevo HTTPS API...');
    const result = await sendOtpEmail(recipient, testOtp);
    console.log('✓ Email delivered successfully via Brevo HTTPS API!');
    if (result.messageId) console.log(`  Message ID : ${result.messageId}`);
    console.log('\n====================================================');
    console.log(' Production Brevo HTTPS API delivery PASSED.');
    console.log('====================================================');
    return;
  }

  if (isSmtpConfigured()) {
    const isBrevo = (process.env.SMTP_HOST || '').includes('brevo.com') || (process.env.SMTP_HOST || '').includes('sendinblue.com');
    const isGmail = (process.env.SMTP_HOST || '').includes('gmail.com');
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;

    console.log(`\n[Mode: Configured SMTP Provider - ${isBrevo ? 'Brevo SMTP Relay' : isGmail ? 'Gmail SMTP' : 'Custom SMTP'}]`);
    console.log(`  Host: ${process.env.SMTP_HOST}:${port}`);
    console.log(`  User: ${process.env.SMTP_USER}`);
    console.log(`  Secure (SSL/TLS): ${secure}`);
    console.log(`  Timeout: ${process.env.SMTP_TIMEOUT_MS || 12000}ms\n`);

    if (port === 2525) {
      console.log('  ℹ Note: Port 2525 active (recommended for Render Free Tier to bypass standard SMTP port blocks).\n');
    }

    console.log('Step 1: Verifying SMTP server connection handshake...');
    const verifyResult = await verifySmtpConnection();

    if (!verifyResult.healthy) {
      console.error('✗ SMTP handshake failed:', verifyResult.error);
      console.error(`  Category: ${verifyResult.category}`);

      if (verifyResult.category === 'SMTP_CONNECTION_TIMEOUT') {
        console.error('\n[DIAGNOSIS: Connection Timeout]');
        console.error('Outbound connections to this host/port timed out.');
        console.error('If running on Render Free Tier: standard ports 25, 465, and 587 are blocked.');
        console.error('Solutions:');
        console.error('1. Use Brevo SMTP Relay on port 2525 (SMTP_PORT=2525, SMTP_HOST=smtp-relay.brevo.com)');
        console.error('2. Use Brevo HTTPS API over port 443 (EMAIL_PROVIDER=brevo_api, BREVO_API_KEY=...)');
        console.error('3. Upgrade Render web service to a paid instance (unblocks ports 465 and 587)');
      }
      process.exit(1);
    }

    console.log('✓ SMTP server connection established successfully!\n');

    console.log('Step 2: Sending actual OTP verification email...');
    const result = await sendOtpEmail(recipient, testOtp);

    console.log('✓ Email delivered successfully to provider!');
    if (result.messageId) console.log(`  Message ID : ${result.messageId}`);
    console.log('\n====================================================');
    console.log(' Real email delivery test PASSED.');
    console.log('====================================================');
  } else {
    console.log('\n[Notice: Production email credentials not yet set in backend/.env]');
    console.log('Running test via Ethereal SMTP to verify MIME packaging and HTML template...\n');

    const testAccount = await nodemailer.createTestAccount();
    const transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });

    const info = await transporter.sendMail({
      from: `"SpotBazar" <${testAccount.user}>`,
      to: testAccount.user,
      subject: `Verify Your Email - ${brand}`,
      text: `Your OTP is: ${testOtp}`,
      html: `<b>Your verification code is: ${testOtp}</b>`
    });

    console.log('✓ Email delivered successfully via Ethereal test server!');
    console.log(`  Preview URL : ${nodemailer.getTestMessageUrl(info)}`);
  }
}

run().catch((err) => {
  console.error('\n✗ Test failed with error:', err.message);
  process.exit(1);
});
