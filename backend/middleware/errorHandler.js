/**
 * Global Error Handling & 404 Middleware
 * 
 * Ensures:
 * 1. Consistent JSON error structure: { success: false, message: '...', ... }
 * 2. Predictable HTTP status codes (400, 401, 403, 404, 500).
 * 3. Never leaks stack traces, database internals, secrets, or sensitive payment info.
 * 4. Catches invalid JSON payload errors from body-parser gracefully.
 */

function notFoundHandler(req, res, next) {
  res.status(404).json({
    success: false,
    message: `API route not found: ${req.method} ${req.originalUrl}`
  });
}

function errorHandler(err, req, res, next) {
  // 1. JSON parsing syntax error from body-parser
  if (err instanceof SyntaxError && (err.status === 400 || err.statusCode === 400) && 'body' in err) {
    return res.status(400).json({
      success: false,
      message: 'Invalid JSON payload. Please check your request body format.'
    });
  }

  // 2. CORS origin forbidden
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      message: 'Access forbidden: Request origin is not allowed by CORS policy'
    });
  }

  // 3. Mongoose CastError (e.g. invalid ObjectId format)
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: `Invalid format for identifier "${err.value}" at path "${err.path}"`
    });
  }

  // 4. Mongoose ValidationError
  if (err.name === 'ValidationError') {
    const errorDetails = Object.values(err.errors || {}).map(e => e.message);
    return res.status(400).json({
      success: false,
      message: errorDetails.length > 0 ? errorDetails[0] : 'Validation failed',
      errors: errorDetails
    });
  }

  // 5. JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid authentication token'
    });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Authentication token has expired'
    });
  }

  // 6. Custom or Express status errors
  const statusCode = typeof err.status === 'number' && err.status >= 400 && err.status < 600
    ? err.status
    : (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500);

  let clientMessage = err.message || 'Internal server error';

  // Sanitize internal database connection strings, credentials, or secrets
  if (clientMessage.includes('mongodb') || clientMessage.includes('password') || clientMessage.includes('secret') || clientMessage.includes('key')) {
    clientMessage = 'An unexpected server error occurred';
  }

  if (statusCode === 500) {
    console.error(`[Unhandled API Error] ${req.method} ${req.url}:`, err.message);
    if (process.env.NODE_ENV === 'production') {
      clientMessage = 'Internal server error';
    }
  }

  return res.status(statusCode).json({
    success: false,
    message: clientMessage
  });
}

module.exports = {
  notFoundHandler,
  errorHandler
};

