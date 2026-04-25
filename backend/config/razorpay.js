const Razorpay = require('razorpay');

const razorpayKeyId = process.env.RAZORPAY_KEY_ID || '';
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || '';
const hasRazorpayCredentials = Boolean(razorpayKeyId && razorpayKeySecret);

const razorpay = hasRazorpayCredentials
  ? new Razorpay({
      key_id: razorpayKeyId,
      key_secret: razorpayKeySecret
    })
  : null;

module.exports = {
  razorpay,
  razorpayKeyId,
  razorpayKeySecret,
  hasRazorpayCredentials
};
