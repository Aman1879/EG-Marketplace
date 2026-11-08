/**
 * Email Service Module for SpotBazar / EG-Marketplace
 * 
 * Provides flexible, cloud-compatible email delivery supporting:
 * 1. Brevo SMTP Relay (Port 2525 recommended for Render Free Tier to bypass firewall port blocks)
 * 2. Brevo HTTPS REST API (Port 443, zero SMTP port dependencies)
 * 3. Gmail SMTP (Ports 587 / 465, supported locally and on paid cloud tiers)
 * 4. Any standard RFC-compliant SMTP provider (Amazon SES, SendGrid, Mailgun, Postmark)
 * 
 * Security & Reliability:
 * - Never logs credentials, passwords, or plaintext OTP codes
 * - Enforces socket and connection timeouts (configurable via SMTP_TIMEOUT_MS)
 * - Safe error categorization for diagnostics (distinguishing connection timeouts from auth errors)
 * - Plaintext fallback included alongside responsive branded HTML email
 */

const https = require('https');
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
 * Checks if any production email delivery mechanism is configured (SMTP or Brevo API).
 */
function isEmailConfigured() {
  return Boolean(
    isSmtpConfigured() ||
    process.env.BREVO_API_KEY
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
 * Categorizes an email error into a standard safe diagnostic classification.
 */
function categorizeEmailError(err) {
  if (!err) return 'UNKNOWN_ERROR';
  const msg = (err.message || '').toLowerCase();
  const code = (err.code || '').toUpperCase();

  if (msg.includes('not configured')) return 'SMTP_NOT_CONFIGURED';
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || msg.includes('timeout') || msg.includes('greeting timeout') || msg.includes('connection timeout')) {
    return 'SMTP_CONNECTION_TIMEOUT';
  }
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH') {
    return 'SMTP_HOST_UNREACHABLE';
  }
  if (code === 'EAUTH' || err.responseCode === 535 || err.statusCode === 401 || msg.includes('invalid login') || msg.includes('badcredentials') || msg.includes('unauthorized') || msg.includes('username and password not accepted')) {
    return 'SMTP_AUTH_FAILED';
  }
  if (code === 'EENVELOPE' || err.responseCode === 550 || err.statusCode === 400 || msg.includes('recipient rejected')) {
    return 'SMTP_RECIPIENT_REJECTED';
  }
  return 'SMTP_DELIVERY_FAILED';
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
  const timeoutMs = parseInt(process.env.SMTP_TIMEOUT_MS || '12000', 10);

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass
    },
    connectionTimeout: timeoutMs,
    greetingTimeout: Math.min(timeoutMs, 8000),
    socketTimeout: timeoutMs
  });
}

/**
 * Sends email via Brevo's HTTPS REST API over port 443 (zero SMTP port restrictions).
 */
