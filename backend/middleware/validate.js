/**
 * Centralized Request Validation Middleware & Helpers
 * 
 * Provides reusable validation for ObjectIds, numeric ranges, and input sanitization.
 */

const mongoose = require('mongoose');

/**
 * Check if a string is a valid 24-character hexadecimal MongoDB ObjectId.
 */
function isObjectId(val) {
  return typeof val === 'string' && /^[0-9a-fA-F]{24}$/.test(val.trim());
}

/**
 * Middleware to validate an ObjectId parameter in req.params or req.body.
 * @param {string} paramName - Name of the parameter (default: 'id')
 * @param {'params' | 'body' | 'query'} location - Where the parameter is located
 */
function requireObjectId(paramName = 'id', location = 'params') {
  return (req, res, next) => {
    const val = req[location]?.[paramName];
    if (!val) {
      return res.status(400).json({
        success: false,
        message: `${paramName} is required in ${location}`
      });
    }

    if (!isObjectId(val) && !mongoose.Types.ObjectId.isValid(val)) {
      return res.status(400).json({
        success: false,
        message: `Invalid ${paramName} format. Must be a 24-character hexadecimal string`
      });
    }

    next();
  };
}

/**
 * Validate that an optional ObjectId is valid if provided.
 */
function optionalObjectId(paramName = 'id', location = 'body') {
  return (req, res, next) => {
    const val = req[location]?.[paramName];
    if (val !== undefined && val !== null && val !== '') {
      if (!isObjectId(val) && !mongoose.Types.ObjectId.isValid(val)) {
        return res.status(400).json({
          success: false,
          message: `Invalid ${paramName} format. Must be a 24-character hexadecimal string`
        });
      }
    }
    next();
  };
}

module.exports = {
  isObjectId,
  requireObjectId,
  optionalObjectId
};

