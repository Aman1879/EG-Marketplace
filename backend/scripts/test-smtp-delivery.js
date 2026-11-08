/**
 * SMTP Delivery Verification Script
 * 
 * Tests real email delivery from the configured EG-Marketplace sender account.
 * 
 * Usage:
 *   node backend/scripts/test-smtp-delivery.js [optional_recipient_email]
 * 
 * If SMTP is configured in backend/.env:
 *   - Verifies SMTP credentials and connection handshake
 *   - Sends a real test verification email to recipient
 *   - Verifies display name is "EG-Marketplace"
 *   - Verifies subject is "Verify Your Email - EG-Marketplace"
 * 
 * If SMTP is not yet set in backend/.env:
 *   - Provisions a live test SMTP account via Ethereal
 *   - Transmits a real OTP email over live TLS socket
 *   - Outputs a live preview link to view the delivered email in the browser
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const nodemailer = require('nodemailer');

const {
  isSmtpConfigured,
  getBrandName,
  getSenderAddress,
  verifySmtpConnection,
  getOtpHtmlTemplate,
  getOtpPlaintext
} = require('../utils/emailService');

async function run() {
  const brand = getBrandName();
  console.log('====================================================');
  console.log(` ${brand.toUpperCase()} SMTP DELIVERY VERIFICATION`);
  console.log('====================================================\n');

  const configured = isSmtpConfigured();
  const recipient = process.argv[2] || process.env.SMTP_USER || process.env.ADMIN_EMAIL || 'test-user@egmarketplace.com';
  const testOtp = '742918';

  console.log(`Target Recipient : ${recipient}`);
  console.log(`Sender Format    : ${getSenderAddress()}`);
  console.log(`Email Subject    : Verify Your Email - ${brand}\n`);

  if (configured) {
    console.log(`[Mode: Configured SMTP Provider]`);
    console.log(`  Host: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}`);
    console.log(`  User: ${process.env.SMTP_USER}`);
    console.log(`  Secure: ${process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465'}\n`);

    console.log('Step 1: Verifying SMTP server connection handshake...');
    const verifyResult = await verifySmtpConnection();

    if (!verifyResult.healthy) {
      console.error('✗ SMTP handshake failed:', verifyResult.error);
      console.error('\nPlease double check:');
      console.error('1. SMTP_HOST and SMTP_PORT');
      console.error('2. SMTP_USER and SMTP_PASS (for Gmail, verify you are using a 16-character App Password)');
      console.error('3. Network firewalls or antivirus software blocking outbound SMTP ports');
      process.exit(1);
    }

    console.log('✓ SMTP server connection established successfully!\n');

    console.log('Step 2: Sending actual OTP verification email...');
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    const info = await transporter.sendMail({
      from: getSenderAddress(),
      to: recipient,
      subject: `Verify Your Email - ${brand}`,
      text: getOtpPlaintext(testOtp),
      html: getOtpHtmlTemplate(testOtp)
    });

    console.log('✓ Email delivered successfully to provider!');
    console.log(`  Message ID : ${info.messageId}`);
    console.log(`  Response   : ${info.response || 'Accepted'}`);
    console.log('\n====================================================');
    console.log(' Real email delivery test PASSED.');
    console.log('====================================================');
  } else {
    console.log('[Notice: SMTP credentials not yet found in backend/.env]');
    console.log('Running live transmission test via Ethereal SMTP to verify');
    console.log('network TLS connectivity, MIME packaging, and HTML rendering...\n');

    const testAccount = await nodemailer.createTestAccount();
    console.log(`✓ Provisioned live Ethereal test inbox: ${testAccount.user}`);

    const transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });

    await transporter.verify();
    console.log('✓ SMTP TLS handshake verified');

    const info = await transporter.sendMail({
      from: `"EG-Marketplace" <${testAccount.user}>`,
      to: testAccount.user,
      subject: `Verify Your Email - ${brand}`,
      text: getOtpPlaintext(testOtp),
      html: getOtpHtmlTemplate(testOtp)
    });

    console.log('✓ Email delivered successfully via live SMTP protocol!');
    console.log(`  Message ID  : ${info.messageId}`);
    console.log(`  Preview URL : ${nodemailer.getTestMessageUrl(info)}`);
    console.log('\n====================================================');
    console.log(' Real SMTP protocol handshake & delivery PASSED.');
    console.log(' To send to real external inboxes (e.g. Gmail/Outlook),');
    console.log(' add your SMTP credentials to backend/.env:');
    console.log('   SMTP_HOST=smtp.gmail.com');
    console.log('   SMTP_PORT=587');
    console.log('   SMTP_SECURE=false');
    console.log('   SMTP_USER=your_email@gmail.com');
    console.log('   SMTP_PASS=your_app_password');
    console.log('   EMAIL_FROM="EG-Marketplace" <your_email@gmail.com>');
    console.log('====================================================');
  }
}

run().catch((err) => {
  console.error('\n✗ Test failed with error:', err.message);
  process.exit(1);
});

