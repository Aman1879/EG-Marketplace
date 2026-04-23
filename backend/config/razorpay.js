const Razorpay = require('razorpay');

const razorpayKeyId = process.env.RAZORPAY_KEY_ID || '';
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || '';

const razorpay = new Razorpay({
  key_id: razorpayKeyId,
  key_secret: razorpayKeySecret
});

const hasRazorpayCredentials = Boolean(razorpayKeyId && razorpayKeySecret);

module.exports = {
  razorpay,
  razorpayKeyId,
  razorpayKeySecret,
  hasRazorpayCredentials
};
