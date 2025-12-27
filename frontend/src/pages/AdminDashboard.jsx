import { useEffect, useState } from 'react';
import axios from 'axios';
import AdminFooter from '../components/AdminFooter';
import { API_BASE_URL } from '../config/api';
import './AdminDashboard.css';

const AdminDashboard = () => {
  const [stats, setStats] = useState(null);
  const [commissions, setCommissions] = useState([]);
  const [vendorEarnings, setVendorEarnings] = useState([]);
  const [contactMessages, setContactMessages] = useState([]);
  const [messageStats, setMessageStats] = useState(null);
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [statsRes, commissionsRes, earningsRes, messagesRes, statsRes2] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/admin/dashboard`),
        axios.get(`${API_BASE_URL}/api/admin/commissions`),
        axios.get(`${API_BASE_URL}/api/admin/vendor-earnings`),
        axios.get(`${API_BASE_URL}/api/contact/messages`),
        axios.get(`${API_BASE_URL}/api/contact/stats`)
      ]);
      setStats(statsRes.data);
      setCommissions(commissionsRes.data.commissions);
      setVendorEarnings(earningsRes.data);
      setContactMessages(messagesRes.data.messages || []);
      setMessageStats(statsRes2.data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setLoading(false);
    }
  };

  const fetchMessages = async (status = 'all') => {
    try {
      const url = status === 'all' 
        ? `${API_BASE_URL}/api/contact/messages`
        : `${API_BASE_URL}/api/contact/messages?status=${status}`;
      const res = await axios.get(url);
      setContactMessages(res.data.messages || []);
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  const updateMessageStatus = async (messageId, newStatus) => {
    try {
      await axios.put(`${API_BASE_URL}/api/contact/messages/${messageId}/status`, {
        status: newStatus
      });
      fetchMessages(selectedStatus);
      if (messageStats) {
        const statsRes = await axios.get('http://localhost:/api/contact/stats');
        setMessageStats(statsRes.data);
      }
      if (selectedMessage && selectedMessage._id === messageId) {
        setSelectedMessage({ ...selectedMessage, status: newStatus });
      }
    } catch (error) {
      console.error('Error updating status:', error);
      alert('Failed to update status');
    }
  };

  const deleteMessage = async (messageId) => {
    if (!window.confirm('Are you sure you want to delete this message?')) return;
    try {
      await axios.delete(`${API_BASE_URL}/api/contact/messages/${messageId}`);
      fetchMessages(selectedStatus);
      if (selectedMessage && selectedMessage._id === messageId) {
        setSelectedMessage(null);
      }
    } catch (error) {
      console.error('Error deleting message:', error);
      alert('Failed to delete message');
    }
  };

  const handleStatusFilter = (status) => {
    setSelectedStatus(status);
    fetchMessages(status);
  };

  if (loading) {
    return <div className="spinner"></div>;
  }

  return (
    <div className="admin-dashboard">
      <div className="container">
        <div className="dashboard-header">
          <h1 className="page-title">
            <span className="title-icon">👨‍💼</span>
            Admin Dashboard
          </h1>
          <p className="dashboard-subtitle">Manage your marketplace platform</p>
        </div>

        {stats && (
          <div className="stats-grid">
            <div className="stat-card stat-users">
              <div className="stat-icon">👥</div>
              <h3>Total Users</h3>
              <p className="stat-value">{stats.totalUsers}</p>
            </div>
            <div className="stat-card stat-vendors">
              <div className="stat-icon">🏪</div>
              <h3>Total Vendors</h3>
              <p className="stat-value">{stats.totalVendors}</p>
            </div>
            <div className="stat-card stat-products">
              <div className="stat-icon">📦</div>
              <h3>Total Products</h3>
              <p className="stat-value">{stats.totalProducts}</p>
            </div>
            <div className="stat-card stat-orders">
              <div className="stat-icon">🛒</div>
              <h3>Total Orders</h3>
              <p className="stat-value">{stats.totalOrders}</p>
            </div>
            <div className="stat-card highlight stat-revenue">
              <div className="stat-icon">💵</div>
              <h3>Total Revenue</h3>
              <p className="stat-value">₹{stats.totalRevenue.toFixed(2)}</p>
            </div>
            <div className="stat-card highlight stat-commission">
              <div className="stat-icon">💰</div>
              <h3>Total Commission</h3>
              <p className="stat-value">₹{stats.totalCommission.toFixed(2)}</p>
            </div>
            {messageStats && (
              <>
                <div className="stat-card stat-messages-new">
                  <div className="stat-icon">📬</div>
                  <h3>New Messages</h3>
                  <p className="stat-value">{messageStats.new}</p>
                </div>
                <div className="stat-card stat-messages">
                  <div className="stat-icon">📧</div>
                  <h3>Total Messages</h3>
                  <p className="stat-value">{messageStats.total}</p>
                </div>
              </>
            )}
          </div>
        )}

        <div className="dashboard-sections">
          <div className="section commission-section">
            <h2 className="section-title">
              <span className="section-icon">💳</span>
              Commission Records
            </h2>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Total Amount</th>
                    <th>Vendor Earning</th>
                    <th>Commission</th>
                    <th>Rate</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.length > 0 ? (
                    commissions.map(commission => (
                      <tr key={commission._id}>
                        <td>{commission.orderId?._id?.slice(-8) || 'N/A'}</td>
                        <td>₹{commission.totalAmount.toFixed(2)}</td>
                        <td>₹{commission.vendorEarning.toFixed(2)}</td>
                        <td className="highlight-cell">₹{commission.commissionAmount.toFixed(2)}</td>
                        <td>{(commission.commissionRate * 100).toFixed(0)}%</td>
                        <td>{new Date(commission.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="6" className="no-data">No commission records yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="section earnings-section">
            <h2 className="section-title">
              <span className="section-icon">💰</span>
              Vendor Earnings Summary
            </h2>
            <div className="table-container">
              <table className="data-table earnings-table">
                <thead>
                  <tr>
                    <th>Shop Name</th>
                    <th>Vendor Username</th>
                    <th>Email</th>
                    <th>Total Revenue</th>
                    <th>Vendor Earnings</th>
                    <th>Admin Commission</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {vendorEarnings.length > 0 ? (
                    vendorEarnings.map(vendor => (
                      <tr key={vendor.vendorId} className="earnings-row">
                        <td className="shop-name-cell">
                          <strong>{vendor.shopName || 'N/A'}</strong>
                        </td>
                        <td>{vendor.username || 'N/A'}</td>
                        <td className="email-cell">{vendor.email || 'N/A'}</td>
                        <td className="revenue-cell">₹{(vendor.totalRevenue || 0).toFixed(2)}</td>
                        <td className="earnings-cell">₹{(vendor.totalEarnings || 0).toFixed(2)}</td>
                        <td className="admin-commission-cell">
                          <span className="commission-badge">₹{(vendor.adminCommission || 0).toFixed(2)}</span>
                        </td>
                        <td className="orders-cell">{vendor.totalOrders || 0}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="7" className="no-data">No vendor earnings data</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="section messages-section">
            <div className="section-header">
              <h2 className="section-title">
                <span className="section-icon">📨</span>
                Contact Messages
              </h2>
              <div className="status-filters">
                <button 
                  className={`filter-btn ${selectedStatus === 'all' ? 'active' : ''}`}
                  onClick={() => handleStatusFilter('all')}
                >
                  All ({messageStats?.total || 0})
                </button>
                <button 
                  className={`filter-btn ${selectedStatus === 'new' ? 'active' : ''}`}
                  onClick={() => handleStatusFilter('new')}
                >
                  New ({messageStats?.new || 0})
                </button>
                <button 
                  className={`filter-btn ${selectedStatus === 'read' ? 'active' : ''}`}
                  onClick={() => handleStatusFilter('read')}
                >
                  Read ({messageStats?.read || 0})
                </button>
                <button 
                  className={`filter-btn ${selectedStatus === 'replied' ? 'active' : ''}`}
                  onClick={() => handleStatusFilter('replied')}
                >
                  Replied ({messageStats?.replied || 0})
                </button>
              </div>
            </div>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Subject</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {contactMessages.length > 0 ? (
                    contactMessages.map(message => (
                      <tr 
                        key={message._id} 
                        className={message.status === 'new' ? 'new-message' : ''}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSelectedMessage(message)}
                      >
                        <td>{new Date(message.createdAt).toLocaleDateString()}</td>
                        <td>{message.name}</td>
                        <td>{message.email}</td>
                        <td>{message.subject}</td>
                        <td>
                          <span className={`status-badge status-${message.status}`}>
                            {message.status}
                          </span>
                        </td>
                        <td>
                          <div className="action-buttons" onClick={(e) => e.stopPropagation()}>
                            {message.status !== 'read' && (
                              <button 
                                className="btn-small btn-primary"
                                onClick={() => updateMessageStatus(message._id, 'read')}
                              >
                                Mark Read
                              </button>
                            )}
                            {message.status !== 'replied' && (
                              <button 
                                className="btn-small btn-success"
                                onClick={() => updateMessageStatus(message._id, 'replied')}
                              >
                                Mark Replied
                              </button>
                            )}
                            <button 
                              className="btn-small btn-danger"
                              onClick={() => deleteMessage(message._id)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="6" className="no-data">No contact messages</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {selectedMessage && (
          <div className="message-modal" onClick={() => setSelectedMessage(null)}>
            <div className="message-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="message-modal-header">
                <h2>{selectedMessage.subject}</h2>
                <button className="close-btn" onClick={() => setSelectedMessage(null)}>×</button>
              </div>
              <div className="message-modal-body">
                <div className="message-info">
                  <p><strong>From:</strong> {selectedMessage.name} ({selectedMessage.email})</p>
                  <p><strong>Date:</strong> {new Date(selectedMessage.createdAt).toLocaleString()}</p>
                  <p><strong>Status:</strong> 
                    <span className={`status-badge status-${selectedMessage.status}`}>
                      {selectedMessage.status}
                    </span>
                  </p>
                </div>
                <div className="message-text">
                  <h3>Message:</h3>
                  <p>{selectedMessage.message}</p>
                </div>
                <div className="message-actions">
                  <a href={`mailto:${selectedMessage.email}?subject=Re: ${selectedMessage.subject}`} className="btn btn-primary">
                    Reply via Email
                  </a>
                  {selectedMessage.status !== 'read' && (
                    <button 
                      className="btn btn-success"
                      onClick={() => {
                        updateMessageStatus(selectedMessage._id, 'read');
                      }}
                    >
                      Mark as Read
                    </button>
                  )}
                  {selectedMessage.status !== 'replied' && (
                    <button 
                      className="btn btn-success"
                      onClick={() => {
                        updateMessageStatus(selectedMessage._id, 'replied');
                      }}
                    >
                      Mark as Replied
                    </button>
                  )}
                  <button 
                    className="btn btn-danger"
                    onClick={() => {
                      deleteMessage(selectedMessage._id);
                      setSelectedMessage(null);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <AdminFooter />
    </div>
  );
};

export default AdminDashboard;

