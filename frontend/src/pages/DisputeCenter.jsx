import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import './DisputeCenter.css';

const DisputeCenter = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    orderId: '',
    reason: 'not_received',
    description: '',
    images: ''
  });
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    fetchDisputes();
    if (user?.role === 'buyer') {
      fetchOrders();
    }
  }, [user]);

  const fetchDisputes = async () => {
    try {
      let response;
      if (user?.role === 'buyer') {
        response = await axios.get('http://localhost:3000/api/disputes/buyer/my-disputes');
      } else if (user?.role === 'vendor') {
        response = await axios.get('http://localhost:3000/api/disputes/vendor/my-disputes');
      } else if (user?.role === 'admin') {
        response = await axios.get('http://localhost:3000/api/disputes/all');
      }
      if (response) {
        setDisputes(response.data);
      }
      setLoading(false);
    } catch (error) {
      console.error('Error fetching disputes:', error);
      setLoading(false);
    }
  };

  const fetchOrders = async () => {
    try {
      const response = await axios.get('http://localhost:3000/api/orders/buyer/my-orders');
      setOrders(response.data);
    } catch (error) {
      console.error('Error fetching orders:', error);
    }
  };

  const handleCreateDispute = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        orderId: formData.orderId,
        reason: formData.reason,
        description: formData.description,
        images: formData.images
          .split(',')
          .map(url => url.trim())
          .filter(Boolean)
      };
      await axios.post('http://localhost:3000/api/disputes', payload);
      alert('Dispute created successfully!');
      setShowForm(false);
      setFormData({ orderId: '', reason: 'not_received', description: '', images: '' });
      fetchDisputes();
    } catch (error) {
      alert(error.response?.data?.message || 'Error creating dispute');
    }
  };

  const handleVendorReply = async (disputeId, reply) => {
    try {
      await axios.put(`http://localhost:3000/api/disputes/${disputeId}/reply`, { reply });
      alert('Reply submitted successfully!');
      fetchDisputes();
    } catch (error) {
      alert(error.response?.data?.message || 'Error submitting reply');
    }
  };

  const handleAdminUpdate = async (disputeId, status, adminNotes) => {
    try {
      await axios.put(`http://localhost:3000/api/disputes/${disputeId}/status`, {
        status,
        adminNotes
      });
      alert('Dispute status updated!');
      fetchDisputes();
    } catch (error) {
      alert(error.response?.data?.message || 'Error updating dispute');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'resolved':
        return 'status-resolved';
      case 'under-review':
        return 'status-review';
      case 'vendor-responded':
        return 'status-vendor';
      case 'open':
        return 'status-open';
      case 'rejected':
        return 'status-rejected';
      default:
        return '';
    }
  };

  if (loading) {
    return <div className="spinner"></div>;
  }

  return (
    <div className="dispute-center">
      <div className="container">
        <h1 className="page-title">Dispute Center</h1>

        {user?.role === 'buyer' && (
          <div className="dispute-actions">
            <button
              onClick={() => setShowForm(!showForm)}
              className="btn btn-primary"
            >
              {showForm ? 'Cancel' : 'Open New Dispute'}
            </button>
          </div>
        )}

        {showForm && user?.role === 'buyer' && (
          <form onSubmit={handleCreateDispute} className="dispute-form">
            <div className="form-group">
              <label>Order *</label>
              <select
                value={formData.orderId}
                onChange={(e) => setFormData({ ...formData, orderId: e.target.value })}
                required
              >
                <option value="">Select an order</option>
                {orders.map(order => (
                  <option key={order._id} value={order._id}>
                    Order #{order._id.slice(-8)} - ₹{order.totalAmount.toFixed(2)}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Reason *</label>
              <select
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                required
              >
                <option value="not_received">Item not received</option>
                <option value="damaged_product">Damaged product</option>
                <option value="wrong_item">Wrong item</option>
                <option value="refund_request">Refund request</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="form-group">
              <label>Description *</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows="5"
                required
              />
            </div>

            <div className="form-group">
              <label>Image URLs (optional, comma-separated)</label>
              <input
                type="text"
                value={formData.images}
                onChange={(e) => setFormData({ ...formData, images: e.target.value })}
                placeholder="https://example.com/photo1.jpg, https://example.com/photo2.jpg"
              />
            </div>

            <button type="submit" className="btn btn-primary">
              Submit Dispute
            </button>
          </form>
        )}

        <div className="disputes-list">
          {disputes.length > 0 ? (
            disputes.map(dispute => (
              <div key={dispute._id} className="dispute-card">
                <div className="dispute-header">
                  <div>
                    <h3>{dispute.reason?.replace('_', ' ') || 'Dispute'}</h3>
                    <p className="dispute-meta">
                      Order: #{dispute.orderId?._id?.slice(-8) || 'N/A'} | 
                      {user?.role === 'buyer' && ` Vendor: ${dispute.vendorId?.shopName || 'N/A'}`}
                      {user?.role === 'vendor' && ` Buyer: ${dispute.buyerId?.username || 'N/A'}`}
                    </p>
                  </div>
                  <span className={`status-badge ${getStatusColor(dispute.status)}`}>
                    {dispute.status}
                  </span>
                </div>

                <div className="dispute-content">
                  <div className="dispute-message">
                    <strong>Details:</strong>
                    <p>{dispute.description}</p>
                  </div>
                  {dispute.images && dispute.images.length > 0 && (
                    <div className="dispute-images">
                      {dispute.images.map((img, idx) => (
                        <a key={idx} href={img} target="_blank" rel="noreferrer">{`Image ${idx + 1}`}</a>
                      ))}
                    </div>
                  )}
                  <div className="dispute-thread">
                    <strong>Conversation</strong>
                    {dispute.messages?.length ? (
                      dispute.messages.map((msg) => (
                        <div key={msg._id || msg.createdAt} className="thread-message">
                          <span className="thread-meta">
                            {msg.senderType} • {new Date(msg.createdAt).toLocaleString()}
                          </span>
                          <p>{msg.message}</p>
                        </div>
                      ))
                    ) : (
                      <p className="muted">No messages yet.</p>
                    )}
                  </div>
                </div>

                <div className="dispute-actions-section">
                  {user?.role === 'vendor' && dispute.status !== 'resolved' && (
                    <div className="reply-section">
                      <textarea
                        id={`reply-${dispute._id}`}
                        rows="3"
                        placeholder="Enter your reply..."
                        className="reply-input"
                      />
                      <button
                        onClick={() => {
                          const reply = document.getElementById(`reply-${dispute._id}`).value;
                          if (reply.trim()) {
                            handleVendorReply(dispute._id, reply);
                          }
                        }}
                        className="btn btn-secondary"
                      >
                        Submit Reply
                      </button>
                    </div>
                  )}

                  {user?.role === 'admin' && dispute.status !== 'resolved' && (
                    <div className="admin-actions">
                      <select
                        id={`status-${dispute._id}`}
                        defaultValue={dispute.status}
                        className="status-select"
                      >
                        <option value="open">Open</option>
                        <option value="vendor-responded">Vendor Responded</option>
                        <option value="under-review">Under Review</option>
                        <option value="resolved">Resolved</option>
                        <option value="rejected">Rejected</option>
                      </select>
                      <textarea
                        id={`notes-${dispute._id}`}
                        rows="2"
                        placeholder="Admin notes (optional)"
                        className="admin-notes-input"
                      />
                      <button
                        onClick={() => {
                          const status = document.getElementById(`status-${dispute._id}`).value;
                          const notes = document.getElementById(`notes-${dispute._id}`).value;
                          handleAdminUpdate(dispute._id, status, notes);
                        }}
                        className="btn btn-primary"
                      >
                        Update Status
                      </button>
                    </div>
                  )}
                </div>

                <p className="dispute-date">
                  Created: {new Date(dispute.createdAt).toLocaleString()}
                </p>
              </div>
            ))
          ) : (
            <div className="no-disputes">
              <p>No disputes found.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DisputeCenter;