function sendViaBrevoApi(email, otp, apiKey = process.env.BREVO_API_KEY) {
  return new Promise((resolve, reject) => {
    if (!apiKey) {
      return reject(new Error('BREVO_API_KEY is not configured in environment variables.'));
    }

    const brand = getBrandName();
    const senderRaw = getSenderAddress();
    let senderEmail = process.env.SMTP_USER || 'realspotbazar@gmail.com';
    let senderName = brand;
    const match = senderRaw.match(/"([^"]+)"\s*<([^>]+)>/);
    if (match) {
      senderName = match[1];
      senderEmail = match[2];
    }

    const payload = JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email }],
      subject: `Verify Your Email - ${brand}`,
      htmlContent: getOtpHtmlTemplate(otp, brand),
      textContent: getOtpPlaintext(otp, brand)
    });

    const timeoutMs = parseInt(process.env.SMTP_TIMEOUT_MS || '12000', 10);
    const req = https.request({
      hostname: 'api.brevo.com',
      port: 443,
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'api-key': apiKey,
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: timeoutMs
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            resolve({ delivered: true, messageId: parsed.messageId });
          } catch {
            resolve({ delivered: true });
          }
        } else {
          const err = new Error(`Brevo API returned status ${res.statusCode}: ${data}`);
          err.statusCode = res.statusCode;
          reject(err);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      const err = new Error(`Brevo API connection timed out after ${timeoutMs}ms`);
      err.code = 'ETIMEDOUT';
      reject(err);
    });

    req.on('error', (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

/**
 * Verifies active SMTP connection configuration with the mail server.
 */
async function verifySmtpConnection(customConfig = null) {
  // If Brevo API is explicitly configured
  if (process.env.EMAIL_PROVIDER === 'brevo_api' || (process.env.BREVO_API_KEY && !process.env.SMTP_HOST)) {
    return {
      configured: true,
      healthy: Boolean(process.env.BREVO_API_KEY),
      provider: 'brevo_api',
      sender: getSenderAddress(),
      message: 'Brevo HTTPS API key configured (Port 443).'
    };
  }

  const transporter = createTransporter(customConfig);
  if (!transporter) {
    return {
      configured: false,
      message: 'Email service credentials (SMTP_HOST or BREVO_API_KEY) are not configured.'
    };
  }

  try {
    await transporter.verify();
    return {
      configured: true,
      healthy: true,
      provider: 'smtp',
      sender: getSenderAddress(),
      message: 'SMTP connection established successfully.'
    };
  } catch (err) {
    return {
      configured: true,
      healthy: false,
      provider: 'smtp',
      sender: getSenderAddress(),
      error: err.message,
      category: categorizeEmailError(err)
    };
  }
}

/**
 * Generates professional branded HTML for the OTP verification email.
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
 * Routes through Brevo REST API (if configured) or Nodemailer SMTP.
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

  // 1. Direct Brevo HTTP API (Port 443) if selected or if BREVO_API_KEY is supplied without SMTP_HOST
  if (process.env.EMAIL_PROVIDER === 'brevo_api' || (process.env.BREVO_API_KEY && !process.env.SMTP_HOST)) {
    try {
      return await sendViaBrevoApi(normalizedEmail, otp);
    } catch (apiErr) {
      const category = categorizeEmailError(apiErr);
      console.error(`[EmailService] Brevo API delivery failed to ${normalizedEmail} [${category}]: ${apiErr.message}`);
      const wrappedError = new Error(`Email delivery failed: ${apiErr.message}`);
      wrappedError.category = category;
      wrappedError.code = apiErr.code;
      throw wrappedError;
    }
  }

  // 2. SMTP Transport (Brevo SMTP Relay, Gmail, or any custom SMTP)
  const transporter = createTransporter();

  if (!transporter) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[EmailService] Neither SMTP credentials nor BREVO_API_KEY are configured in production environment.');
      const err = new Error('Email service is not configured. Please contact platform administration.');
      err.category = 'SMTP_NOT_CONFIGURED';
      err.code = 'ENOCONFIG';
      throw err;
    }

    if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
      console.log(`[EmailService] Email credentials not set. Simulated OTP email delivery to: ${normalizedEmail}`);
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
    const category = categorizeEmailError(err);
    console.error(`[EmailService] Delivery failed to ${normalizedEmail} [${category} / ${err.code || 'N/A'}]: ${err.message}`);
    const wrappedError = new Error(`Email delivery failed: ${err.message}`);
    wrappedError.category = category;
    wrappedError.code = err.code;
    wrappedError.responseCode = err.responseCode;
    throw wrappedError;
  }
}

/**
 * Helper to retrieve the last sent OTP for an email during automated tests.
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
  isEmailConfigured,
  getBrandName,
  getSenderAddress,
  verifySmtpConnection,
  createTransporter,
  categorizeEmailError,
  sendViaBrevoApi,
  sendOtpEmail,
  getOtpHtmlTemplate,
  getOtpPlaintext,
  getLastSentOtpForTest,
  clearTestOtps
};
