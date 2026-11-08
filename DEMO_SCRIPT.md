# EG Marketplace - Comprehensive Practical Demo Walkthrough
**Internship Assignment Final Demonstration Guide**  
**Company:** ALGIONS AI LABS PRIVATE LIMITED  
**Platform:** EG Marketplace (Multi-Vendor E-Commerce Platform)

---

## 🎯 Demo Objectives & Overview

This walkthrough demonstrates the end-to-end features of EG Marketplace across all three user roles:
1. **Customer (Buyer):** Authentication, catalog search/filter, product variants, persistent cart, address book, checkout, Razorpay payment verification, order history, verified rating, and dispute filing.
2. **Vendor:** Multi-shop management, catalog & variant CRUD, inventory concurrency safety, order status fulfillment, vendor earnings calculation, and dispute responses.
3. **Platform Admin:** Analytics dashboard, gross vs net financial reconciliation, vendor application review, user RBAC, inventory monitoring, audit trail inspection, and system health diagnostics.

---

## 🛠 Pre-Demo Setup & Test Accounts

### 1. Ensure Services Are Running
Open two terminal windows:

```bash
# Terminal 1: Backend Server (Port 3000)
cd backend
npm start
# Output confirms:
# Server running on http://localhost:3000
# MongoDB connected in replica set mode (ReplicaSetWithPrimary) - transactions fully supported.

# Terminal 2: Frontend Server (Port 5173)
cd frontend
npm run dev
# Output confirms:
# Local: http://localhost:5173/
```

### 2. Default Test Accounts (from `npm run db:seed`)
| Role | Email | Password | Purpose |
|---|---|---|---|
| **Admin** | `admin@egmarketplace.com` | `admin123` | Platform governance, financial analytics, audit logs |
| **Vendor** | *(Register via UI or use seeded vendor)* | `SecPassword123!` | Shop owner, product/order fulfillment |
| **Buyer** | *(Register via UI or use seeded buyer)* | `SecPassword123!` | Customer purchasing and reviews |

> [!NOTE]
> All passwords use standard local test credentials. Never input production secrets or real banking credentials during a demonstration.

---

## 🎬 Step-by-Step Demonstration Walkthrough

### Part 1: Customer (Buyer) Journey

#### Step 1: Customer Registration & Login
1. Open your browser and navigate to `http://localhost:5173/register`.
2. Notice the modern two-column layout:
   - Left promotional panel with EG Marketplace branding and shopping benefits.
   - Right form with input fields: Username, Email, Role selection (`Buyer`), Password, Confirm Password.
3. Register a new buyer account:
   - **Username:** `rahul_sharma`
   - **Email:** `rahul@example.com`
   - **Role:** Select `Buyer`
   - **Password:** `Password123!`
4. Click **Create Account**. You will be automatically redirected to the homepage with active login session cookies and JWT in `localStorage`.
5. Test the password visibility toggle (eye icon) on the `/login` page to demonstrate password show/hide functionality.

#### Step 2: Browsing, Searching & Filtering
1. On the Homepage (`/`), observe the banner carousel, category cards (Electronics, Fashion, Home & Living, etc.), and featured shops.
2. Click **Browse All Products** (navigating to `/products`).
3. **Keyword Search:** Type `laptop` or `shirt` in the search bar and press Enter. The list filters instantly.
4. **Category Filtering:** Select `Electronics` from the Category dropdown.
5. **Price Filtering & Sorting:** Enter `minPrice: 500` and `maxPrice: 50000`, then select **Price: Low to High** from the sort dropdown. Notice products sort deterministically.
6. Observe out-of-stock and low-stock badge indicators (`Only 2 left`, `Out of Stock`) on product cards.

#### Step 3: Product Variants & Details
1. Click on a multi-variant product (e.g., a Clothing or Electronics item).
2. On `/products/:id`:
   - Inspect the thumbnail gallery and primary product image.
   - Click different variant pills (e.g., Size `M`, `L`, `XL` or Color `Blue`, `Black`).
   - Observe how the displayed **Price**, **Stock Level**, and **SKU** update in real time.
3. Select an in-stock variant and choose quantity `2`.
4. Click **Add to Cart**. A success banner appears, and the header cart badge increments immediately.

