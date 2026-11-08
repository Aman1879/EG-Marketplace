const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  actorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  actorRole: {
    type: String,
    enum: ['buyer', 'vendor', 'admin', 'system', 'webhook', 'anonymous'],
    default: 'system'
  },
  action: {
    type: String,
    required: true,
    index: true
  },
  resourceType: {
    type: String,
    required: true,
    index: true
  },
  resourceId: {
    type: String,
    default: null,
    index: true
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  before: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  after: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
});

auditLogSchema.index({ resourceType: 1, resourceId: 1, timestamp: -1 });
auditLogSchema.index({ actorId: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });

// Immutability safeguards: Prevent updates or deletions in normal operations
auditLogSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], function (next) {
  const options = this.getOptions ? this.getOptions() : null;
  if (options && options.allowAuditModification === true) {
    return next();
  }
  const err = new Error('Audit records are immutable and cannot be updated.');
  err.name = 'AuditImmutabilityError';
  return next(err);
});

auditLogSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], function (next) {
  const options = this.getOptions ? this.getOptions() : null;
  if (options && options.allowAuditModification === true) {
    return next();
  }
  const err = new Error('Audit records are immutable and cannot be deleted.');
  err.name = 'AuditImmutabilityError';
  return next(err);
});

module.exports = mongoose.model('AuditLog', auditLogSchema);

