// Basic HTTP module server (syllabus requirement)
const http = require('http');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

// Load environment variables
require('dotenv').config();

// Express setup
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const cors = require('cors');
const mongoose = require('mongoose');
const socketIo = require('socket.io');

// Import routes
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const ratingRoutes = require('./routes/ratings');
const disputeRoutes = require('./routes/disputes');
const adminRoutes = require('./routes/admin');
const vendorRoutes = require('./routes/vendors');
const cartRoutes = require('./routes/cart');
const contactRoutes = require('./routes/contact');

// Import middleware
const { authenticate } = require('./middleware/auth');

// Create EventEmitter instance
const orderEventEmitter = new EventEmitter();

// Express app
const app = express();

// Create basic HTTP server (syllabus requirement)
const httpServer = http.createServer(app);

// Middleware
const DEFAULT_ALLOWED_ORIGINS = [
  'https://egmarketplace.netlify.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
];

const envOrigins = [process.env.FRONTEND_URLS, process.env.FRONTEND_URL]
  .filter(Boolean)
  .join(',')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = envOrigins.length > 0 ? envOrigins : DEFAULT_ALLOWED_ORIGINS;
const CORS_ALLOW_ALL = process.env.CORS_ALLOW_ALL === 'true';

function isLocalhostOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (CORS_ALLOW_ALL) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (process.env.NODE_ENV !== 'production' && isLocalhostOrigin(origin)) return true;
  return false;
}

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests and approved browser origins.
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
};

app.use(cors(corsOptions));
// Razorpay webhook signature verification requires the raw request body.
app.use('/api/orders/webhook/razorpay', express.raw({ type: 'application/json' }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'marketplace-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 24 * 60 * 60 * 1000 }
}));

// Custom logging middleware
app.use((req, res, next) => {
  const logMessage = `${new Date().toISOString()} - ${req.method} ${req.url}\n`;
  fs.appendFile(path.join(__dirname, 'logs', 'order-log.txt'), logMessage, (err) => {
    if (err) console.error('Logging error:', err);
  });
  next();
});

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/marketplace';

// Debug connection target
console.log('Trying to connect to:', MONGODB_URI);

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 15000,
})
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Basic HTTP root route
app.get('/', (req, res) => {
  res.send('Welcome to Eg Marketplace API');
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/ratings', ratingRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/contact', contactRoutes);

// Socket.IO setup
const io = socketIo(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true
  }
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });

  // Listeners for real-time events
  orderEventEmitter.on('orderPlaced', (orderData) => {
    io.emit('newOrder', orderData);
  });

  orderEventEmitter.on('orderStatusUpdated', (orderData) => {
    io.emit('orderUpdate', orderData);
  });

  orderEventEmitter.on('disputeCreated', (disputeData) => {
    io.emit('newDispute', disputeData);
  });

  orderEventEmitter.on('disputeResolved', (disputeData) => {
    io.emit('disputeUpdate', disputeData);
  });
});

// Make EventEmitter global
global.orderEventEmitter = orderEventEmitter;

// Create logs folder if missing
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Start server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = { app, io, orderEventEmitter };