#### Step 4: Shopping Cart & Price Integrity
1. Click the **Cart** icon in the header (navigating to `/cart`).
2. Observe item details: image, title, selected variant name, unit price, and subtotal.
3. Test quantity adjustments (+ / - buttons).
4. Point out the **Multi-Vendor Boundary Enforcement**:
   - If products from different vendors are added to the cart, the system alerts the buyer that checkout must be fulfilled per-vendor, preventing split-payout conflicts.
5. Click **Proceed to Checkout**.

#### Step 5: Address Book Management
1. On `/checkout` (or `/addresses` via account navigation):
2. Click **Add New Address**.
3. Fill in the Indian delivery address format:
   - Full Name: `Rahul Sharma`
   - Phone: `9876543210`
   - Address Line 1: `Flat 402, Sunshine Heights, MG Road`
   - Landmark: `Near Metro Station`
   - City: `Bengaluru`
   - State: `Karnataka`
   - PIN Code: `560001`
   - Check **Set as default address**.
4. Click **Save Address**. The address is saved to MongoDB and selected for the order.

#### Step 6: Checkout, Idempotency & Razorpay Sandbox
1. Verify order summary: Subtotal, Shipping (Free), and Total Amount in INR (₹).
2. Point out **Checkout Idempotency**: Behind the scenes, the frontend attaches an `Idempotency-Key` UUID header to prevent double billing if clicked repeatedly.
3. Click **Proceed to Payment**.
4. The Razorpay modal opens:
   - In test/development mode, select Netbanking or Card (using test card `4111 1111 1111 1111` or simulated checkout).
   - Authorize the test payment.
5. Upon successful signature verification:
   - The backend atomically deducts variant stock using a multi-document ACID transaction.
   - The user is redirected to the confirmation screen with a valid Order ID.

#### Step 7: Order History, Review & Dispute
1. Navigate to **Order History** (`/orders`).
2. Verify the newly placed order displays with status `pending`, payment status `paid`, and transaction timestamp.
3. **Product Rating:** Click **Rate Product** on a delivered or received item, select `5 Stars`, write a comment (`Excellent quality and fast delivery!`), and submit. The average product rating recalculates immediately.
4. **Raising a Dispute:** Click **Raise Dispute**, select reason `wrong_item`, enter description, and submit. The dispute is created with status `open`.

---

### Part 2: Vendor Journey

#### Step 8: Vendor Registration & Shop Management
1. Navigate to `/register`.
2. Register a new vendor account:
   - **Username:** `craft_artisan`
   - **Email:** `artisan@example.com`
   - **Role:** Select `Vendor`
   - **Password:** `Password123!`
3. After registration, navigate to `/vendor/create-shop` (or click **Vendor Dashboard**).
4. Complete shop profile:
   - Shop Name: `Artisan Handicrafts`
   - Category: `Home & Living`
   - Description: `Authentic handcrafted home decor products.`
5. Click **Register Shop**.

#### Step 9: Vendor Dashboard Overview
1. Open the **Vendor Dashboard** (`/vendor/dashboard`).
2. Observe metrics:
   - Active Products count.
   - Total Orders count.
   - Shop details and approval status (`approved`).

#### Step 10: Adding & Managing Products with Variants
1. On the Vendor Dashboard, click **Add New Product**.
2. Fill in product details:
   - Title: `Handmade Ceramic Vase`
   - Description: `Artisan clay vase baked at high temperature with glazed finish.`
   - Category: `Home & Living`
   - Base Price: `1200`
   - SKU: `VASE-CER-001`
   - Image URL: `https://images.unsplash.com/photo-1578749556568-bc2c40e68b61` (or upload local raster image).
3. Add two variants:
   - Variant 1: Name: `Terracotta Matte`, SKU: `VASE-CER-001-TER`, Price: `1200`, Stock: `15`.
   - Variant 2: Name: `Glazed White`, SKU: `VASE-CER-001-GLZ`, Price: `1400`, Stock: `10`.
4. Click **Save Product**. The aggregate stock shows `25`, and both variants appear in the catalog.
5. Click **Edit Product** on an existing item: Update stock safely, demonstrating that non-negative stock constraints prevent invalid values.

#### Step 11: Order Processing & Status Transitions
1. In the Vendor Dashboard, scroll to **Orders for Your Shop**.
2. Locate the order placed by the customer in Part 1.
3. Demonstrate permitted order lifecycle transitions:
   - Transition `pending` → `processing` (marks order as packed/in progress).
   - Transition `processing` → `shipped` (marks item as dispatched).
   - Transition `shipped` → `delivered` (marks fulfillment complete).
