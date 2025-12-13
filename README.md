# Online Marketplace Platform

A full-stack multi-vendor marketplace platform inspired by Etsy, built with Node.js, Express, MongoDB, and React.

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

### 4. MongoDB Setup

Make sure MongoDB is running on your local machine:

```bash
# On Windows (if MongoDB is installed as a service, it should start automatically)
# Or start manually:
mongod

# On Mac/Linux
sudo systemctl start mongod
# or
mongod
```

### 5. Create Admin User (Optional)

You can create an admin user by registering through the frontend and then manually updating the role in MongoDB:

```javascript
// In MongoDB shell
use marketplace
db.users.updateOne({email: "admin@example.com"}, {$set: {role: "admin"}})
```

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

## 🚢 Deployment

### Backend Deployment

1. Set environment variables:
   - `PORT` (default: 3000)
   - `MONGODB_URI` (your MongoDB connection string)

2. Deploy to platforms like:
   - Heroku
   - Railway
   - Render
   - DigitalOcean

### Frontend Deployment

1. Build the production bundle:
   ```bash
   cd frontend
   npm run build
   ```

2. Deploy the `dist` folder to:
   - Vercel
   - Netlify
   - GitHub Pages
   - Any static hosting service

### GitHub Deployment

1. Push code to GitHub repository
2. Connect to hosting service
3. Configure build commands and environment variables
4. Deploy!

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

## 📄 License

This project is for educational purposes.

## 👨‍💻 Author

Created as a college project demonstrating full-stack development skills.

---

**Note**: This is a learning project. For production use, consider adding:
- Input sanitization
- Rate limiting
- Error handling improvements
- Unit tests
- Integration tests
- Security enhancements
- Image upload functionality
- Payment gateway integration

