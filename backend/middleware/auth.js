const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { isAllowedOrigin } = require('./security');

const verifyToken = async (token) => {
  if (!token || typeof token !== 'string') {
    throw new Error('Authentication required');
  }

  const decoded = jwt.verify(token, process.env.JWT_SECRET || 'marketplace-secret-key-2025', {
    algorithms: ['HS256']
  });
  const user = await User.findById(decoded.userId).select('-password');
  
  if (!user) {
    throw new Error('User not found');
  }

  return user;
};

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const hasBearer = Boolean(authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer '));
    const token = (hasBearer ? authHeader.split(' ')[1] : null) || req.cookies?.token;

    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // CSRF defense-in-depth for state-changing requests authenticated solely via ambient cookie
    if (!hasBearer && req.cookies?.token) {
      const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
      if (isStateChanging) {
        const origin = req.headers.origin;
        if (origin && !isAllowedOrigin(origin)) {
          return res.status(403).json({ message: 'CSRF protection: untrusted origin for cookie-authenticated request' });
        }
      }
    }

    req.user = await verifyToken(token);
    next();
  } catch (error) {
    const message = error.message === 'Authentication required' ? 'Authentication required' : 'Invalid token';
    res.status(401).json({ message });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    next();
  };
};

function extractTokenFromSocket(socket) {
  // 1. Handshake auth object: socket.handshake.auth.token
  if (socket.handshake?.auth?.token && typeof socket.handshake.auth.token === 'string') {
    return socket.handshake.auth.token;
  }

  // 2. Authorization header: "Bearer <token>"
  const authHeader = socket.handshake?.headers?.authorization;
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }

  // 3. Cookie header: "token=<token>"
  const cookieHeader = socket.handshake?.headers?.cookie;
  if (cookieHeader && typeof cookieHeader === 'string') {
    const match = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
  }

  return null;
}

const authenticateSocket = async (socket, next) => {
  try {
    const token = extractTokenFromSocket(socket);
    if (!token) {
      return next(new Error('Authentication required'));
    }

    const user = await verifyToken(token);
    socket.user = user;
    next();
  } catch (error) {
    return next(new Error(error.message === 'Authentication required' ? 'Authentication required' : 'Invalid token'));
  }
};

module.exports = {
  authenticate,
  authorize,
  verifyToken,
  authenticateSocket,
  extractTokenFromSocket
};


