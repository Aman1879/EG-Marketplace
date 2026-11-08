
# EG Marketplace — Full-Stack Multi-Vendor Platform
**Capstone Internship Submission for ALGIONS AI LABS PRIVATE LIMITED**

[![Live Demo](https://img.shields.io/badge/Live_Frontend-Netlify-00C7B7?style=flat&logo=netlify)](https://egmarketplace.netlify.app/)
[![Backend Status](https://img.shields.io/badge/Live_Backend-Render-46E3B7?style=flat&logo=render)](https://eg-marketplace-1.onrender.com/health)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-339933?style=flat&logo=node.js)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18.2.0-61DAFB?style=flat&logo=react)](https://react.dev/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas_ReplicaSet-47A248?style=flat&logo=mongodb)](https://www.mongodb.com/atlas)

A full-stack multi-vendor e-commerce platform built with Node.js, Express, MongoDB, Socket.IO, Razorpay, and React.

---

## 📑 Assignment Submission & Documentation Quick Links

| Document | Description | Direct Link |
|---|---|:---:|
| **Master Technical Report** | Complete architecture, business logic, security & test metrics | [`PROJECT_DOCUMENTATION.md`](./PROJECT_DOCUMENTATION.md) |
| **Database ER Diagram** | Full 12-model Mermaid ERD and field definitions | [`PROJECT_DOCUMENTATION.md#database-er-diagram`](./PROJECT_DOCUMENTATION.md#database-er-diagram) |
| **REST API Reference** | Complete endpoint catalogue with request/response examples | [`API_DOCUMENTATION.md`](./API_DOCUMENTATION.md) |
| **Practical Demo Walkthrough** | Exact step-by-step recording guide for all 3 user roles | [`DEMO_SCRIPT.md`](./DEMO_SCRIPT.md) |
| **Submission Checklist** | Formal checklist, declarations, and evaluator details | [`SUBMISSION_CHECKLIST.md`](./SUBMISSION_CHECKLIST.md) |
| **Razorpay Payment Architecture** | Order creation, HMAC SHA-256 webhooks, and refund flows | [`RAZORPAY_INTEGRATION.md`](./RAZORPAY_INTEGRATION.md) |

---

## 🌐 Live Deployment
- **Frontend SPA (Netlify):** [https://egmarketplace.netlify.app/](https://egmarketplace.netlify.app/)
- **Backend API (Render):** [https://eg-marketplace-1.onrender.com/](https://eg-marketplace-1.onrender.com/)
- **Health Check Endpoint:** [https://eg-marketplace-1.onrender.com/health](https://eg-marketplace-1.onrender.com/health)

## 🎯 Features

### User Roles
- **Buyer**: Browse products, add to cart, checkout, view orders, rate products, open disputes
- **Vendor**: Register shop, add/edit/delete products, manage orders, update order status, reply to disputes
- **Admin**: View dashboard, track commissions, manage disputes, view vendor earnings

### Key Features
- ✅ User authentication (Register/Login)
- ✅ Product browsing with search
- ✅ Shopping cart functionality
- ✅ Order management system
- ✅ Rating and review system (1-5 stars)
- ✅ Commission tracking (10% admin commission)
- ✅ Dispute resolution system
- ✅ Real-time notifications using Socket.IO
- ✅ EventEmitter for order events
- ✅ File system logging
- ✅ Etsy-inspired UI design

## 📋 Prerequisites

- Node.js (v14 or higher)
- MongoDB (running locally on port 27017)
- npm or yarn

## 🚀 Installation & Setup

### 1. Clone the repository

```bash
git clone <repository-url>
cd MarketPlace
```

### 2. Backend Setup

```bash
cd backend
npm install
```

### 3. Frontend Setup

```bash
cd ../frontend
npm install
```

### 4. MongoDB Setup & Replica Set Requirements

The platform uses MongoDB for data persistence and multi-document ACID transactions (for checkout, stock deduction/restoration, and ledger operations).

> [!IMPORTANT]
> MongoDB multi-document transactions require a replica set (single-node replica set is sufficient for local development).

#### Local MongoDB Replica Set Setup:
```bash
# Start MongoDB with a replica set name (e.g., rs0)
mongod --replSet rs0 --dbpath <path-to-db-directory>

# In a separate terminal or mongosh shell, initiate the replica set (once):
mongosh --eval "rs.initiate()"
```

For MongoDB Atlas clusters (e.g. `cluster0.mongodb.net`), replica sets are enabled by default.

### 5. Database Setup, Migrations & Seed Data

The backend provides automated, idempotent scripts for versioned migrations, index synchronization, and seed data.

#### Execution Order:
Run these commands inside the `backend` directory:

```bash
cd backend

# Step 1: Run versioned schema migrations (backfills legacy fields, normalizes status & addresses)
npm run db:migrate

# Step 2: Synchronize and optimize database indexes (cleans up obsolete indexes, builds compound indexes)
npm run db:index

# Step 3: Seed representative marketplace data (admin, vendors, buyers, products with variants)
npm run db:seed

# Alternatively, run all three in sequence with a single command:
npm run db:setup
```

#### Admin Account Configuration:
Admin credentials are configured securely via environment variables in `backend/.env` (never hardcoded secrets):
- `ADMIN_EMAIL`: Admin login email (default: `admin@egmarketplace.com`)
- `ADMIN_USERNAME`: Admin display username (default: `admin`)
- `ADMIN_PASSWORD`: Admin password (default: `Admin@12345`)

Running `npm run db:seed` will automatically create or verify the admin user with bcrypt password encryption.

## 🏃 Running the Application

### Start Backend Server

```bash
cd backend
npm start
```

The backend server will run on `http://localhost:3000`

### Start Frontend Server

Open a new terminal:

```bash
cd frontend
npm run dev
```

The frontend will run on `http://localhost:5173`

## 📁 Project Structure

```
MarketPlace/
├── backend/
│   ├── models/          # MongoDB schemas
│   │   ├── User.js
│   │   ├── Vendor.js
│   │   ├── Product.js
│   │   ├── Order.js
│   │   ├── Rating.js
│   │   ├── Dispute.js
│   │   └── Commission.js
│   ├── routes/          # Express routes
│   │   ├── auth.js
│   │   ├── products.js
│   │   ├── orders.js
│   │   ├── ratings.js
│   │   ├── disputes.js
│   │   └── admin.js
│   ├── middleware/      # Custom middleware
│   │   └── auth.js
│   ├── logs/            # Log files (auto-created)
│   ├── server.js        # Main server file
│   └── package.json
│
└── frontend/
    ├── src/
    │   ├── components/  # React components
    │   ├── pages/       # Page components
    │   ├── context/     # Context API
    │   ├── hooks/       # Custom hooks
    │   └── App.jsx
    └── package.json
```

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout user

### Products
- `GET /api/products` - Get all products
- `GET /api/products/:id` - Get single product
- `POST /api/products` - Create product (vendor only)
- `PUT /api/products/:id` - Update product (vendor only)
- `DELETE /api/products/:id` - Delete product (vendor only)
- `GET /api/products/vendor/my-products` - Get vendor's products

### Orders
- `POST /api/orders` - Create order (buyer only)
- `GET /api/orders/buyer/my-orders` - Get buyer's orders
- `GET /api/orders/vendor/my-orders` - Get vendor's orders
- `GET /api/orders/:id` - Get single order
- `PUT /api/orders/:id/status` - Update order status (vendor only)

### Ratings
- `POST /api/ratings` - Create rating (buyer only)
- `GET /api/ratings/product/:productId` - Get product ratings

### Disputes
- `POST /api/disputes` - Create dispute (buyer only)
- `GET /api/disputes/buyer/my-disputes` - Get buyer's disputes
- `GET /api/disputes/vendor/my-disputes` - Get vendor's disputes
- `GET /api/disputes/all` - Get all disputes (admin only)
- `PUT /api/disputes/:id/reply` - Vendor reply to dispute
- `PUT /api/disputes/:id/status` - Update dispute status (admin only)

### Admin
- `GET /api/admin/dashboard` - Get dashboard stats
- `GET /api/admin/commissions` - Get all commissions
- `GET /api/admin/vendor-earnings` - Get vendor earnings summary

## 🎨 Technologies Used

### Backend
- Node.js
- Express.js
- MongoDB with Mongoose
- Socket.IO
- JWT for authentication
- bcryptjs for password hashing
- express-validator for validation

### Frontend
- React 18
- React Router DOM
- Axios for HTTP requests
- Socket.IO Client
- Context API for state management
- CSS Modules

## 🔐 Authentication

The application uses JWT (JSON Web Tokens) for authentication. Tokens are stored in localStorage on the frontend and sent with each request in the Authorization header.

## 💰 Commission System

- Admin commission rate: 10% (fixed)
- When an order is placed:
  - Total amount is calculated
  - Vendor earning = Total × 90%
  - Admin commission = Total × 10%
  - Both are stored in the database

## 📡 Real-time Features

Socket.IO is used for real-time notifications:
- Vendors receive notifications when new orders are placed
- Buyers receive notifications when order status is updated
- All users receive notifications for dispute events

## 📝 Logging

Order-related events are logged to `backend/logs/order-log.txt` using the fs module.

## 🚢 Deployment & Production Configuration

EG Marketplace is designed for cloud-native deployment with decoupled frontend and backend services:
- **Backend API & WebSockets:** Hosted on [Render](https://render.com/) (Web Service)
- **Frontend SPA:** Hosted on [Netlify](https://www.netlify.com/) (Edge Static Hosting)
- **Database:** [MongoDB Atlas](https://www.mongodb.com/atlas) (ReplicaSet with Primary for ACID transactions)
- **CI/CD Pipeline:** [Jenkins](https://www.jenkins.io/) Declarative Pipeline (`Jenkinsfile`)

---

### 1. Backend Deployment (Render)

The backend runs as a containerized or native Node.js web service on Render. A declarative Blueprint is provided in [`render.yaml`](./render.yaml).

#### Render Web Service Settings:
- **Repository Root Directory:** `backend`
- **Environment:** Node
- **Build Command:** `npm ci`
- **Start Command:** `node server.js`
- **Health Check Path:** `/health` (also available at `/api/health`)
- **Auto-Deploy:** Yes (on git push to `main`)

#### Required Production Environment Variables:

| Variable | Description | Example / Default | Required in Production |
|---|---|---|:---:|
| `NODE_ENV` | Operating environment mode | `production` | **Yes** |
| `PORT` | Web server listening port | `10000` (assigned by Render) | **Yes** |
| `MONGODB_URI` | MongoDB Atlas Replica Set connection string | `mongodb+srv://user:pass@cluster0.mongodb.net/marketplace?retryWrites=true&w=majority` | **Yes** |
| `JWT_SECRET` | Strong secret key for signing user authentication JWTs | Strong 64-character random string | **Yes** |
| `SESSION_SECRET` | Strong secret key for Express sessions | Strong 64-character random string | **Yes** |
| `FRONTEND_URLS` | Comma-separated list of approved browser origins for CORS | `https://egmarketplace.netlify.app` | **Yes** |
| `FRONTEND_URL` | Primary frontend web address | `https://egmarketplace.netlify.app` | **Yes** |
| `ADMIN_COMMISSION_RATE` | Platform commission cut on vendor orders | `0.10` (10%) | No |
| `RAZORPAY_KEY_ID` | Razorpay API Key ID | `rzp_live_...` (or `rzp_test_...`) | **Yes** |
| `RAZORPAY_KEY_SECRET` | Razorpay API Key Secret | Secret token from Razorpay Dashboard | **Yes** |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay Webhook Signing Secret | Webhook secret from Razorpay Dashboard | **Yes** |

> [!CAUTION]
> The backend enforces strict production safeguards: if `NODE_ENV === 'production'`, the server will refuse to start if default development secrets (`marketplace-secret-key-2025`) or a missing `MONGODB_URI` are detected.

#### Health Check & Graceful Shutdown:
- **Health Check:** `GET /health` returns JSON reporting database connectivity, MongoDB topology (`ReplicaSetWithPrimary`), transactions support, and payment gateway status. Returns HTTP 200 when ready, HTTP 503 if degraded.
- **Graceful Shutdown:** The server listens for `SIGTERM` and `SIGINT` signals emitted by Render during deployments and scaling. It safely drains pending HTTP requests, closes active WebSockets, cleanly disconnects Mongoose, and terminates within 10 seconds.

---

### 2. Frontend Deployment (Netlify)

The React single-page application is compiled with Vite and served statically through Netlify. Configuration is managed via [`netlify.toml`](./netlify.toml) and [`frontend/public/_redirects`](./frontend/public/_redirects).

#### Netlify Build Settings:
- **Base directory:** `frontend`
- **Build command:** `npm run build`
- **Publish directory:** `dist` (or `frontend/dist` if configuring from root)
- **Node version:** `18`

#### Netlify Environment Variables:
Configure these in the Netlify Dashboard under **Site configuration > Environment variables**:

| Variable | Description | Production Example |
|---|---|---|
| `VITE_API_URL` | Production Backend API Base URL | `https://eg-marketplace-1.onrender.com` |
| `VITE_SOCKET_URL` | Production Socket.IO Server URL | `https://eg-marketplace-1.onrender.com` |

#### SPA Client-Side Routing:
To prevent HTTP 404 errors when refreshing dynamic client-side routes (e.g., `/cart`, `/checkout`, `/admin`, `/products/:id`), Netlify uses the redirect rule defined in `netlify.toml` and `_redirects`:
```
/*    /index.html   200
```
This rewrites all incoming deep links to `/index.html` with status 200, allowing React Router DOM to manage the view client-side.

---

### 3. Database Setup, Migrations & Indexing in Production

#### MongoDB Replica Set Requirement:
Payment-backed inventory operations, idempotency fences, and ledger reconciliation strictly require MongoDB multi-document ACID transactions. 
- **MongoDB Atlas:** All M0, M2, and dedicated clusters operate as a 3-node replica set (`ReplicaSetWithPrimary`) by default, fully supporting multi-document transactions out of the box.
- **Self-Hosted:** Ensure MongoDB is started with `--replSet <name>` and initialized via `rs.initiate()`.

#### Database Bootstrap Commands:
Run these commands once during initial deployment or after updating schemas:
```bash
cd backend

# 1. Run versioned schema migrations
npm run db:migrate

# 2. Build and verify required database indexes
npm run db:index

# 3. Seed initial admin account and default catalog
npm run db:seed

# Or execute all three in one automated command:
npm run db:setup
```

---

### 4. Razorpay Live Payment Gateway Setup

1. **API Keys:** Navigate to [Razorpay Dashboard](https://dashboard.razorpay.com/) > **Settings** > **API Keys**. Generate live keys and copy the **Key ID** and **Key Secret**.
2. **Webhook Configuration:**
   - In Razorpay Dashboard, navigate to **Settings** > **Webhooks**.
   - Add new webhook pointing to: `https://<your-render-url>/api/orders/webhook/razorpay`
   - Select Secret and set `RAZORPAY_WEBHOOK_SECRET` in your backend environment variables.
   - Subscribe to the following active events:
     - `payment.captured`
     - `payment.failed`
     - `order.paid`
     - `refund.processed`
3. **Automatic Webhook Signature Verification:** The backend verifies incoming webhooks using HMAC SHA-256 against raw JSON payloads and rejects forged requests with HTTP 400.

---

### 5. Jenkins CI/CD Pipeline

The project includes an enterprise-ready declarative [`Jenkinsfile`](./Jenkinsfile) that automates the continuous integration and delivery lifecycle:
1. **Checkout:** Clones the repository revision.
2. **Install Dependencies:** Runs clean installations (`npm ci`) across `backend` and `frontend`.
3. **Backend Integration Tests:** Executes the automated test suite (`npm run test:phase16`).
4. **Build Frontend:** Compiles production Vite bundles with code-splitting and asset optimization.
5. **Deploy Website:** Copies production artifacts to the web hosting directory (e.g. `/var/www/html/`).

---

### 6. Health Checks, Monitoring & Troubleshooting

#### Inspecting Health Status:
Ping the health-check endpoint:
```bash
curl https://<backend-domain>/health
```
Example JSON response:
```json
{
  "status": "ok",
  "uptime": 14205,
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

#### Common Issues & Resolutions:
- **`database.transactionsSupported: false`:** Your MongoDB connection string points to a standalone server. Point `MONGODB_URI` to a MongoDB Atlas cluster or initiate a replica set with `rs.initiate()`.
- **CORS Error in Browser Console:** Verify that the frontend domain (e.g. `https://egmarketplace.netlify.app`) is included in the backend's `FRONTEND_URLS` environment variable on Render.
- **Netlify Page Refresh Returns 404:** Ensure `_redirects` exists in `frontend/public/` and `netlify.toml` is present at the repository root.

## 🧪 Testing

To test the application:

1. Register as a buyer
2. Register as a vendor (with shop name)
3. As vendor: Add products
4. As buyer: Browse products, add to cart, checkout
5. As vendor: View orders, update status
6. As buyer: Rate products, open disputes
7. As admin: View dashboard, manage disputes

## 📚 Syllabus Concepts Used

### Node.js
- ✅ REPL, npm, npm init
- ✅ Local and third-party modules
- ✅ Core modules: fs, path, EventEmitter
- ✅ JSON handling
- ✅ Streams, zlib
- ✅ Callbacks, promises, async/await
- ✅ HTTP module (basic server)
- ✅ Express: GET/POST, bodyParser, Router, express-validator
- ✅ Socket.IO (basic WebSocket server)
- ✅ Middlewares: custom, cookie-parser, express-session
- ✅ MongoDB: CRUD operations, connection
- ✅ Mongoose: schema, models, CRUD

### React
- ✅ ES6: arrow functions, classes, let/const, array methods, destructuring, spread/rest
- ✅ JSX, createElement
- ✅ Functional components, props
- ✅ CSS, CSS modules
- ✅ Hooks: useState, useEffect, useContext, useRef, useReducer, useCallback, useMemo
- ✅ Forms: controlled components, validation
- ✅ HTTP: fetch(), axios
- ✅ React Router: navigation, query params
- ✅ Context API

## 🐛 Troubleshooting

### MongoDB Connection Error
- Ensure MongoDB is running: `mongod`
- Check connection string in `server.js`

### Port Already in Use
- Change port in `backend/server.js` or `frontend/vite.config.js`
- Update API URLs in frontend if backend port changes

### CORS Errors
- Check CORS configuration in `backend/server.js`
- Ensure frontend URL matches CORS origin

## 🛡️ Inventory Management, Multi-Document Transactions & Recovery

### 1. MongoDB Replica Set Deployment Requirement
Payment-backed inventory operations (order deduction, refund/cancellation stock restoration, and crash recovery) **strictly require MongoDB replica set multi-document transactions** (supported by default on MongoDB Atlas and local replica sets). 

> **Important Operational Rule**: If transactions are unavailable (e.g. standalone single-instance MongoDB without replica set enabled), the backend **safely refuses** payment-backed inventory mutations with an explicit `TransactionUnavailableError` (`transactionUnavailable: true`). The system **does not silently fall back to non-transactional stock mutations**, preventing overselling, partial inventory deductions, and Time-of-Check to Time-of-Use (TOCTOU) race conditions.

For local development with transactions, initiate a single-node replica set:
```bash
mongod --replSet rs0 --dbpath <data-directory>
# In mongosh:
rs.initiate()
```

### 2. Transactional Behavior
Every inventory state transition operates atomically within a single MongoDB session transaction (`session.startTransaction()`):
1. **Order Fencing & Claim Ownership Verification:** Ensures the executing worker owns the active lease and fencing token within the transaction boundary.
2. **Authoritative Idempotency Check:** Verifies against the durable `InventoryOperation` collection to guarantee duplicate requests or delayed retries never repeat an operation.
3. **Coupled Stock Mutation:** Updates product stock (`$inc`) and writes diagnostic history markers within the same atomic commit.
4. **Order Item & Lifecycle State Persistence:** Synchronously commits item-level `inventoryState` (`deducted`, `restored`, or `rolled_back`) and order-level `inventoryStatus` in the same transaction.
5. **Atomic Abort on Failure:** If any item lacks sufficient stock, if ownership is lost, or if a conflict occurs, `session.abortTransaction()` reverts all writes across all collections. Stock is never left partially deducted.

### 3. Recovery & Idempotency Architecture
- **Durable `InventoryOperation` Collection:** Idempotency is enforced by a dedicated collection with a globally unique B-Tree index on `operationId`. Unlike embedded document arrays, this ledger is never subject to eviction or truncation limits.
- **Active Worker Lease Protection:** Background recovery sweeps (`recoverInterruptedInventory`) check worker claim heartbeats against a 30-second stale lease threshold. Active, unexpired workers are never interrupted or rolled back.
- **Atomic Recovery Takeover:** Genuinely stale workers (> 30s timeout) are atomically reclaimed by incrementing the order's `claimVersion` fencing token before initiating recovery transactions.
- **Reconciliation Independence:** Recovery uses durable ledger records as the single source of truth, remaining 100% resilient even if older diagnostic markers on product documents are pruned.

### 4. Running Backend Test Suites
All integration tests run strictly against the dedicated test database (`marketplace_test`) without touching live or development data.

Run the master test suite:
```bash
npm --prefix backend test
```

Run individual test suites:
```bash
npm --prefix backend run test:security      # Socket.IO private rooms & RBAC isolation (20 tests)
npm --prefix backend run test:inventory     # Core inventory math & checkout validation (30 tests)
npm --prefix backend run test:concurrency   # Real DB concurrent deduction & compensation (53 tests)
npm --prefix backend run test:crash         # Crash boundary simulation & ground-truth reconciler (35 tests)
npm --prefix backend run test:durable       # Durable fencing tokens & stale worker rejection (49 tests)
npm --prefix backend run test:hard-fencing  # Hardest race deterministic hooks & recovery (45 tests)
npm --prefix backend run test:ownership     # Ledger state transitions & conditional updates (28 tests)
npm --prefix backend run test:transactions  # Multi-document transactions, active worker protection & refusal (45 tests)
```

## 📄 License

This project is for educational purposes.

## 👨‍💻 Author

Created as a college project demonstrating full-stack development skills.

