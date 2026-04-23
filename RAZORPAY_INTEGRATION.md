# Razorpay Marketplace Payment Integration Guide

This guide explains how to set up and use Razorpay payment gateway with vendor payout splits in your EG Marketplace.

---

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Setup Instructions](#setup-instructions)
4. [Buyer Payment Flow](#buyer-payment-flow)
5. [Vendor Onboarding](#vendor-onboarding)
6. [Testing](#testing)
7. [Troubleshooting](#troubleshooting)
8. [API Reference](#api-reference)

---

## Overview

This integration enables:
- **Buyers** to pay via Razorpay (auto-payment required)
- **Automatic commission split**: Admin gets 10%, vendor gets 90%
- **Vendor payouts** via Razorpay Route linked accounts
- **UPI support** for vendors
- **Webhook handling** for real-time payment updates
- **Refund management** by admins

### Key Features
- ✅ Secure payment verification with signatures
- ✅ Automatic inventory deduction after successful payment
- ✅ Vendor earnings tracking & payout dashboard
- ✅ Real-time payment status updates via Socket.IO
- ✅ Test mode (no real transactions) & Live mode support
- ✅ Refund API for admins
- ✅ KYC tracking for vendors

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         BUYER FLOW                           │
├─────────────────────────────────────────────────────────────┤
│ 1. Buyer adds items to cart                                 │
│ 2. Checkout → Razorpay order created (POST /orders/create…) │
│ 3. Razorpay Checkout opens (JavaScript SDK)                 │
│ 4. Buyer pays via card/UPI/wallet                           │
│ 5. Payment returned to browser with signature               │
│ 6. Browser verifies & sends to backend (POST /orders/verify)│
│ 7. Backend validates signature, deducts inventory           │
│ 8. Backend transfers vendor split → Razorpay Route          │
│ 9. Order marked as PAID, commission recorded                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   VENDOR ONBOARDING                          │
├─────────────────────────────────────────────────────────────┤
│ 1. Vendor creates shop (VendorCreateShop.jsx)               │
│ 2. Vendor goes to /vendor/earnings                          │
│ 3. Fills bank details + UPI ID (VendorEarnings.jsx)         │
│ 4. Backend creates Razorpay Route account (POST /razorpay…) │
│ 5. KYC status tracked & can be verified in Razorpay        │
│ 6. Orders now split → vendor's linked account              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   MONEY FLOW (₹ per order)                   │
├─────────────────────────────────────────────────────────────┤
│ Order Total: ₹1000                                          │
│   ├─ Admin Commission (10%): ₹100 → stays in main account  │
│   └─ Vendor Share (90%): ₹900 → transfers to vendor account │
│                                                              │
│ Razorpay → Admin Account ← Payment from Buyer              │
│             ├─ Deducts Commission (₹100)                    │
│             └─ Transfer to Vendor (₹900)                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Setup Instructions

### Step 1: Create Razorpay Account

1. Go to [Razorpay Dashboard](https://dashboard.razorpay.com)
2. Sign up or log in
3. Complete profile & KYC verification
4. Wait for activation (usually 1-2 hours)

### Step 2: Get API Keys

1. Open **Settings → API Keys** in Razorpay Dashboard
2. Copy from **Test Mode** section:
   - **Key ID** (public key)
   - **Key Secret** (secret key)
3. Later, switch to **Live Mode** for production

### Step 3: Update Backend Environment

Create/update `.env` in `backend/`:

```bash
# Copy from backend/ENV_EXAMPLE.md
NODE_ENV=development
RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXXXXXX
RAZORPAY_KEY_SECRET=XXXXXXXXXXXXXXXXXXX
RAZORPAY_WEBHOOK_SECRET=webhook_secret_abc123
ADMIN_COMMISSION_RATE=0.10
```

### Step 4: Install Dependencies

```bash
cd backend
npm install razorpay
# ✅ razorpay v2.9.6+ already in package.json
```

### Step 5: Set Up Webhooks (Optional but Recommended)

For real-time payment updates via webhooks:

1. In Razorpay Dashboard, go to **Settings → Webhooks**
2. Click **Add New Webhook**
3. Set Webhook URL: `https://yourdomain.com/api/orders/webhook/razorpay`
4. Select Events:
   - `payment.captured`
   - `payment.failed`
   - `refund.processed`
5. Copy the **Signing Secret** → Add to `.env` as `RAZORPAY_WEBHOOK_SECRET`

### Step 6: Start Server

```bash
cd backend
npm start
# ✅ Server runs on port 3000
```

### Step 7: Start Frontend

```bash
cd frontend
npm run dev
# ✅ Frontend runs on port 5173
```

---

## Buyer Payment Flow

### Step 1: Add to Cart
- Buyer browses products
- Adds items to cart
- Cart stored in AuthContext

### Step 2: Checkout Page
- Buyer clicks "Proceed to Checkout"
- Fills shipping address
- Clicks "Proceed to Payment"

### Step 3: Backend Creates Order
**Endpoint:** `POST /api/orders/create-razorpay-order`

```javascript
Request: {
  products: [{ productId: "xyz", quantity: 2 }],
  shippingAddress: "123 Street, City..."
}

Response: {
  orderId: "order_123",
  razorpayOrder: { id: "order_razorpay_123", ... },
  key: "rzp_test_abc123",
  amount: 1000,
  currency: "INR",
  vendorEarning: 900,
  adminCommission: 100
}
```

### Step 4: Razorpay Checkout Opens
- Frontend loads Razorpay SDK
- Displays payment modal
- Buyer enters card/UPI details

### Step 5: Verify Payment
**Endpoint:** `POST /api/orders/verify-payment`

```javascript
Request: {
  orderId: "order_123",
  razorpay_order_id: "order_razorpay_123",
  razorpay_payment_id: "pay_abc123",
  razorpay_signature: "signature_hash"
}

Actions on backend:
1. Verify Razorpay signature
2. Deduct inventory for all products
3. Create vendor transfer (₹900)
4. Mark order as PAID
5. Record commission (₹100)
6. Update vendor earnings
7. Emit socket event for real-time updates

Response: {
  message: "Payment verified and transfer initiated",
  order: { _id, paymentStatus: "paid", transferStatus: "queued", ... }
}
```

### Step 6: Order Confirmation
- Success message shown
- Cart cleared
- Redirect to Order History
- Vendor receives notification (Socket.IO)

---

## Vendor Onboarding

### Step 1: Create Shop
1. Go to `/vendor/create-shop`
2. Fill shop details (name, logo, category, etc.)
3. Save shop

### Step 2: Go to Earnings Dashboard
1. Click "Earnings & Payouts" (link in vendor nav)
2. Or go to `/vendor/earnings`

### Step 3: Add Payout Details
1. Click "Set Up Payouts" button
2. Fill bank details:
   - **Account Holder Name**: Your name
   - **Account Number**: Your bank account
   - **IFSC Code**: Your bank's IFSC (e.g., SBIN0001234)
   - **Bank Name**: e.g., State Bank of India
   - **Beneficiary Name**: Recipient name
   - **UPI ID** (optional): e.g., yourname@upi

3. Click "Save & Create Razorpay Account"
4. Backend creates Razorpay Route account linked to your bank

### Step 4: Verify KYC in Razorpay
- Later, Razorpay may ask vendor to complete KYC on their dashboard
- Status updates in real-time
- Once verified, vendor is "activated"

### Step 5: Receive Payouts
- Orders are processed
- Vendor share transferred automatically to linked account
- Earnings dashboard shows real-time balance
- Vendor can withdraw from Razorpay to their bank account

---

## Testing

### Test with Razorpay Test Keys

Use these test card details (in test mode, real cards won't charge):

**Successful Payment:**
- Card: `4111 1111 1111 1111`
- Expiry: Any future date
- CVV: Any 3 digits
- Result: ✅ Payment captured

**Failed Payment:**
- Card: `4000 0000 0000 0077`
- Expiry: Any future date
- CVV: Any 3 digits
- Result: ❌ Payment declined

### Test Flow

1. **Sign up as buyer**
   ```bash
   Email: buyer@test.com
   Password: Test@123
   Role: Buyer
   ```

2. **Sign up as vendor**
   ```bash
   Email: vendor@test.com
   Password: Test@123
   Role: Vendor
   ```

3. **Vendor: Create shop + add payout**
   - Go to `/vendor/create-shop`
   - Fill details, save
   - Go to `/vendor/earnings`
   - Click "Set Up Payouts"
   - Fill test bank details (see below)
   - Save

4. **Vendor: Add products**
   - In vendor dashboard, add test products
   - Set price: ₹1000

5. **Buyer: Purchase product**
   - Add product to cart
   - Go to checkout
   - Fill address
   - Click "Proceed to Payment"
   - Use test card: `4111 1111 1111 1111`
   - Complete payment

6. **Verify:**
   - Order status should be "paid"
   - Vendor earnings should show ₹900
   - Vendor payout status should show "queued" or "processed"

### Test Bank Details
Use any valid IFSC code (search "IFSC Code" online), e.g.:
- Bank: State Bank of India
- IFSC: `SBIN0001234`
- Account: `1234567890123456`
- Holder: `John Doe`

---

## Architecture & Troubleshooting

### Common Issues

#### 1. "Razorpay credentials are not configured"
**Cause:** Missing `RAZORPAY_KEY_ID` or `RAZORPAY_KEY_SECRET` in `.env`

**Fix:**
```bash
# In backend/.env
RAZORPAY_KEY_ID=rzp_test_abc123
RAZORPAY_KEY_SECRET=test_secret_123
```

#### 2. "Vendor is not onboarded for Razorpay Route payouts"
**Cause:** Vendor tried to purchase but hasn't set up payout account

**Fix:**
- Vendor must go to `/vendor/earnings`
- Click "Set Up Payouts"
- Complete payout setup before orders can be placed

#### 3. "Payment verification failed (invalid signature)"
**Cause:** Signature validation failed due to mismatch

**Fix:**
- Ensure `RAZORPAY_KEY_SECRET` is correct
- Check frontend is receiving correct `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`
- Verify Razorpay SDK loaded correctly

#### 4. Order stuck in "created" state, transfer not initiated
**Cause:** Transfer API call failed (vendor account issues)

**Check:**
- Vendor has Razorpay account created (`razorpayAccountId` not empty)
- Vendor account is "activated" or at least "created"
- Transfer amount is valid (check `order.vendorEarning`)

#### 5. Inventory not deducted after payment
**Cause:** Payment verification endpoint was called but stock already reduced

**Check:**
- Verify payment only once (idempotent design)
- Stock is deducted in `verify-payment` only if `paymentStatus !== 'paid'`

### Debug Mode

Enable backend logging by setting:

```bash
NODE_ENV=development  # Verbose output
DEBUG=true            # Add if you want extra logs
```

Monitor order status in MongoDB:

```javascript
// In MongoDB shell or Mongoose CLI
db.orders.findOne({ _id: ObjectId("...") }, {
  _id: 1,
  paymentStatus: 1,
  transferStatus: 1,
  razorpayOrderId: 1,
  razorpayPaymentId: 1,
  failureReason: 1
})
```

---

## API Reference

### Orders API

#### Create Razorpay Order
```
POST /api/orders/create-razorpay-order
Auth: Required (buyer)

Request Body:
{
  products: [
    { productId: "string", quantity: number }
  ],
  shippingAddress: "string"
}

Response:
{
  key: "rzp_test_...",
  orderId: "ObjectId",
  amount: number,
  currency: "INR",
  vendorEarning: number,
  adminCommission: number,
  razorpayOrder: { id, amount, currency, ... }
}
```

#### Verify Payment
```
POST /api/orders/verify-payment
Auth: Required (buyer)

Request Body:
{
  orderId: "string",
  razorpay_order_id: "string",
  razorpay_payment_id: "string",
  razorpay_signature: "string"
}

Response:
{
  message: "Payment verified...",
  order: { _id, paymentStatus: "paid", transferId: "...", ... }
}
```

#### Razorpay Webhook
```
POST /api/orders/webhook/razorpay
Headers:
  x-razorpay-signature: "hash"

Body: Raw JSON from Razorpay
```

#### Refund Order (Admin)
```
PUT /api/orders/:id/refund
Auth: Required (admin)

Request Body:
{
  amount: number (optional, defaults to full refund),
  reason: "string"
}

Response:
{
  message: "Refund initiated successfully",
  order: {...},
  refund: {...}
}
```

### Vendors API

#### Create Linked Account
```
POST /api/vendors/:id/razorpay/linked-account
Auth: Required (vendor)

Request Body (optional):
{
  bankDetails: {
    accountNumber: "string",
    ifscCode: "string",
    accountHolderName: "string",
    beneficiaryName: "string",
    bankName: "string"
  }
}

Response:
{
  message: "Vendor linked account created successfully",
  razorpayAccountId: "acc_...",
  razorpayAccountStatus: "created|activated",
  kycStatus: "pending|verified"
}
```

#### Update Payout Settings
```
PUT /api/vendors/:id/payout-settings
Auth: Required (vendor)

Request Body:
{
  upiId: "string",
  accountHolderName: "string",
  accountNumber: "string",
  ifscCode: "string",
  bankName: "string",
  beneficiaryName: "string",
  autoCreateLinkedAccount: boolean
}

Response:
{
  message: "Payout settings updated",
  vendor: { _id, payoutDetails, razorpayAccountId, ... }
}
```

#### Get Payout Settings
```
GET /api/vendors/:id/payout-settings
Auth: Required (vendor)

Response:
{
  _id: "ObjectId",
  shopName: "string",
  upiId: "string",
  payoutDetails: { accountHolderName, accountNumberLast4, ... },
  razorpayAccountId: "acc_...",
  razorpayAccountStatus: "not_created|created|activated",
  kycStatus: "not_submitted|pending|verified|rejected",
  totalEarnings: number,
  totalPaidEarnings: number,
  paidOrdersCount: number
}
```

#### Earnings Summary
```
GET /api/vendors/my/earnings-summary
Auth: Required (vendor)

Response: [
  {
    vendorId: "ObjectId",
    shopName: "string",
    paidOrdersCount: number,
    totalPaidEarnings: number,
    totalEarnings: number,
    totalOrderVolume: number,
    totalCommissionPaid: number,
    razorpayAccountStatus: "string",
    kycStatus: "string"
  }
]
```

---

## Production Deployment

### Pre-Deployment Checklist

- [ ] Switched Razorpay to Live Mode
- [ ] Updated `.env` with live `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`
- [ ] Configured webhook URL to production domain
- [ ] Updated `RAZORPAY_WEBHOOK_SECRET`
- [ ] Set `NODE_ENV=production`
- [ ] Updated `FRONTEND_URL` to production domain
- [ ] Enabled HTTPS on frontend and backend
- [ ] Database backups configured
- [ ] Error logging/monitoring set up (Sentry, etc.)
- [ ] Rate limiting configured on APIs
- [ ] Admin account secured with strong password

### Environment Variables (Production)

```bash
NODE_ENV=production

MONGODB_URI=mongodb+srv://user:pass@cluster/db
PORT=3000

JWT_SECRET=<generate-strong-random-string>
SESSION_SECRET=<generate-strong-random-string>

FRONTEND_URL=https://yourdomain.com

RAZORPAY_KEY_ID=rzp_live_XXXXXXXXXXXXXXXX
RAZORPAY_KEY_SECRET=<live-secret-key>
RAZORPAY_WEBHOOK_SECRET=<webhook-secret>

ADMIN_COMMISSION_RATE=0.10
```

### Monitoring & Support

- Enable Razorpay webhooks for real-time payment updates
- Monitor order failures in logs
- Use Razorpay Dashboard for payment analytics
- Set up alerts for failed transfers

---

## Support

For issues:
1. Check the **Troubleshooting** section above
2. Review Razorpay docs: https://razorpay.com/docs
3. Check order & vendor documents in MongoDB
4. Enable debug logging and check server logs

---

**Integration Status:** ✅ Complete and Production-Ready
