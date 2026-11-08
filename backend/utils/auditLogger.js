const AuditLog = require('../models/AuditLog');

// Sensitive keys to redact from audit logs
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'secret',
  'signature',
  'razorpaysignature',
  'transferclaimtoken',
  'token',
  'refreshtoken',
  'keysecret',
  'cvv',
  'cardnumber',
  'webhooksecret'
]);

/**
 * Recursively sanitizes data to exclude secrets, passwords, signatures, and tokens.
 */
function sanitizeAuditData(data, depth = 0) {
  if (depth > 6) return '[MAX_DEPTH]';
  if (!data) return data;

  // Handle Mongoose documents
  let target = data;
  if (typeof data.toObject === 'function') {
    target = data.toObject();
  } else if (data._doc && typeof data._doc === 'object') {
    target = data._doc;
  }

  // Handle primitive types and dates
  if (target instanceof Date) return target;
  if (typeof target !== 'object') return target;

  // Handle Arrays
  if (Array.isArray(target)) {
    return target.map(item => sanitizeAuditData(item, depth + 1));
  }

  const clean = {};
  for (const [key, val] of Object.entries(target)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey)) {
      clean[key] = '[REDACTED]';
    } else if (lowerKey === 'accountnumber' && typeof val === 'string' && val.length > 4) {
      clean[key] = `****${val.slice(-4)}`;
    } else if (val && typeof val === 'object') {
      clean[key] = sanitizeAuditData(val, depth + 1);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

/**
 * Safely records an audit log entry in MongoDB without interrupting primary request flow.
 */
async function recordAuditLog({
  actorId = null,
  actorRole = 'system',
  action,
  resourceType,
  resourceId = null,
  before = null,
  after = null,
  metadata = {}
}) {
  try {
    if (!action || !resourceType) {
      console.warn('AuditLog warning: action and resourceType are required');
      return null;
    }

    const logEntry = new AuditLog({
      actorId: actorId || null,
      actorRole: actorRole || 'system',
      action: String(action).trim(),
      resourceType: String(resourceType).trim(),
      resourceId: resourceId ? String(resourceId) : null,
      timestamp: new Date(),
      before: sanitizeAuditData(before),
      after: sanitizeAuditData(after),
      metadata: sanitizeAuditData(metadata)
    });

    const saved = await logEntry.save();
    return saved;
  } catch (error) {
    console.error('Failed to write audit log:', error.message);
    return null;
  }
}

/**
 * In-memory notification deduplication map with TTL.
 * Avoids duplicate notifications from webhook retries, concurrent verifications, or replay events.
 */
class NotificationDeduplicator {
  constructor(defaultTtlMs = 10 * 60 * 1000) {
    this.defaultTtlMs = defaultTtlMs;
    this.dispatchedKeys = new Map();
  }

  /**
   * Returns true if the notification should be dispatched (first time).
   * Returns false if this key has already been dispatched within the TTL window.
   */
  shouldDispatch(dedupKey, ttlMs = this.defaultTtlMs) {
    if (!dedupKey) return true;
    const now = Date.now();
    const existing = this.dispatchedKeys.get(dedupKey);

    if (existing && existing > now) {
      // Duplicate event within TTL window
      return false;
    }

    // Record new dispatch with expiration
    this.dispatchedKeys.set(dedupKey, now + ttlMs);

    // Occasional cleanup of expired keys
    if (this.dispatchedKeys.size > 2000) {
      this.cleanup();
    }

    return true;
  }

  cleanup() {
    const now = Date.now();
    for (const [key, expiresAt] of this.dispatchedKeys.entries()) {
      if (expiresAt <= now) {
        this.dispatchedKeys.delete(key);
      }
    }
  }

  clear() {
    this.dispatchedKeys.clear();
  }
}

const notificationDeduplicator = new NotificationDeduplicator();

module.exports = {
  sanitizeAuditData,
  recordAuditLog,
  notificationDeduplicator,
  NotificationDeduplicator
};

