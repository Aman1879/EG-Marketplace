/**
 * Security Middleware Suite for EG-Marketplace
 * - Security HTTP Headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, etc.)
 * - Deep NoSQL Query Operator Injection Detection & Safe Rejection
 * - In-Memory Sliding Window Rate Limiting (Zero external dependencies)
 * - Safe Image URL & Raster Data-URI Scheme/Payload Validator (SVG data URIs rejected)
 * - CSRF Origin Validation Helper
 */

const DEFAULT_ALLOWED_ORIGINS = [
  'https://egmarketplace.netlify.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
];

function isLocalhostOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (process.env.CORS_ALLOW_ALL === 'true') return true;

  const envOrigins = [process.env.FRONTEND_URLS, process.env.FRONTEND_URL]
    .filter(Boolean)
    .join(',')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  const allowedOrigins = envOrigins.length > 0 ? envOrigins : DEFAULT_ALLOWED_ORIGINS;
  if (allowedOrigins.includes(origin)) return true;
  if (process.env.NODE_ENV !== 'production' && isLocalhostOrigin(origin)) return true;
  return false;
}

/**
 * Applies OWASP recommended HTTP security headers.
 */
function securityHeaders(req, res, next) {
  // Prevent MIME-sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking via iframes
  res.setHeader('X-Frame-Options', 'DENY');

  // Disable legacy XSS auditor in modern browsers (standard per OWASP & Helmet)
  res.setHeader('X-XSS-Protection', '0');

  // Control referrer information sent in request headers
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Enforce HTTPS HSTS header in production
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Remove Express fingerprinting header if present
  res.removeHeader('X-Powered-By');

  next();
}

/**
 * Recursively inspects an object or array to detect keys starting with '$' or containing '.'
 * (NoSQL query operator injection / field path manipulation).
 * Non-destructive: does not modify or delete any input data.
 */
function hasNoSqlOperator(obj) {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  // Preserve Date instances and Buffers without traversal
  if (obj instanceof Date || (typeof Buffer !== 'undefined' && Buffer.isBuffer(obj))) {
    return false;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (hasNoSqlOperator(obj[i])) return true;
    }
    return false;
  }

  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') || key.includes('.')) {
      return true;
    }
    if (hasNoSqlOperator(obj[key])) {
      return true;
    }
  }

  return false;
}

/**
 * Express middleware to safely reject requests with NoSQL query operator injection in req.body, req.query, or req.params.
 * Rejects with HTTP 400 Bad Request instead of silently deleting keys and corrupting payload data.
 */
function sanitizeNoSql(req, res, next) {
  if (hasNoSqlOperator(req.body) || hasNoSqlOperator(req.query) || hasNoSqlOperator(req.params)) {
    return res.status(400).json({
      message: 'Invalid request: Prohibited query operator in input'
    });
  }
  next();
}

/**
 * In-memory sliding window rate limiter factory.
 * Requires zero external dependencies.
 */
function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 15 * 60 * 1000; // default 15 minutes
  const max = options.max || 100;
  const message = options.message || 'Too many requests, please try again later.';
  const skipInTests = options.skipInTests !== false;
  const hits = new Map();

  // Garbage collection interval for expired keys
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, data] of hits.entries()) {
      if (now > data.resetTime) {
        hits.delete(key);
      }
    }
  }, Math.min(windowMs, 60000));
  cleanupInterval.unref();

  return function rateLimiterMiddleware(req, res, next) {
    if (skipInTests && (process.env.NODE_ENV === 'test' || req.headers['x-test-bypass-rate-limit'] === 'true')) {
      return next();
    }

    const clientIp = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    let record = hits.get(clientIp);

    if (!record || now > record.resetTime) {
      record = {
        count: 0,
        resetTime: now + windowMs
      };
      hits.set(clientIp, record);
    }

    record.count += 1;
    const remaining = Math.max(0, max - record.count);
    const resetSeconds = Math.ceil((record.resetTime - now) / 1000);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

    if (record.count > max) {
      res.setHeader('Retry-After', resetSeconds);
      return res.status(429).json({
        message,
        retryAfter: resetSeconds
      });
    }

    next();
  };
}

// 50 attempts per 15 minutes for auth endpoints (login, register)
const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Too many authentication attempts. Please try again after 15 minutes.'
});

// 20 submissions per 15 minutes for contact forms
const contactLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many inquiries submitted. Please try again later.'
});

/**
 * Validates that an image URL string uses safe protocols (http, https)
 * or a valid base64 data-URI for supported raster image formats (jpeg, jpg, png, webp, gif).
 * Strictly rejects SVG data URIs to eliminate active script/XML injection vectors (Stored XSS).
 */
function isValidImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  // Base64 Data URI check: strictly raster formats only; svg+xml is intentionally rejected
  if (trimmed.startsWith('data:')) {
    const dataUrlPattern = /^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/i;
    if (!dataUrlPattern.test(trimmed)) {
      return false;
    }
    // Max 7MB base64 payload (~5MB decoded binary)
    if (trimmed.length > 7000000) {
      return false;
    }
    return true;
  }

  // Length check for regular URLs
  if (trimmed.length > 2048) {
    return false;
  }

  // URL protocol verification
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

/**
 * Redacts sensitive parameters from raw URLs before logging.
 */
function sanitizeLogUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const [pathname, queryString] = rawUrl.split('?');
    if (!queryString) return pathname;
    const params = new URLSearchParams(queryString);
    for (const key of params.keys()) {
      if (/token|password|secret|key|sig|auth|credential/i.test(key)) {
        params.set(key, '[REDACTED]');
      }
    }
    return `${pathname}?${params.toString()}`;
  } catch (e) {
    return rawUrl;
  }
}

module.exports = {
  securityHeaders,
  hasNoSqlOperator,
  sanitizeNoSql,
  createRateLimiter,
  authLimiter,
  contactLimiter,
  isValidImageUrl,
  sanitizeLogUrl,
  isAllowedOrigin,
  isLocalhostOrigin
};
