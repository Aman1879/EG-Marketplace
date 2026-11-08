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
const addressRoutes = require('./routes/addresses');

// Import middleware
const { authenticate, authenticateSocket } = require('./middleware/auth');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const {
  securityHeaders,
  sanitizeNoSql,
  authLimiter,
  contactLimiter,
  otpLimiter,
  sanitizeLogUrl,
  isAllowedOrigin
} = require('./middleware/security');
const Vendor = require('./models/Vendor');
const { notificationDeduplicator } = require('./utils/auditLogger');

// Create EventEmitter instance
const orderEventEmitter = new EventEmitter();

// Express app
const app = express();
app.disable('x-powered-by');
app.use(securityHeaders);

// Create basic HTTP server (syllabus requirement)
const httpServer = http.createServer(app);

// Middleware
const DEFAULT_ALLOWED_ORIGINS = [
  'https://egmarketplace.netlify.app',
  'https://eg-marketplace.netlify.app',
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

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.warn('Razorpay is not configured. Checkout payment endpoints will return setup errors until keys are added.');
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
app.use(sanitizeNoSql);
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'marketplace-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 24 * 60 * 60 * 1000 }
}));

// Custom logging middleware with sensitive parameter redaction
app.use((req, res, next) => {
  const sanitizedUrl = sanitizeLogUrl(req.url);
  const logMessage = `${new Date().toISOString()} - ${req.method} ${sanitizedUrl}\n`;
  fs.appendFile(path.join(__dirname, 'logs', 'order-log.txt'), logMessage, (err) => {
    if (err) console.error('Logging error:', err);
  });
  next();
});

// MongoDB connection
function maskMongoUri(uri) {
  if (!uri) return 'undefined';
  return uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
}

// Validate production security requirements
if (process.env.NODE_ENV === 'production') {
  if (!process.env.MONGODB_URI) {
    console.error('FATAL: MONGODB_URI is required in production environment.');
    process.exit(1);
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'marketplace-secret-key-2025') {
    console.error('FATAL: JWT_SECRET must be configured with a unique, secure key in production.');
    process.exit(1);
  }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'marketplace-secret-key-2025') {
    console.error('FATAL: SESSION_SECRET must be configured with a unique, secure key in production.');
    process.exit(1);
  }
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    console.warn('[Production Warning] Razorpay live credentials are not configured. Payment checkout endpoints will return 503 until keys are configured.');
  }
}

const MONGODB_URI = (process.env.NODE_ENV === 'test' ? process.env.TEST_MONGODB_URI : null) || process.env.MONGODB_URI || 'mongodb://localhost:27017/marketplace';

// Safe connection target logging
console.log('Connecting to MongoDB at:', maskMongoUri(MONGODB_URI));

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 15000,
})
  .then(() => {
    const topologyType = mongoose.connection.client?.topology?.description?.type || 'unknown';
    const isReplicaSet = topologyType === 'ReplicaSetWithPrimary' || topologyType === 'Sharded';
    if (isReplicaSet) {
      console.log(`MongoDB connected in replica set mode (${topologyType}) - transactions fully supported.`);
    } else {
      if (process.env.NODE_ENV === 'production') {
        console.warn(`[Production Alert] MongoDB connected in standalone mode (${topologyType || 'Standalone'}). Multi-document ACID transactions require a ReplicaSet or Sharded cluster (e.g. MongoDB Atlas).`);
      } else {
        console.log(`MongoDB connected in standalone mode (${topologyType || 'Standalone'}).`);
      }
    }
  })
  .catch(err => console.error('MongoDB connection error:', err));

// Health check endpoint for Render, Netlify, load balancers, and monitoring
app.get(['/health', '/api/health'], (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStateMap = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };
  const topologyType = mongoose.connection.client?.topology?.description?.type || 'unknown';
  const isReplicaSet = topologyType === 'ReplicaSetWithPrimary' || topologyType === 'Sharded';
  const isHealthy = dbState === 1;

  const healthStatus = {
    status: isHealthy ? 'ok' : 'degraded',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    database: {
      status: dbStateMap[dbState] || 'unknown',
      readyState: dbState,
      topology: topologyType,
      transactionsSupported: isReplicaSet
    },
    payments: {
      razorpayConfigured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
    },
    environment: process.env.NODE_ENV || 'development'
  };

  res.status(isHealthy ? 200 : 503).json(healthStatus);
});

// Basic HTTP root route
app.get('/', (req, res) => {
  res.send('Welcome to SpotBazar API');
});

// Routes
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/send-otp', otpLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/ratings', ratingRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/contact', contactLimiter, contactRoutes);
app.use('/api/addresses', addressRoutes);

// Catch unmatched /api routes
app.use('/api', notFoundHandler);
app.use('/api/*', notFoundHandler);

// Global Error Handler
app.use(errorHandler);

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

// Authenticate all incoming socket connections via JWT
io.use(authenticateSocket);

