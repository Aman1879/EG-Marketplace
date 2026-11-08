# EG-Marketplace API Documentation

Comprehensive REST API reference for the EG-Marketplace platform.

---

## Table of Contents
1. [Overview & Base URL](#1-overview--base-url)
2. [Authentication & Authorization](#2-authentication--authorization)
3. [Standard Response & Error Formats](#3-standard-response--error-formats)
4. [Authentication Endpoints (`/api/auth`)](#4-authentication-endpoints-apiauth)
5. [Product & Variant Catalog (`/api/products`)](#5-product--variant-catalog-apiproducts)
6. [Customer Address Book (`/api/addresses`)](#6-customer-address-book-apiaddresses)
7. [Shopping Cart (`/api/cart`)](#7-shopping-cart-apicart)
8. [Orders, Checkout, Payments & Refunds (`/api/orders`)](#8-orders-checkout-payments--refunds-apiorders)
9. [Vendor Dashboard & Shop Management (`/api/vendors`)](#9-vendor-dashboard--shop-management-apivendors)
10. [Admin Governance, Reports & Audit (`/api/admin`)](#10-admin-governance-reports--audit-apiadmin)
11. [Disputes & Product Ratings (`/api/disputes`, `/api/ratings`)](#11-disputes--product-ratings-apidisputes-apiratings)
12. [Contact Messages (`/api/contact`)](#12-contact-messages-apicontact)
13. [Real-Time WebSocket Events (Socket.IO)](#13-real-time-websocket-events-socketio)

---

## 1. Overview & Base URL

The API is served over HTTP/HTTPS with JSON-formatted bodies and UTF-8 encoding.

```
Development: http://localhost:3000/api
Production:  https://egmarketplace.netlify.app/api (or configured backend URL)
```

- All endpoints accept and return `application/json` (except Razorpay webhook endpoint which consumes raw binary for HMAC signature verification).
- Route parameters representing MongoDB documents (`:id`, `:productId`, `:orderId`) must be valid 24-character hexadecimal strings.

---

## 2. Authentication & Authorization

Protected endpoints require a valid JWT token. Tokens may be supplied in either:
1. **HTTP Authorization Header** (preferred):
   ```http
   Authorization: Bearer <jwt_token>
   ```
2. **HTTP-only Cookie**:
   ```http
   Cookie: token=<jwt_token>
   ```

### User Roles & Permissions
- **`buyer`**: Can manage address book, cart items, place orders, verify payments, cancel pending orders, leave ratings, and raise disputes.
- **`vendor`**: Can manage approved shops, catalog products & variants, fulfill assigned orders, view earnings, and reply to disputes.
- **`admin`**: Full platform oversight: approve/reject vendor applications, manage user roles, issue financial refunds, view financial analytics & audit logs.

---

## 3. Standard Response & Error Formats

### Success Response
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {}
}
```

### Error Response
Consistent across all routes without leaking stack traces or internal secrets:
```json
{
  "success": false,
  "message": "Human-readable error description",
  "errors": ["Specific field error 1", "Specific field error 2"]
}
```

### Common HTTP Status Codes
- `200 OK`: Request succeeded.
- `201 Created`: Resource successfully created.
- `400 Bad Request`: Malformed JSON, missing required fields, or invalid parameter types.
- `401 Unauthorized`: Missing, invalid, or expired JWT token.
- `403 Forbidden`: Authenticated user lacks permission or ownership for the resource.
- `404 Not Found`: Target resource or endpoint does not exist.
- `409 Conflict`: Idempotency conflict or duplicate unique constraint violation.
- `500 Internal Server Error`: Server failure without exposing stack traces.

---

## 4. Authentication Endpoints (`/api/auth`)

### 4.1 Send Email OTP (Registration)
- **Method / Path:** `POST /api/auth/send-otp`
- **Auth:** Public (Rate-limited: 15 requests / 15 mins per IP, 60s cooldown per email)
- **Request Body:**
  ```json
  {
    "email": "rahul@example.com"
  }
  ```
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "message": "Verification code sent to your email address.",
    "expiresIn": 300,
    "resendCooldown": 60
  }
  ```
- **Response `400 Bad Request` (Account already exists):**
  ```json
  {
    "message": "An account with this email address already exists. Please log in."
  }
  ```
- **Response `429 Too Many Requests` (Resend cooldown active):**
  ```json
  {
    "message": "Please wait 48 seconds before requesting a new verification code.",
    "retryAfter": 48
  }
  ```

### 4.2 Verify Email OTP (Standalone / Token Issue)
- **Method / Path:** `POST /api/auth/verify-otp`
- **Auth:** Public (Max 5 attempts allowed)
- **Request Body:**
  ```json
  {
    "email": "rahul@example.com",
    "otp": "481923"
  }
  ```
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "message": "Email verified successfully.",
    "verificationToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```
- **Response `400 Bad Request` (Incorrect OTP):**
  ```json
  {
    "message": "Invalid verification code. 4 attempts remaining.",
    "remainingAttempts": 4
  }
  ```
- **Response `429 Too Many Requests` (Lockout after 5 failed attempts):**
  ```json
  {
    "message": "Maximum verification attempts exceeded. Please request a new verification code."
  }
  ```

### 4.3 Register User
- **Method / Path:** `POST /api/auth/register`
- **Auth:** Public (Requires valid `otp` or `verificationToken`)
- **Request Body (Direct OTP Submission):**
  ```json
  {
    "username": "rahul_buyer",
    "email": "rahul@example.com",
    "password": "Password@123",
    "role": "buyer",
    "otp": "481923"
  }
  ```
- **Request Body (Pre-Verified Token Submission):**
  ```json
  {
    "username": "rahul_buyer",
    "email": "rahul@example.com",
    "password": "Password@123",
    "role": "buyer",
    "verificationToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```
  *(Note: `role` defaults to `buyer`; client cannot self-assign `admin` role. OTP or token is strictly consumed and deleted upon account creation).*
- **Response `201 Created`:**
  ```json
  {
    "message": "User registered successfully",
    "token": "eyJhbGciOi...",
    "user": {
      "id": "6af05aa4e76eda7b8569d3b6",
      "username": "rahul_buyer",
      "email": "rahul@example.com",
      "role": "buyer"
    }
  }
  ```
- **Response `400 Bad Request` (Bypass Attempt):**
  ```json
  {
    "message": "Email verification is required before registration. Please verify your email with the OTP."
  }
  ```

### 4.4 Login
- **Method / Path:** `POST /api/auth/login`
- **Auth:** Public
- **Request Body:**
  ```json
  {
    "email": "rahul@example.com",
    "password": "Password@123"
  }
  ```
- **Response `200 OK`:**
  ```json
  {
    "message": "Login successful",
    "token": "eyJhbGciOi...",
    "user": {
      "id": "6af05aa4e76eda7b8569d3b6",
      "username": "rahul_buyer",
      "email": "rahul@example.com",
      "role": "buyer"
    },
    "vendorProfile": null
  }
  ```

### 4.3 Get Current User Profile
- **Method / Path:** `GET /api/auth/me`
- **Auth:** Authenticated (`buyer`, `vendor`, or `admin`)
- **Response `200 OK`:** Returns current user details and associated vendor shop if applicable.

### 4.4 Logout
- **Method / Path:** `POST /api/auth/logout`
- **Auth:** Public
- **Response `200 OK`:** Clears auth cookie.

---

## 5. Product & Variant Catalog (`/api/products`)

### 5.1 List / Search Products
- **Method / Path:** `GET /api/products`
- **Auth:** Public
- **Query Parameters:**
  - `search` *(string)*: Keyword search in title and description.
  - `category` *(string)*: Standard category name (e.g. `Electronics`, `Clothing`).
  - `minPrice` *(number)*: Minimum price filter.
  - `maxPrice` *(number)*: Maximum price filter.
  - `vendorId` *(ObjectId)*: Filter products by vendor shop ID.
  - `inStock` *(boolean)*: Filter in-stock items (`true` / `false`).
  - `sort` *(string)*: `newest`, `oldest`, `price_asc`, `price_desc`, `name_asc`, `name_desc`, `rating_desc`.
  - `page` *(number, default: 1)*: Page number.
  - `limit` *(number, default: 12)*: Products per page.
- **Response `200 OK`:**
  ```json
  {
    "products": [
      {
        "_id": "6af05a7e8e1005cee1a3014a",
        "title": "SonicPro Wireless ANC Headphones",
        "description": "Active Noise Cancelling over-ear Bluetooth headphones.",
        "price": 4999,
        "category": "Electronics",
        "sku": "SKU-APX-ANC01",
        "stock": 40,
        "imageUrl": "https://images.unsplash.com/...",
        "images": ["https://images.unsplash.com/..."],
        "variants": [
          {
            "_id": "6af05a7e8e1005cee1a3014b",
            "name": "Midnight Black",
            "sku": "SKU-APX-ANC01-BLK",
            "price": 4999,
            "stock": 25,
            "isActive": true
          }
        ],
        "vendorId": {
          "_id": "6af05a7e8e1005cee1a3013b",
          "shopName": "Apex Audio & Gadgets"
        }
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalProducts": 1,
      "limit": 12
    }
  }
  ```

### 5.2 Get Single Product
- **Method / Path:** `GET /api/products/:id`
- **Auth:** Public

### 5.3 Get Standard Categories
- **Method / Path:** `GET /api/products/categories`
- **Auth:** Public
- **Response `200 OK`:** Array of standard product category names.

### 5.4 Get Products by Category
- **Method / Path:** `GET /api/products/category/:category`
- **Auth:** Public

### 5.5 Get Vendor's Products
- **Method / Path:** `GET /api/products/vendor/my-products`
- **Auth:** Vendor Only (`role: vendor`)
- **Query Parameters:** `shopId` *(optional, for vendors with multiple shops)*.

### 5.6 Create Product
- **Method / Path:** `POST /api/products`
- **Auth:** Vendor Only (`role: vendor`, shop must have `approvalStatus: approved`)
- **Request Body:**
  ```json
  {
    "vendorId": "6af05a7e8e1005cee1a3013b",
    "title": "AuraGlow Desk Lamp",
    "description": "Minimalist LED desk lamp with touch dimming.",
    "price": 1499,
    "category": "Home Decor",
    "sku": "SKU-APX-LMP04",
    "imageUrl": "https://images.unsplash.com/...",
    "images": ["https://images.unsplash.com/..."],
    "variants": [
      {
        "name": "Matte White",
        "sku": "SKU-APX-LMP04-WHT",
        "price": 1499,
        "stock": 20
      },
      {
        "name": "Brushed Brass",
        "sku": "SKU-APX-LMP04-BRS",
        "price": 1799,
        "stock": 15
      }
    ]
  }
  ```
  *(Note: If variants are provided, product aggregate stock is calculated from variant stocks).*
- **Response `201 Created`:** Created product document.

### 5.7 Update Product
- **Method / Path:** `PUT /api/products/:id`
- **Auth:** Vendor Only (ownership strictly enforced)

### 5.8 Delete Product
- **Method / Path:** `DELETE /api/products/:id`
- **Auth:** Vendor Only (ownership strictly enforced)

---

## 6. Customer Address Book (`/api/addresses`)

### 6.1 List Saved Addresses
- **Method / Path:** `GET /api/addresses`
- **Auth:** Authenticated
- **Response `200 OK`:** Sorted by default first, then most recently updated.

### 6.2 Create Delivery Address
- **Method / Path:** `POST /api/addresses`
- **Auth:** Authenticated
- **Request Body:**
  ```json
  {
    "fullName": "Rahul Sharma",
    "phone": "9876543210",
    "addressLine1": "Flat 402, Sunshine Heights",
    "addressLine2": "MG Road, Sector 14",
    "landmark": "Near Metro Station",
    "city": "Bengaluru",
    "state": "Karnataka",
    "postalCode": "560001",
    "isDefault": true
  }
  ```
- **Validation Rules:**
  - Phone: Valid 10-digit Indian phone number starting with 6, 7, 8, or 9.
  - Postal Code: Valid 6-digit numeric PIN.
  - Setting `isDefault: true` automatically unsets any prior default address for this user.

### 6.3 Get Single Address
- **Method / Path:** `GET /api/addresses/:id`
- **Auth:** Authenticated (ownership enforced)

### 6.4 Update Address
- **Method / Path:** `PUT /api/addresses/:id`
- **Auth:** Authenticated (ownership enforced)

### 6.5 Delete Address
- **Method / Path:** `DELETE /api/addresses/:id`
- **Auth:** Authenticated (ownership enforced)

### 6.6 Set Address as Default
- **Method / Path:** `PATCH /api/addresses/:id/default`
- **Auth:** Authenticated (ownership enforced)

---

## 7. Shopping Cart (`/api/cart`)

### 7.1 View Cart & Summary
- **Method / Path:** `GET /api/cart` or `GET /api/cart/summary`
- **Auth:** Buyer Only (`role: buyer`)
- **Response `200 OK`:**
  ```json
  {
    "items": [
      {
        "_id": "6af05a7e8e1005cee1a3015c",
        "productId": {
          "_id": "6af05a7e8e1005cee1a3014a",
          "title": "SonicPro Wireless ANC Headphones",
          "price": 4999,
          "stock": 40
        },
        "variantId": "6af05a7e8e1005cee1a3014b",
        "variantName": "Midnight Black",
        "variantSku": "SKU-APX-ANC01-BLK",
        "quantity": 2,
        "priceAtAdd": 4999,
        "subtotal": 9998
      }
    ],
    "itemCount": 2,
    "totalAmount": 9998
  }
  ```

### 7.2 Add Item to Cart
- **Method / Path:** `POST /api/cart/add`
- **Auth:** Buyer Only (`role: buyer`)
- **Request Body:**
  ```json
  {
    "productId": "6af05a7e8e1005cee1a3014a",
    "variantId": "6af05a7e8e1005cee1a3014b",
    "quantity": 1
  }
  ```
  *(Note: Price is NEVER accepted from the client; calculated securely on server).*

### 7.3 Update Cart Item Quantity
- **Method / Path:** `PUT /api/cart/update`
- **Auth:** Buyer Only (`role: buyer`)
- **Request Body:**
  ```json
  {
    "cartItemId": "6af05a7e8e1005cee1a3015c",
    "quantity": 3
  }
  ```
  *(Setting `quantity: 0` removes the item).*

### 7.4 Remove Single Item
- **Method / Path:** `DELETE /api/cart/remove/:id`
- **Auth:** Buyer Only (`role: buyer`)

### 7.5 Clear Entire Cart
- **Method / Path:** `DELETE /api/cart/clear`
- **Auth:** Buyer Only (`role: buyer`)

---

## 8. Orders, Checkout, Payments & Refunds (`/api/orders`)

### 8.1 Create Checkout Razorpay Order
- **Method / Path:** `POST /api/orders/create-razorpay-order` (or alias `POST /api/orders`)
- **Auth:** Buyer Only (`role: buyer`)
- **Headers:** `Idempotency-Key` *(optional UUID to prevent duplicate checkout)*
- **Request Body:**
  ```json
  {
    "products": [
      {
        "productId": "6af05a7e8e1005cee1a3014a",
        "variantId": "6af05a7e8e1005cee1a3014b",
        "quantity": 1
      }
    ],
    "addressId": "6af05a7e8e1005cee1a3012a"
  }
  ```
- **Response `201 Created`:**
  ```json
  {
    "message": "Razorpay order created",
    "key": "rzp_test_...",
    "orderId": "6af05aa4e76eda7b8569d410",
    "amount": 4999,
    "currency": "INR",
    "commissionRate": 0.10,
    "vendorEarning": 4499.10,
    "adminCommission": 499.90,
    "razorpayOrder": {
      "id": "order_OG72hK...",
      "amount": 499900,
      "currency": "INR"
    }
  }
  ```

### 8.2 Verify Payment & Settle Order
- **Method / Path:** `POST /api/orders/verify-payment`
- **Auth:** Buyer Only (`role: buyer`)
- **Request Body:**
  ```json
  {
    "orderId": "6af05aa4e76eda7b8569d410",
    "razorpay_order_id": "order_OG72hK...",
    "razorpay_payment_id": "pay_OG739x...",
    "razorpay_signature": "9b12f6c8d7e..."
  }
  ```
- **Behavior:**
  - Verifies HMAC-SHA256 signature against Razorpay secret.
  - Re-validates stock and atomically deducts variant & product inventory.
  - Transitions order status to `confirmed` and `paymentStatus` to `paid`.
  - Idempotent: repeated calls safely return existing verified order without double stock deductions.

### 8.3 Cancel Unpaid / Interrupted Payment
- **Method / Path:** `POST /api/orders/:id/cancel-payment`
- **Auth:** Buyer Only (`role: buyer`)

### 8.4 Razorpay Webhook Handler
- **Method / Path:** `POST /api/orders/webhook/razorpay`
- **Auth:** Webhook Signature Header (`X-Razorpay-Signature`)
- **Supported Events:** `payment.captured`, `payment.failed`, `refund.processed`.

### 8.5 Get Buyer Order History
- **Method / Path:** `GET /api/orders/buyer/my-orders`
- **Auth:** Buyer Only (`role: buyer`)

### 8.6 Get Vendor Order Fulfillment Queue
- **Method / Path:** `GET /api/orders/vendor/my-orders`
- **Auth:** Vendor Only (`role: vendor`)

### 8.7 Get Single Order Details
- **Method / Path:** `GET /api/orders/:id`
- **Auth:** Authenticated (Buyer who ordered, Vendor whose products are included, or Admin)

### 8.8 Update Order Status (Fulfillment Transitions)
- **Method / Path:** `PUT /api/orders/:id/status`
- **Auth:** Vendor or Admin
- **Request Body:**
  ```json
  {
    "status": "processing",
    "reason": "Order packed and ready for dispatch"
  }
  ```
- **Lifecycle Transition Rules:**
  - Vendor forward progression: `confirmed` -> `processing` -> `shipped` -> `delivered`.
  - Vendors cannot jump states or directly set `refunded`.
  - Terminal states (`cancelled`, `refunded`) reject modifications.

### 8.9 Cancel Order
- **Method / Path:** `POST /api/orders/:id/cancel`
- **Auth:** Buyer Only (`role: buyer`)
- **Request Body:**
  ```json
  {
    "reason": "Ordered by mistake"
  }
  ```
- **Behavior:**
  - Allowed while order is in `pending`, `confirmed`, or `processing` state.
  - Automatically restores deducted stock to variant and product inventory.
  - Automatically issues gateway refund if payment was already captured.

### 8.10 Issue Refund (Admin Only)
- **Method / Path:** `POST /api/orders/:id/refund`
- **Auth:** Admin Only (`role: admin`)
- **Request Body:**
  ```json
  {
    "amount": 2500,
    "reason": "Customer return agreed"
  }
  ```
  *(If `amount` is omitted, full captured amount is refunded).*

---

## 9. Vendor Dashboard & Shop Management (`/api/vendors`)

### 9.1 Get Current Vendor Shops
- **Method / Path:** `GET /api/vendors/my-shops`
- **Auth:** Vendor Only (`role: vendor`)

### 9.2 Create / Onboard Shop
- **Method / Path:** `POST /api/vendors/create` (or alias `POST /api/vendors/onboard`)
- **Auth:** Vendor Only (`role: vendor`)
- **Request Body:**
  ```json
  {
    "shopName": "Apex Audio & Gadgets",
    "description": "High fidelity audio equipment.",
    "category": "Electronics",
    "gstin": "29ABCDE1234F1Z5"
  }
  ```

### 9.3 Update Shop Profile
- **Method / Path:** `POST /api/vendors/profile`
- **Auth:** Vendor Only (`role: vendor`)

### 9.4 Update Payout Settings
- **Method / Path:** `PUT /api/vendors/:id/payout-settings`
- **Auth:** Vendor Only (ownership enforced)
- **Request Body:**
  ```json
  {
    "upiId": "vendor@okaxis",
    "accountHolderName": "Apex Technologies",
    "accountNumber": "123456789012",
    "ifscCode": "HDFC0001234",
    "bankName": "HDFC Bank"
  }
  ```

### 9.5 Get Payout Settings
- **Method / Path:** `GET /api/vendors/:id/payout-settings`
- **Auth:** Vendor Only (ownership enforced)
- **Masking:** Account numbers are returned masked (e.g. `****9012`).

### 9.6 View Vendor Earnings Summary
- **Method / Path:** `GET /api/vendors/my/earnings-summary`
- **Auth:** Vendor Only (`role: vendor`)

### 9.7 Browse Public Shops Directory
- **Method / Path:** `GET /api/vendors/shops`
- **Auth:** Public

### 9.8 Get Public Shop & Products
- **Method / Path:** `GET /api/vendors/:id/public`
- **Auth:** Public

---

## 10. Admin Governance, Reports & Audit (`/api/admin`)

### 10.1 High-Level Dashboard Metrics
- **Method / Path:** `GET /api/admin/dashboard`
- **Auth:** Admin Only (`role: admin`)
- **Metrics Returned:** Total users, total vendors, total products, order counts by status, gross revenue, net revenue, total commissions, total vendor earnings.

### 10.2 Financial Reporting & Commission Reconciliation
- **Method / Path:** `GET /api/admin/reports/financial`
- **Auth:** Admin Only (`role: admin`)
- **Query Parameters:** `startDate` *(ISO 8601)*, `endDate` *(ISO 8601)*.
- **Formulas:**
  - `grossSales`: Sum of `totalAmount` for captured/paid orders.
  - `completedRefunds`: Sum of completed refunds (excludes pending/failed).
  - `netRevenue`: `grossSales - completedRefunds`.
  - `reconciledCommission`: `platformCommission - refundedCommission`.
  - `reconciledVendorEarnings`: `vendorEarnings - refundedVendorEarnings`.

### 10.3 Filtered Orders Management
- **Method / Path:** `GET /api/admin/orders`
- **Auth:** Admin Only (`role: admin`)
- **Query Parameters:** `status`, `buyerId`, `vendorId`, `startDate`, `endDate`, `search`, `page`, `limit`.

### 10.4 Inventory Health & Low-Stock Alerts
- **Method / Path:** `GET /api/admin/inventory`
- **Auth:** Admin Only (`role: admin`)

### 10.5 User Management & Role Elevation
- **Method / Path:** `GET /api/admin/users`
- **Method / Path:** `PUT /api/admin/users/:id/role`
- **Auth:** Admin Only (`role: admin`)
- **Request Body for Role:**
  ```json
  {
    "role": "vendor"
  }
  ```
  *(Admin cannot self-demote to prevent accidental lockout).*

### 10.6 Vendor Shop Approvals & Governance
- **Method / Path:** `GET /api/admin/vendor-requests`
- **Method / Path:** `PUT /api/admin/vendor-requests/:id/approve`
- **Method / Path:** `PUT /api/admin/vendor-requests/:id/reject`
- **Auth:** Admin Only (`role: admin`)

### 10.7 Audit Log Inspection
- **Method / Path:** `GET /api/admin/audit-logs`
- **Auth:** Admin Only (`role: admin`, read-only; mutation/deletion methods return `405 Method Not Allowed`).
- **Query Parameters:** `action`, `resourceType`, `actorId`, `startDate`, `endDate`, `page`, `limit`.

---

## 11. Disputes & Product Ratings (`/api/disputes`, `/api/ratings`)

### 11.1 Raise Dispute
- **Method / Path:** `POST /api/disputes`
- **Auth:** Buyer Only (`role: buyer`)
- **Request Body:**
  ```json
  {
    "orderId": "6af05aa4e76eda7b8569d410",
    "reason": "damaged_product",
    "description": "Item arrived with a damaged enclosure.",
    "images": ["https://..."]
  }
  ```
- **Allowed Reasons:** `not_received`, `damaged_product`, `wrong_item`, `refund_request`, `other`.

### 11.2 Vendor Reply to Dispute
- **Method / Path:** `PUT /api/disputes/:id/reply`
- **Auth:** Vendor Only (must own shop involved in dispute)

### 11.3 Admin Resolve Dispute
- **Method / Path:** `PUT /api/disputes/:id/status`
- **Auth:** Admin Only (`role: admin`)
- **Allowed Statuses:** `open`, `vendor-responded`, `under-review`, `resolved`, `rejected`.

### 11.4 Submit Product Rating & Review
- **Method / Path:** `POST /api/ratings`
- **Auth:** Buyer Only (`role: buyer`)
- **Request Body:**
  ```json
  {
    "productId": "6af05a7e8e1005cee1a3014a",
    "orderId": "6af05aa4e76eda7b8569d410",
    "rating": 5,
    "review": "Exceptional sound quality and ANC performance!"
  }
  ```
- **Constraint:** One rating per buyer per product (unique index enforced).

### 11.5 View Product Ratings
- **Method / Path:** `GET /api/ratings/product/:productId`
- **Auth:** Public

---

## 12. Contact Messages (`/api/contact`)

### 12.1 Submit Inquiry
- **Method / Path:** `POST /api/contact/submit`
- **Auth:** Public
- **Request Body:**
  ```json
  {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "subject": "Wholesale Inquiry",
    "message": "Do you offer bulk enterprise pricing?"
  }
  ```

### 12.2 Admin Messages Management
- `GET /api/contact/messages` (Admin Only)
- `GET /api/contact/messages/:id` (Admin Only)
- `PUT /api/contact/messages/:id/status` (Admin Only: `new`, `read`, `replied`, `archived`)
- `DELETE /api/contact/messages/:id` (Admin Only)
- `GET /api/contact/stats` (Admin Only)

---

## 13. Real-Time WebSocket Events (Socket.IO)

All Socket.IO connections must provide an authentication token in `socket.handshake.auth.token` or via `Authorization` header.

### Authenticated Rooms
- `user:<userId>`: Scoped to the individual authenticated user.
- `vendor:<vendorId>`: Scoped to vendor shop owners.
- `admin`: Scoped to administrators.

### Server → Client Dispatched Events
- `newOrder`: Dispatched to `vendor:<vendorId>` and `admin` when a new order is confirmed.
- `orderStatusUpdated`: Dispatched to `user:<buyerId>` and `vendor:<vendorId>` on status updates.
- `disputeCreated`: Dispatched to `vendor:<vendorId>` and `admin`.
- `newVendorRequest`: Dispatched to `admin` upon vendor shop registration.
- `vendorApprovalUpdate`: Dispatched to `user:<userId>` when shop is approved/rejected.

---

## 14. System Health & Diagnostic Endpoints

Public health endpoints used by Render, load balancers, and container orchestration monitors to verify service availability and database connectivity.

### `GET /health` / `GET /api/health`
- **Access:** Public (No authentication required)
- **Rate Limit:** Unrestricted
- **Purpose:** Reports operational status, database connectivity, and MongoDB replica set ACID transaction readiness.

#### Response: `200 OK` (Healthy)
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
  "environment": "production"
}
```

#### Response: `503 Service Unavailable` (Degraded)
```json
{
  "status": "degraded",
  "uptime": 2450,
  "timestamp": "2026-11-08T22:30:00.000Z",
  "database": {
    "status": "disconnected",
    "readyState": 0,
    "topology": "unknown",
    "transactionsSupported": false
  },
  "payments": {
    "razorpayConfigured": true
  },
  "environment": "production"
}
```