4. Attempt an invalid transition (e.g. going backward from `delivered` to `pending`). Notice the backend authorization rejects the illegal transition with HTTP 400.

#### Step 12: Vendor Earnings & Financial Separation
1. Navigate to **Vendor Earnings** (`/vendor/earnings`).
2. Verify financial isolation:
   - The vendor sees **only** their own sales and earnings.
   - On a ₹2,400 order, Platform Commission is ₹240 (10%), and Net Vendor Earning is ₹2,160 (90%).
   - The vendor cannot view or modify other vendors' earnings or bank details.

#### Step 13: Responding to Disputes
1. Scroll to the **Disputes** section on the Vendor Dashboard.
2. Locate the dispute opened in Part 1.
3. Click **Reply**, type `We apologize for the inconvenience. A replacement has been dispatched.`, and click Submit.
4. The dispute status transitions to `vendor-responded`.

---

### Part 3: Platform Admin Journey

#### Step 14: Admin Login
1. Log out of the vendor account and navigate to `/login`.
2. Enter the default seeded admin credentials:
   - **Email:** `admin@egmarketplace.com`
   - **Password:** `admin123`
3. Click **Login**. You are automatically redirected to the **Admin Dashboard** (`/admin/dashboard`).

#### Step 15: Financial Analytics & Net Revenue Reconciliation
1. On the Admin Dashboard, inspect high-level platform KPIs:
   - **Total Users**, **Total Vendors**, **Total Products**, **Total Orders**.
2. Review the **Financial Reconciliation Card**:
   - **Gross Captured Sales:** Total paid order volume.
   - **Completed Refunds:** Deducted refund amounts (uncompleted or failed refunds are excluded).
   - **Net Platform Revenue:** Gross Captured Sales minus Completed Refunds.
   - **Platform Commission:** 10% platform share.
   - **Vendor Earnings:** 90% vendor payout balance.
   - **Reconciliation Status:** Shows `reconciled: true` (Difference is ₹0.00).

#### Step 16: Order Management & Multi-Facet Filtering
1. In the **Admin Orders** section:
2. Test filters:
   - Filter by Date Range (`startDate`, `endDate`).
   - Filter by Status (`paid`, `delivered`, `refunded`).
   - Filter by Customer name or Vendor shop name.
3. Pagination works cleanly with `.lean()` query projections for optimal performance.

#### Step 17: User & Vendor Governance
1. Navigate to the **User Management** tab:
   - View all registered users and their roles (`buyer`, `vendor`, `admin`).
   - Toggle role permissions safely via admin endpoints.
2. Navigate to the **Vendor Approval** tab:
   - View pending vendor applications.
   - Click **Approve** or **Reject** with notes. Approved vendors immediately gain shop management access.

#### Step 18: System Health Diagnostics
1. Open a new browser tab and navigate to `http://localhost:3000/health`.
2. Inspect the JSON diagnostic payload:
   ```json
   {
     "status": "ok",
     "uptime": 2450,
     "timestamp": "2026-11-08T22:30:00.000Z",
     "database": {
       "status": "connected",
       "readyState": 1,
       "topology": "ReplicaSetWithPrimary",
       "transactionsSupported": true
     },
     "payments": {
       "razorpayConfigured": true
     },
     "environment": "development"
   }
   ```
3. Highlight that:
   - Passwords and secrets are completely masked.
   - `transactionsSupported: true` confirms MongoDB replica set ACID transaction readiness.

---

## 🏁 Demo Wrap-Up Checklist

- [x] Customer registration, login, and password visibility toggle demonstrated.
- [x] Catalog search, multi-facet filtering, and variant pill selection demonstrated.
- [x] Cart price verification against database and multi-vendor boundary demonstrated.
- [x] Address book creation and default address selection demonstrated.
- [x] Idempotent checkout and payment settlement demonstrated.
- [x] Order history, verified purchase ratings, and dispute filing demonstrated.
- [x] Vendor shop creation, variant stock updates, and order status fulfillment demonstrated.
- [x] Vendor financial isolation (10% commission / 90% payout) demonstrated.
- [x] Admin financial reconciliation, user management, and vendor approvals demonstrated.
- [x] System health endpoint (`/health`) and graceful shutdown architecture demonstrated.