io.on('connection', async (socket) => {
  try {
    const user = socket.user;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    // 1. Join private personal user room for direct user notifications
    const userRoom = `user:${user._id.toString()}`;
    socket.join(userRoom);

    // 2. Join admin room if user role is admin
    if (user.role === 'admin') {
      socket.join('admin');
    }

    // 3. Join vendor shop rooms for all shops owned by this vendor user
    if (user.role === 'vendor') {
      const shops = await Vendor.find({ userId: user._id }).select('_id');
      for (const shop of shops) {
        socket.join(`vendor:${shop._id.toString()}`);
      }
    }

    console.log(`Authenticated socket connected: ${socket.id} (user: ${user._id}, role: ${user.role})`);

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  } catch (err) {
    console.error('Error during socket connection room setup:', err);
    socket.disconnect(true);
  }
});

// Global Event Listeners registered ONCE at server level (scoped to rooms)
orderEventEmitter.on('orderPlaced', (orderData) => {
  if (!orderData?.vendorId || !orderData?.orderId) return;
  if (!notificationDeduplicator.shouldDispatch(`socket:orderPlaced:${orderData.orderId}`)) {
    return;
  }
  const payload = {
    orderId: orderData.orderId,
    vendorId: orderData.vendorId,
    totalAmount: orderData.totalAmount,
    paymentStatus: orderData.paymentStatus
  };
  let target = io.to(`vendor:${orderData.vendorId}`).to('admin');
  if (orderData.buyerId) {
    target = target.to(`user:${orderData.buyerId}`);
  }
  target.emit('newOrder', payload);
});

orderEventEmitter.on('orderStatusUpdated', (orderData) => {
  if (!orderData?.orderId) return;
  const dedupKey = `socket:orderStatus:${orderData.orderId}:${orderData.status}`;
  if (!notificationDeduplicator.shouldDispatch(dedupKey)) {
    return;
  }
  const payload = {
    orderId: orderData.orderId,
    status: orderData.status
  };
  let target = io.to(`user:${orderData.buyerId}`);
  if (orderData.vendorId) {
    target = target.to(`vendor:${orderData.vendorId}`);
  }
  target.to('admin').emit('orderUpdate', payload);
});

orderEventEmitter.on('disputeCreated', (disputeData) => {
  if (!disputeData?.disputeId) return;
  if (!notificationDeduplicator.shouldDispatch(`socket:disputeCreated:${disputeData.disputeId}`)) {
    return;
  }
  const payload = {
    disputeId: disputeData.disputeId,
    vendorId: disputeData.vendorId
  };
  io.to(`vendor:${disputeData.vendorId}`)
    .to(`user:${disputeData.buyerId}`)
    .to('admin')
    .emit('newDispute', payload);
});

orderEventEmitter.on('disputeResolved', (disputeData) => {
  if (!disputeData?.disputeId) return;
  if (!notificationDeduplicator.shouldDispatch(`socket:disputeResolved:${disputeData.disputeId}`)) {
    return;
  }
  const payload = {
    disputeId: disputeData.disputeId,
    status: 'resolved'
  };
  io.to(`user:${disputeData.buyerId}`)
    .to(`vendor:${disputeData.vendorId}`)
    .to('admin')
    .emit('disputeUpdate', payload);
});

orderEventEmitter.on('vendorRequestSubmitted', (requestData) => {
  if (!requestData?.vendorId) return;
  if (!notificationDeduplicator.shouldDispatch(`socket:vendorRequest:${requestData.vendorId}`)) {
    return;
  }
  const payload = {
    vendorId: requestData.vendorId,
    shopName: requestData.shopName
  };
  io.to('admin').emit('newVendorRequest', payload);
});

orderEventEmitter.on('vendorApprovalUpdated', async (approvalData) => {
  if (!approvalData?.userId) return;
  const dedupKey = `socket:vendorApproval:${approvalData.vendorId}:${approvalData.approvalStatus}`;
  if (!notificationDeduplicator.shouldDispatch(dedupKey)) {
    return;
  }
  const payload = {
    vendorId: approvalData.vendorId,
    shopName: approvalData.shopName,
    approvalStatus: approvalData.approvalStatus
  };
  io.to(`user:${approvalData.userId}`).to('admin').emit('vendorApprovalUpdate', payload);

  // If approved, dynamically join the new vendor room for active sockets of this user
  if (approvalData.approvalStatus === 'approved' && approvalData.vendorId) {
    try {
      const sockets = await io.in(`user:${approvalData.userId}`).fetchSockets();
      for (const s of sockets) {
        s.join(`vendor:${approvalData.vendorId}`);
      }
    } catch (err) {
      console.error('Error adding approved vendor socket to vendor room:', err);
    }
  }
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
if (require.main === module) {
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT} (bound to 0.0.0.0)`);
  });
}

// Graceful shutdown handling for cloud platforms (Render, Kubernetes, Docker)
function gracefulShutdown(signal) {
  console.log(`Received ${signal}. Starting graceful shutdown...`);

  httpServer.close(async () => {
    console.log('HTTP and WebSocket server closed.');
    try {
      await mongoose.connection.close(false);
      console.log('MongoDB connection cleanly closed.');
      process.exit(0);
    } catch (err) {
      console.error('Error during database disconnection:', err.message);
      process.exit(1);
    }
  });

  setTimeout(() => {
    console.error('Graceful shutdown timeout exceeded (10s). Forcing termination.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = { app, io, orderEventEmitter };
