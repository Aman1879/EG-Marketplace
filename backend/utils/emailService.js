/**
 * Email Service Module for EG Marketplace
 * 
 * Provides SMTP email delivery using Nodemailer with support for:
 * - Configurable SMTP transports via environment variables
 *   (SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, EMAIL_FROM)
 * - Sender display name: "EG-Marketplace"
 * - Email subject: "Verify Your Email - EG-Marketplace"
 * - Professional branded HTML email with orange theme
 * - Plain-text fallback
 * - Secure handling: Never exposes OTPs in responses or production logs
 * - Verifies SMTP configuration and delivery before confirming send
 */

const nodemailer = require('nodemailer');

// In-memory store for integration test assertions only (never active in production)
const testSentOtps = new Map();

/**
 * Checks if real SMTP credentials are provided in environment variables.
 */
function isSmtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}

/**
 * Returns brand display name (defaults to "SpotBazar" or derived from EMAIL_FROM)
 */
function getBrandName() {
  const rawFrom = (process.env.EMAIL_FROM || '').trim();
  const quoteMatch = rawFrom.match(/"([^"]+)"/);
  if (quoteMatch) return quoteMatch[1].trim();
  const angleMatch = rawFrom.match(/^([^<]+)</);
  if (angleMatch) return angleMatch[1].trim();
  return process.env.BRAND_NAME || 'SpotBazar';
}

/**
 * Returns formatted sender string with display name and configured email address.
 */
function getSenderAddress() {
  const rawFrom = (process.env.EMAIL_FROM || process.env.SMTP_USER || 'realspotbazar@gmail.com').trim();
  if (rawFrom.includes('<') && rawFrom.includes('>')) {
    return rawFrom;
  }
  const brand = getBrandName();
  return `"${brand}" <${rawFrom.replace(/"/g, '').trim()}>`;
}

/**
 * Creates and returns a Nodemailer transport instance based on current configuration.
 */
function createTransporter(customConfig = null) {
  if (customConfig) {
    return nodemailer.createTransport(customConfig);
  }

  if (!isSmtpConfigured()) {
    return null;
  }

  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const pass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass
    },
    connectionTimeout: 15000,
    greetingTimeout: 8000,
    socketTimeout: 15000
  });
}

/**
 * Verifies active SMTP connection configuration with the mail server.
 */
async function verifySmtpConnection(customConfig = null) {
  const transporter = createTransporter(customConfig);
  if (!transporter) {
    return {
      configured: false,
      message: 'SMTP credentials (SMTP_HOST, SMTP_USER, SMTP_PASS) are not configured in backend/.env'
    };
  }

  try {
    await transporter.verify();
    return {
      configured: true,
      healthy: true,
      sender: getSenderAddress(),
      message: 'SMTP connection established successfully.'
    };
  } catch (err) {
    return {
      configured: true,
      healthy: false,
      sender: getSenderAddress(),
      error: err.message
    };
  }
}

/**
 * Generates professional branded HTML for the OTP verification email.
 * @param {string} otp - The 6-digit OTP code
 * @param {string} brand - Brand display name (e.g. "SpotBazar")
 */
