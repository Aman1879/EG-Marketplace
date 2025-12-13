import { useState } from 'react';
import axios from 'axios';
import './ContactUs.css';

const ContactUs = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });
  const [loading, setLoading] = useState(false);
  const [submitStatus, setSubmitStatus] = useState({ type: '', message: '' });

  const teamMembers = [
    {
      id: 1,
      name: 'Aman Kumar Singh',
      role: 'Founder & CEO',
      email: 'Amanara13579@gmail.com',
      phone: '+91 6299211631',
      linkedin: 'https://www.linkedin.com/in/aman-kumar-singh-827631283/',
      bio: 'Tech enthusiast and full-stack developer specializing in scalable web applications. Building innovative solutions for seamless marketplace experiences.',
      image: '👨‍💼'
    },
    {
      id: 2,
      name: 'Shivani ',
      role: 'CTO & Co-Founder',
      email: 'Shivani@marketplace.com',
      phone: '+91 1234567890',
      linkedin: '',
      bio: 'empowering teams and delivering cutting-edge technological solutions.',
      image: '👩‍💻'
    },
    {
      id: 3,
      name: 'Rahul',
      role: 'Head of Operations',
      email: 'Rahul13579@marketplace.com',
      phone: '+91 1234567890',
      linkedin: 'linkedin.com/in/amitpatel',
      bio: 'Operations expert focused on customer satisfaction and vendor relations. Ensuring smooth operations and exceptional service delivery.',
      image: '👨‍💼'
    }
  ];

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setSubmitStatus({ type: '', message: '' });
    
    try {
      const response = await axios.post('http://localhost:3000/api/contact/submit', formData);
      setSubmitStatus({ 
        type: 'success', 
        message: response.data.message || 'Thank you for your message! We will get back to you soon.' 
      });
      setFormData({ name: '', email: '', subject: '', message: '' });
    } catch (error) {
      setSubmitStatus({ 
        type: 'error', 
        message: error.response?.data?.message || 'Failed to send message. Please try again.' 
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="contact-us-page">
      <div className="contact-hero">
        <div className="container">
          <h1>Get in Touch</h1>
          <p>We'd love to hear from you. Send us a message and we'll respond as soon as possible.</p>
        </div>
      </div>

      <div className="container">
        <div className="contact-content">
          {/* Contact Form Section */}
          <div className="contact-form-section">
            <h2>Send us a Message</h2>
            {submitStatus.message && (
              <div className={`submit-status ${submitStatus.type}`}>
                {submitStatus.message}
              </div>
            )}
            <form onSubmit={handleSubmit} className="contact-form">
              <div className="form-group">
                <label htmlFor="name">Your Name *</label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  placeholder="Enter your full name"
                />
              </div>

              <div className="form-group">
                <label htmlFor="email">Your Email *</label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  placeholder="your.email@example.com"
                />
              </div>

              <div className="form-group">
                <label htmlFor="subject">Subject *</label>
                <input
                  type="text"
                  id="subject"
                  name="subject"
                  value={formData.subject}
                  onChange={handleChange}
                  required
                  placeholder="What is this regarding?"
                />
              </div>

              <div className="form-group">
                <label htmlFor="message">Message *</label>
                <textarea
                  id="message"
                  name="message"
                  value={formData.message}
                  onChange={handleChange}
                  required
                  rows="6"
                  placeholder="Tell us how we can help you..."
                ></textarea>
              </div>

              <button type="submit" className="btn-submit" disabled={loading}>
                {loading ? 'Sending...' : 'Send Message'}
              </button>
            </form>
          </div>

          {/* Team Members Section */}
          <div className="team-section">
            <h2>Meet Our Team</h2>
            <p className="team-intro">Our dedicated team is here to help you with any questions or concerns.</p>
            
            <div className="team-grid">
              {teamMembers.map((member) => (
                <div key={member.id} className="team-card">
                  <div className="team-avatar">{member.image}</div>
                  <h3>{member.name}</h3>
                  <p className="team-role">{member.role}</p>
                  <p className="team-bio">{member.bio}</p>
                  
                  <div className="team-contact">
                    <div className="contact-item">
                      <span className="contact-icon">📧</span>
                      <a href={`mailto:${member.email}`}>{member.email}</a>
                    </div>
                    <div className="contact-item">
                      <span className="contact-icon">📱</span>
                      <a href={`tel:${member.phone}`}>{member.phone}</a>
                    </div>
                    {member.linkedin && (
                      <div className="contact-item">
                        <span className="contact-icon">💼</span>
                        <a href={member.linkedin.startsWith('http') ? member.linkedin : `https://${member.linkedin}`} target="_blank" rel="noopener noreferrer">
                          LinkedIn Profile
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Additional Contact Info */}
          <div className="contact-info-section">
            <div className="info-card">
              <div className="info-icon">📍</div>
              <h3>Office Address</h3>
              <p>
                Lovely Professional University,<br />
                Phagwara, Punjab 144411<br />
                India
              </p>
            </div>

            <div className="info-card">
              <div className="info-icon">⏰</div>
              <h3>Business Hours</h3>
              <p>
                Monday - Friday: 9:00 AM - 6:00 PM IST<br />
                Saturday: 10:00 AM - 4:00 PM IST<br />
                Sunday: Closed
              </p>
            </div>

            <div className="info-card">
              <div className="info-icon">📞</div>
              <h3>General Inquiries</h3>
              <p>
                Phone: +91 1800-123-4567<br />
                Email: abcd@marketplace.com<br />
                Support: support@marketplace.com
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContactUs;

