const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const ContactMessage = require('../models/ContactMessage');
const { authenticate, authorize } = require('../middleware/auth');

// Submit contact form (public)
router.post('/submit', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').trim().isEmail().withMessage('Valid email is required'),
  body('subject').trim().notEmpty().withMessage('Subject is required'),
  body('message').trim().notEmpty().withMessage('Message is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed',
        errors: errors.array() 
      });
    }

    const { name, email, subject, message } = req.body;

    const contactMessage = new ContactMessage({
      name: name.trim(),
      email: email.trim(),
      subject: subject.trim(),
      message: message.trim(),
      status: 'new'
    });

    await contactMessage.save();

    res.json({
      message: 'Thank you for your message! We will get back to you soon.',
      success: true
    });
  } catch (error) {
    console.error('Contact form error:', error);
    res.status(500).json({ 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// Get all contact messages (admin only)
router.get('/messages', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) {
      filter.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const messages = await ContactMessage.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await ContactMessage.countDocuments(filter);

    res.json({
      messages,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// Get single message (admin only)
router.get('/messages/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const message = await ContactMessage.findById(req.params.id);
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }
    res.json(message);
  } catch (error) {
    console.error('Get message error:', error);
    res.status(500).json({ 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// Update message status (admin only)
router.put('/messages/:id/status', authenticate, authorize('admin'), [
  body('status').isIn(['new', 'read', 'replied', 'archived']).withMessage('Invalid status')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { status } = req.body;
    const updateData = { status };
    
    if (status === 'replied') {
      updateData.repliedAt = new Date();
    }

    const message = await ContactMessage.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    res.json({
      message: 'Status updated successfully',
      contactMessage: message
    });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// Delete message (admin only)
router.delete('/messages/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const message = await ContactMessage.findByIdAndDelete(req.params.id);
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }
    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// Get message statistics (admin only)
router.get('/stats', authenticate, authorize('admin'), async (req, res) => {
  try {
    const stats = {
      total: await ContactMessage.countDocuments(),
      new: await ContactMessage.countDocuments({ status: 'new' }),
      read: await ContactMessage.countDocuments({ status: 'read' }),
      replied: await ContactMessage.countDocuments({ status: 'replied' }),
      archived: await ContactMessage.countDocuments({ status: 'archived' })
    };
    res.json(stats);
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ 
      message: 'Server error', 
      error: error.message 
    });
  }
});

module.exports = router;

