# Backend Environment Variables

Copy this file to `.env` and fill in your actual values.

## Basic Configuration
```
NODE_ENV=development
PORT=3000
```

## Database
```
MONGODB_URI=mongodb://localhost:27017/marketplace
# OR for cloud MongoDB:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/marketplace?retryWrites=true&w=majority
```

## Authentication
```
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
SESSION_SECRET=your-session-secret-change-this-in-production
```

## Frontend URL (for CORS)
```
FRONTEND_URL=http://localhost:5173
# Or allow multiple origins (comma-separated):
# FRONTEND_URLS=http://localhost:5173,https://egmarketplace.netlify.app
# Emergency switch (not recommended for production):
# CORS_ALLOW_ALL=false
# In production:
# FRONTEND_URL=https://yourdomain.com
```

### Render Production Example
If your frontend is hosted on Netlify/Vercel and backend is on Render, use one of these:
```
NODE_ENV=production

MONGODB_URI=your_render_or_atlas_mongodb_uri
JWT_SECRET=your_strong_jwt_secret
SESSION_SECRET=your_strong_session_secret

FRONTEND_URLS=https://your-frontend-domain.com,https://egmarketplace.netlify.app

RAZORPAY_KEY_ID=rzp_live_or_test_key_id
RAZORPAY_KEY_SECRET=your_razorpay_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret

ADMIN_COMMISSION_RATE=0.10
```

Important:
- Add the exact frontend domain(s) in `FRONTEND_URLS`.
- Do not use `CORS_ALLOW_ALL=true` in production.
- Render will provide `PORT` automatically; do not hardcode it.
- On the frontend host, set `VITE_API_URL` to your Render backend URL if it is not the default Render URL used in the app.

## Razorpay Payment Gateway (REQUIRED for payment flow)
```
# Get these from https://dashboard.razorpay.com/app/settings/api-keys
RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXXXXXX
RAZORPAY_KEY_SECRET=XXXXXXXXXXXXXXXXXXX

# Webhook secret for validating Razorpay events
# Set this in Razorpay Dashboard > Settings > Webhooks
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_from_razorpay
```

## Commission Configuration
```
# Percentage of each order that goes to platform (0.10 = 10%)
# Remaining goes to vendor (0.90 = 90%)
ADMIN_COMMISSION_RATE=0.10
```

## Optional: Admin Account
```
# Pre-seed an admin account on server start (if needed)
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@marketplace.com
ADMIN_PASSWORD=securepassword123
```

---

## Getting Razorpay Credentials

### Step 1: Create Account
1. Go to [Razorpay Dashboard](https://dashboard.razorpay.com)
2. Sign up or log in with your account
3. Complete KYC verification

### Step 2: Get API Keys
1. Navigate to **Settings → API Keys** (or **Integrations → API Keys**)
2. Copy **Key ID** and **Key Secret** from the Test Mode section
3. Paste them into `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`

### Step 3: Enable Payments
1. Ensure your account is verified
2. Test keys work in sandbox mode (no real payments)
3. In production, enable Live Mode and get Live Keys

### Step 4: Set Up Webhooks
1. Go to **Settings → Webhooks**
2. Add a webhook URL: `https://yourdomain.com/api/orders/webhook/razorpay`
3. Select events: `payment.captured`, `payment.failed`, `refund.processed`
4. Copy the signing secret and add to `RAZORPAY_WEBHOOK_SECRET`

---

## Full Example (Development)
```
NODE_ENV=development
PORT=3000

MONGODB_URI=mongodb://localhost:27017/eg-marketplace

JWT_SECRET=dev-jwt-secret-key-2025
SESSION_SECRET=dev-session-secret-2025

FRONTEND_URL=http://localhost:5173

RAZORPAY_KEY_ID=rzp_test_1Aa00000000001
RAZORPAY_KEY_SECRET=cd4cKdh45jHRDZd9Tdx7x54D
RAZORPAY_WEBHOOK_SECRET=webhook_test_secret_abc123

ADMIN_COMMISSION_RATE=0.10
```

---

## Production Checklist
- [ ] Use strong, randomized `JWT_SECRET` and `SESSION_SECRET`
- [ ] Update `FRONTEND_URL` to your production domain
- [ ] Enable **Live Mode** in Razorpay and get Live Keys
- [ ] Update `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` to live keys
- [ ] Configure webhook URL to production domain
- [ ] Set `NODE_ENV=production`
- [ ] Use managed MongoDB (Atlas, AWS, etc.)
- [ ] Enable HTTPS on your frontend and backend
- [ ] Use an `.env` file that is **NOT** committed to version control
- [ ] Regularly rotate API keys and secrets