function getOtpHtmlTemplate(otp, brand = getBrandName()) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email - ${brand}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #ea580c 0%, #f97316 100%); padding: 32px 24px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 800; letter-spacing: -0.5px;">${brand.toUpperCase()}</h1>
              <p style="margin: 6px 0 0; color: #ffedd5; font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">Email Verification</p>
            </td>
          </tr>
          <!-- Content Body -->
          <tr>
            <td style="padding: 36px 32px;">
              <h2 style="margin: 0 0 12px; font-size: 20px; font-weight: 700; color: #0f172a;">Verify Your Email Address</h2>
              <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.6; color: #475569;">
                Thank you for registering with ${brand}. Please enter the 6-digit verification code below on the registration screen to complete your account setup:
              </p>
              
              <!-- OTP Box -->
              <div style="background-color: #fff7ed; border: 2px dashed #fdba74; border-radius: 12px; padding: 22px 20px; text-align: center; margin: 0 0 24px;">
                <span style="font-size: 38px; font-weight: 800; letter-spacing: 12px; color: #ea580c; font-family: 'SF Mono', Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; display: inline-block; margin-left: 12px;">
                  ${otp}
                </span>
                <p style="margin: 10px 0 0; font-size: 13px; color: #9a3412; font-weight: 600;">
                  ⏳ Valid for 5 minutes (One-time use)
                </p>
              </div>

              <!-- Security Warning Box -->
              <div style="background-color: #fef2f2; border: 1px solid #fee2e2; border-left: 4px solid #ef4444; border-radius: 8px; padding: 14px 16px; margin: 0 0 24px;">
                <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #991b1b;">
                  🔒 <strong>Security Warning:</strong> Never share this verification code with anyone. ${brand} staff will never call, message, or email you asking for your verification code. If you did not initiate this request, you can safely ignore this email.
                </p>
              </div>

              <p style="margin: 0; font-size: 13px; color: #64748b; line-height: 1.5;">
                Best regards,<br>
                <strong style="color: #334155;">The ${brand} Team</strong>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 32px; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #94a3b8;">
                &copy; ${new Date().getFullYear()} ${brand}. Crafted for authentic artisans and shoppers across India.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Generates plaintext fallback message for the OTP email.
 * @param {string} otp - The 6-digit OTP code
 * @param {string} brand - Brand display name (e.g. "SpotBazar")
 */
function getOtpPlaintext(otp, brand = getBrandName()) {
  return `Welcome to ${brand}!

Your 6-digit email verification code is: ${otp}

This code is valid for 5 minutes and can only be used once.

SECURITY WARNING:
Never share this verification code with anyone. ${brand} staff will never ask for your verification code. If you did not request this verification, you can safely ignore this email.

Best regards,
The ${brand} Team`;
}

/**
 * Sends a 6-digit OTP verification code to the target recipient.
 * @param {string} email - Normalized recipient email
 * @param {string} otp - 6-digit OTP
 * @returns {Promise<{ delivered: boolean, messageId?: string, simulated?: boolean }>}
 */
async function sendOtpEmail(email, otp) {
  const normalizedEmail = String(email).toLowerCase().trim();

  // Test mode: store OTP in memory for automated test assertions
  if (process.env.NODE_ENV === 'test') {
    testSentOtps.set(normalizedEmail, {
      otp,
      sentAt: new Date()
    });
  }

  const transporter = createTransporter();

  if (!transporter) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[EmailService] SMTP credentials are not configured in production environment.');
      throw new Error('Email service is not configured. Please contact platform administration.');
    }

    // In local development or test mode, record simulated delivery
    if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
      console.log(`[EmailService] SMTP credentials not set. Simulated OTP email delivery to: ${normalizedEmail}`);
    }

    return { delivered: false, simulated: true };
  }

  const brand = getBrandName();
  const sender = getSenderAddress();

  const mailOptions = {
    from: sender,
    to: normalizedEmail,
    subject: `Verify Your Email - ${brand}`,
    text: getOtpPlaintext(otp, brand),
    html: getOtpHtmlTemplate(otp, brand)
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    return { delivered: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[EmailService] Delivery failed to ${normalizedEmail}: ${err.message}`);
    throw new Error(`Email delivery failed: ${err.message}`);
  }
}

/**
 * Helper to retrieve the last sent OTP for an email during automated tests.
 * Only returns a value when NODE_ENV === 'test'.
 */
function getLastSentOtpForTest(email) {
  if (process.env.NODE_ENV !== 'test') return null;
  const normalizedEmail = String(email).toLowerCase().trim();
  const record = testSentOtps.get(normalizedEmail);
  return record ? record.otp : null;
}

/**
 * Clears the test OTP memory store.
 */
function clearTestOtps() {
  testSentOtps.clear();
}

module.exports = {
  isSmtpConfigured,
  getBrandName,
  getSenderAddress,
  verifySmtpConnection,
  createTransporter,
  sendOtpEmail,
  getOtpHtmlTemplate,
  getOtpPlaintext,
  getLastSentOtpForTest,
  clearTestOtps
};
