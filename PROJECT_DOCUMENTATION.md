# Eg Marketplace - Complete Project Documentation

## 📋 Table of Contents
1. [Project Overview](#project-overview)
2. [Technologies Used](#technologies-used)
3. [Project Structure](#project-structure)
4. [Features & Functionality](#features--functionality)
5. [Database Schema](#database-schema)
6. [API Endpoints](#api-endpoints)
7. [User Roles & Permissions](#user-roles--permissions)
8. [Setup & Installation](#setup--installation)
9. [Environment Variables](#environment-variables)
10. [Development Workflow](#development-workflow)
11. [Deployment Guide](#deployment-guide)
12. [Security Features](#security-features)
13. [Future Enhancements](#future-enhancements)

---

## 🎯 Project Overview

**Eg Marketplace** is a full-stack e-commerce platform designed specifically for the Indian market. It connects buyers and sellers through a modern, user-friendly digital marketplace. The platform supports multiple user roles (Buyers, Vendors, and Admins) with role-based access control and comprehensive features for product management, order processing, dispute resolution, and administrative oversight.

### Key Highlights
- **Public Homepage**: Accessible to all visitors without login
- **Multi-Shop Support**: Vendors can create and manage multiple shops
- **Category-Based Browsing**: Products organized by categories
- **Real-Time Notifications**: Socket.IO for live updates
- **Persistent Shopping Cart**: Cart saved in database
- **Dispute Resolution System**: Built-in dispute management
- **Admin Dashboard**: Comprehensive admin panel with analytics
- **Indian Localization**: Currency (INR), phone numbers, addresses

---

## 🛠 Technologies Used

### Frontend
- **React 18.2.0** - UI library
- **React Router DOM 6.16.0** - Client-side routing
- **Axios 1.5.1** - HTTP client for API calls
- **Socket.IO Client 4.6.1** - Real-time communication
- **Vite 4.4.9** - Build tool and dev server
- **CSS3** - Styling with custom CSS files

### Backend
- **Node.js** - Runtime environment
- **Express 4.18.2** - Web framework
- **MongoDB 7.5.0** (via Mongoose) - Database
- **Socket.IO 4.6.1** - Real-time server
- **JWT (jsonwebtoken 9.0.2)** - Authentication
- **bcryptjs 2.4.3** - Password hashing
- **express-validator 7.0.1** - Input validation
- **cookie-parser 1.4.6** - Cookie handling
- **express-session 1.17.3** - Session management
- **CORS 2.8.5** - Cross-origin resource sharing

### Development Tools
- **Concurrently 8.2.2** - Run multiple commands
- **dotenv 17.2.3** - Environment variables

---

## 📁 Project Structure

```
MarketPlace/
├── backend/                    # Backend server
│   ├── models/                 # MongoDB schemas
│   │   ├── User.js            # User model (buyer/vendor/admin)
│   │   ├── Vendor.js          # Vendor shop model
│   │   ├── Product.js          # Product model
│   │   ├── Order.js           # Order model
│   │   ├── CartItem.js        # Shopping cart model
│   │   ├── Commission.js      # Admin commission records
│   │   ├── Dispute.js         # Dispute resolution model
│   │   ├── Rating.js          # Product ratings model
│   │   └── ContactMessage.js  # Contact form messages
│   ├── routes/                 # API routes
│   │   ├── auth.js            # Authentication routes
│   │   ├── products.js        # Product CRUD operations
│   │   ├── orders.js          # Order management
│   │   ├── vendors.js         # Vendor/shop management
│   │   ├── cart.js            # Shopping cart operations
│   │   ├── admin.js           # Admin dashboard APIs
│   │   ├── disputes.js        # Dispute resolution
│   │   ├── ratings.js         # Product ratings
│   │   └── contact.js         # Contact form handling
│   ├── middleware/             # Custom middleware
│   │   └── auth.js            # Authentication & authorization
│   ├── scripts/               # Utility scripts
│   │   ├── create-admin.js    # Create admin user
│   │   ├── fix-vendor-index.js # Database fixes
│   │   └── verify-admin.js    # Verify admin credentials
│   ├── logs/                  # Application logs
│   ├── server.js              # Main server file
│   ├── package.json           # Backend dependencies
│   └── ENV_EXAMPLE.md         # Environment variables guide
│
├── frontend/                   # React frontend
│   ├── src/
│   │   ├── components/        # Reusable components
│   │   │   ├── Navbar.jsx    # Navigation bar
│   │   │   ├── Footer.jsx     # Website footer
│   │   │   ├── AdminFooter.jsx # Admin panel footer
│   │   │   ├── Logo.jsx       # Website logo
│   │   │   ├── ProductCard.jsx # Product display card
│   │   │   ├── Notification.jsx # Toast notifications
│   │   │   └── ProtectedRoute.jsx # Route protection
│   │   ├── pages/             # Page components
│   │   │   ├── Home.jsx       # Public homepage
│   │   │   ├── Products.jsx   # Product listing
│   │   │   ├── ProductDetail.jsx # Product details
│   │   │   ├── Cart.jsx       # Shopping cart
│   │   │   ├── Checkout.jsx   # Checkout process
│   │   │   ├── Login.jsx      # User login
│   │   │   ├── Register.jsx   # User registration
│   │   │   ├── OrderHistory.jsx # Order history
│   │   │   ├── VendorDashboard.jsx # Vendor panel
│   │   │   ├── VendorOnboarding.jsx # Vendor setup
│   │   │   ├── VendorCreateShop.jsx # Shop creation
│   │   │   ├── AdminDashboard.jsx # Admin panel
│   │   │   ├── DisputeCenter.jsx # Dispute management
│   │   │   ├── ShopPage.jsx   # Vendor shop page
│   │   │   ├── ContactUs.jsx  # Contact page
│   │   │   └── OurStory.jsx   # About page
│   │   ├── context/           # React context
│   │   │   └── AuthContext.jsx # Authentication state
│   │   ├── hooks/             # Custom hooks
│   │   │   └── useSocket.js   # Socket.IO hook
│   │   ├── config/            # Configuration
│   │   │   └── api.js         # API endpoints config
│   │   ├── App.jsx            # Main app component
│   │   ├── main.jsx           # Entry point
│   │   └── index.css          # Global styles
│   ├── index.html             # HTML template
│   ├── vite.config.js         # Vite configuration
│   └── package.json           # Frontend dependencies
│
├── README.md                  # Basic project readme
├── PROJECT_DOCUMENTATION.md   # This file
├── PROJECT_CLEANUP_SUMMARY.md # Cleanup documentation
├── API_DOCUMENTATION.md       # API reference
├── DEPLOYMENT.md              # Deployment guide
└── package.json               # Root package.json
```

---

## ✨ Features & Functionality

### Public Features (No Login Required)
- **Browse Products**: View all products with search and category filtering
- **View Categories**: Browse products by category
- **View Shops**: See vendor shop pages
- **Product Details**: View detailed product information
- **Search**: Global search functionality across all pages

### Buyer Features
- **User Registration & Login**: Secure authentication
- **Dashboard**: Personalized dashboard with categories and products
- **Shopping Cart**: Add, remove, update items (persisted in database)
- **Checkout**: Complete purchase flow
- **Order History**: View all past orders
- **Product Ratings**: Rate products (1-5 stars)
- **Dispute Creation**: Open disputes for orders
- **Profile Management**: View account information

### Vendor Features
- **Vendor Registration**: Register as vendor
- **Onboarding Flow**: Step-by-step vendor setup
- **Multi-Shop Support**: Create and manage multiple shops
- **Shop Management**: 
  - Shop name, logo, banner
  - Description and categories
  - Contact information
  - Address details
- **Product Management**:
  - Add products with images (URL or file upload)
  - Edit product details
  - Set prices in INR
  - Manage inventory
- **Order Management**: View and process buyer orders
- **Earnings Tracking**: View total earnings and commission
- **Dispute Response**: Respond to buyer disputes
- **Real-Time Notifications**: Get notified of new orders

### Admin Features
- **Admin Dashboard**: Comprehensive analytics
- **Statistics**:
  - Total users, vendors, products, orders
  - Total revenue and commission
  - Contact message statistics
- **Commission Records**: View all commission transactions
- **Vendor Earnings Summary**: 
  - Shop name, vendor details
  - Total revenue per vendor
  - Vendor earnings
  - Admin commission per vendor
  - Order counts
- **Contact Messages**: 
  - View all contact form submissions
  - Filter by status (new, read, replied)
  - Mark as read/replied
  - Delete messages
  - Reply via email
- **User Management**: View all users and vendors
- **System Monitoring**: Track platform health

### Additional Features
- **Real-Time Notifications**: Socket.IO for live updates
- **Dispute Resolution System**: Complete dispute workflow
- **Product Ratings**: 1-5 star rating system
- **Category Filtering**: Accurate category-based product display
- **Search Functionality**: Search across products, categories, shops
- **Responsive Design**: Mobile-friendly interface
- **Indian Localization**: 
  - INR currency
  - Indian phone number format
  - Indian address structure (State, PIN code)
  - Country default: India

---

## 🗄 Database Schema

### User Model
```javascript
{
  username: String (unique, required),
  email: String (unique, required),
  password: String (hashed, required),
  role: Enum ['buyer', 'vendor', 'admin'],
  createdAt: Date
}
```

### Vendor Model
```javascript
{
  userId: ObjectId (ref: User, indexed),
  shopName: String (required),
  description: String,
  category: String,
  categories: [String],
  country: String (default: 'India'),
  logoUrl: String,
  bannerUrl: String,
  address: String,
  contactEmail: String,
  contactPhone: String,
  averageRating: Number,
  totalRatings: Number,
  onboardingComplete: Boolean,
  totalEarnings: Number,
  createdAt: Date
}
```

### Product Model
```javascript
{
  vendorId: ObjectId (ref: Vendor, required),
  title: String (required),
  description: String,
  price: Number (required),
  category: String (required),
  images: [String],
  stock: Number (default: 0),
  averageRating: Number,
  totalRatings: Number,
  createdAt: Date
}
```

### Order Model
```javascript
{
  buyerId: ObjectId (ref: User, required),
  vendorId: ObjectId (ref: Vendor, required),
  products: [{
    productId: ObjectId,
    quantity: Number,
    price: Number
  }],
  totalAmount: Number,
  vendorEarning: Number,
  adminCommission: Number,
  shippingAddress: Object,
  status: Enum ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'],
  createdAt: Date
}
```

### CartItem Model
```javascript
{
  userId: ObjectId (ref: User, required),
  productId: ObjectId (ref: Product, required),
  quantity: Number (required),
  createdAt: Date
}
```

### Commission Model
```javascript
{
  orderId: ObjectId (ref: Order, required),
  totalAmount: Number,
  vendorEarning: Number,
  commissionAmount: Number,
  commissionRate: Number (default: 0.10),
  createdAt: Date
}
```

### Dispute Model
```javascript
{
  orderId: ObjectId (ref: Order, required),
  buyerId: ObjectId (ref: User, required),
  vendorId: ObjectId (ref: Vendor, required),
  reason: Enum ['not received', 'damaged product', 'wrong item', 'refund issue', 'other'],
  description: String,
  images: [String],
  status: Enum ['open', 'vendor-responded', 'under-review', 'resolved', 'rejected'],
  vendorResponse: String,
  adminNotes: String,
  createdAt: Date,
  updatedAt: Date
}
```

### Rating Model
```javascript
{
  productId: ObjectId (ref: Product, required),
  userId: ObjectId (ref: User, required),
  rating: Number (1-5, required),
  comment: String,
  createdAt: Date
}
```

### ContactMessage Model
```javascript
{
  name: String (required),
  email: String (required),
  subject: String (required),
  message: String (required),
  status: Enum ['new', 'read', 'replied', 'archived'],
  createdAt: Date,
  updatedAt: Date
}
```

---

## 🔌 API Endpoints

### Authentication (`/api/auth`)
- `POST /register` - Register new user
- `POST /login` - User login
- `POST /logout` - User logout
- `GET /me` - Get current user

### Products (`/api/products`)
- `GET /` - Get all products (with optional category filter)
- `GET /:id` - Get product by ID
- `POST /` - Create product (vendor only)
- `PUT /:id` - Update product (vendor only)
- `DELETE /:id` - Delete product (vendor only)

### Orders (`/api/orders`)
- `POST /` - Create order (buyer only)
- `GET /buyer/my-orders` - Get buyer's orders
- `GET /vendor/my-orders` - Get vendor's orders
- `PUT /:id/status` - Update order status (vendor only)

### Vendors (`/api/vendors`)
- `POST /create` - Create/update shop
- `GET /shops` - Get all shops (with optional category filter)
- `GET /shop/:id` - Get shop by ID
- `GET /profile` - Get vendor profile

### Cart (`/api/cart`)
- `GET /` - Get user's cart
- `POST /add` - Add item to cart
- `PUT /update` - Update cart item quantity
- `DELETE /remove/:productId` - Remove item from cart
- `DELETE /clear` - Clear entire cart

### Admin (`/api/admin`)
- `GET /dashboard` - Get dashboard statistics
- `GET /commissions` - Get all commission records
- `GET /vendor-earnings` - Get vendor earnings summary

### Disputes (`/api/disputes`)
- `POST /` - Create dispute (buyer only)
- `GET /buyer` - Get buyer's disputes
- `GET /vendor` - Get vendor's disputes
- `PUT /:id/respond` - Vendor response
- `PUT /:id/resolve` - Admin resolution

### Ratings (`/api/ratings`)
- `POST /` - Add product rating
- `GET /product/:productId` - Get product ratings

### Contact (`/api/contact`)
- `POST /submit` - Submit contact form
- `GET /messages` - Get all messages (admin only)
- `GET /messages/:id` - Get message by ID (admin only)
- `PUT /messages/:id/status` - Update message status (admin only)
- `DELETE /messages/:id` - Delete message (admin only)
- `GET /stats` - Get message statistics (admin only)

---

## 👥 User Roles & Permissions

### Buyer
- Can browse all products and shops
- Can create account and login
- Can add products to cart
- Can place orders
- Can view order history
- Can rate products
- Can create disputes
- Cannot access vendor or admin features

### Vendor
- All buyer permissions
- Can create and manage shops
- Can add/edit/delete products
- Can view and process orders
- Can respond to disputes
- Can view earnings
- Cannot access admin features

### Admin
- All permissions
- Can view all users, vendors, products, orders
- Can view commission records
- Can view vendor earnings
- Can manage contact messages
- Can resolve disputes
- Can view system statistics

---

## 🚀 Setup & Installation

### Prerequisites
- Node.js (v14 or higher)
- MongoDB (local or Atlas)
- npm or yarn

### Step 1: Clone Repository
```bash
git clone <repository-url>
cd MarketPlace
```

### Step 2: Install Dependencies
```bash
# Install root dependencies
npm install

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### Step 3: Configure Environment Variables

**Backend** (`backend/.env`):
```env
MONGODB_URI=mongodb://localhost:27017/marketplace
PORT=3000
JWT_SECRET=your-secure-jwt-secret-key-here
SESSION_SECRET=your-secure-session-secret-key-here
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
```

**Frontend** (`frontend/.env`):
```env
VITE_API_URL=http://localhost:3000
VITE_SOCKET_URL=http://localhost:3000
```

### Step 4: Start MongoDB
```bash
# If using local MongoDB
mongod

# Or use MongoDB Atlas (cloud)
# Update MONGODB_URI in .env
```

### Step 5: Create Admin User
```bash
cd backend
node scripts/create-admin.js
```

### Step 6: Start Development Servers

**Option 1: Run separately**
```bash
# Terminal 1 - Backend
cd backend
npm start

# Terminal 2 - Frontend
cd frontend
npm run dev
```

**Option 2: Run together (from root)**
```bash
npm run dev
```

### Step 7: Access Application
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000

---

## 🔐 Environment Variables

### Backend Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/marketplace` | Yes |
| `PORT` | Server port | `3000` | No |
| `JWT_SECRET` | JWT token secret | `marketplace-secret-key-2025` | Yes (change in production) |
| `SESSION_SECRET` | Session secret | `marketplace-secret-key-2025` | Yes (change in production) |
| `FRONTEND_URL` | Frontend URL for CORS | `http://localhost:5173` | Yes |
| `NODE_ENV` | Environment mode | `development` | No |

### Frontend Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `VITE_API_URL` | Backend API URL | `http://localhost:3000` | Yes |
| `VITE_SOCKET_URL` | Socket.IO server URL | `http://localhost:3000` | Yes |

**Important**: In production, always use secure, randomly generated secrets for `JWT_SECRET` and `SESSION_SECRET`.

---

## 💻 Development Workflow

### Code Structure
- **Frontend**: React components in `frontend/src/`
- **Backend**: Express routes in `backend/routes/`
- **Database**: Mongoose models in `backend/models/`
- **API Config**: Centralized in `frontend/src/config/api.js`

### Adding New Features
1. Create/update model in `backend/models/`
2. Create/update route in `backend/routes/`
3. Create/update frontend component in `frontend/src/pages/` or `components/`
4. Add route in `frontend/src/App.jsx` if needed
5. Update API config if new endpoints

### Testing
- Test authentication flow
- Test role-based access
- Test API endpoints
- Test real-time notifications
- Test on different screen sizes

---

## 🌐 Deployment Guide

See `DEPLOYMENT.md` for detailed deployment instructions.

### Quick Deployment Checklist
- [ ] Set production environment variables
- [ ] Update CORS settings
- [ ] Use secure JWT and session secrets
- [ ] Configure MongoDB Atlas (or production DB)
- [ ] Build frontend: `npm run build`
- [ ] Deploy backend to hosting service
- [ ] Deploy frontend to CDN/hosting
- [ ] Test all functionality
- [ ] Set up monitoring

---

## 🔒 Security Features

- **Password Hashing**: bcryptjs with salt rounds
- **JWT Authentication**: Secure token-based auth
- **Session Management**: Secure session cookies
- **CORS Protection**: Configured for specific origins
- **Input Validation**: express-validator for all inputs
- **Role-Based Access**: Middleware for route protection
- **SQL Injection Protection**: Mongoose ODM prevents injection
- **XSS Protection**: React automatically escapes content
- **Secure Cookies**: HttpOnly, Secure in production

---

## 📈 Future Enhancements

### Potential Features
- Payment gateway integration (Razorpay, Stripe)
- Email notifications
- Advanced search with filters
- Product reviews and comments
- Wishlist functionality
- Coupon/discount system
- Analytics dashboard for vendors
- Multi-language support
- Mobile app (React Native)
- Image optimization and CDN
- Advanced reporting
- Automated testing suite
- CI/CD pipeline

---

## 📞 Support & Contact

For issues, questions, or contributions:
- Check existing documentation
- Review API documentation
- Check deployment guide
- Contact: Via contact form on website

---

## 📄 License

This project is proprietary software. All rights reserved.

---

## 🎉 Acknowledgments

Built with modern web technologies for the Indian e-commerce market.

**Version**: 1.0.0  
**Last Updated**: 2025  
**Maintained By**: Eg Marketplace Team

---

*This documentation is comprehensive and covers all aspects of the Eg Marketplace project. For specific API details, see `API_DOCUMENTATION.md`. For deployment, see `DEPLOYMENT.md`.*

