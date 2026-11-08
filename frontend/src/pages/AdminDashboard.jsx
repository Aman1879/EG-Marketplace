import { useEffect, useState } from 'react';
import axios from 'axios';
import AdminFooter from '../components/AdminFooter';
import { API_BASE_URL } from '../config/api';
import './AdminDashboard.css';

const AdminDashboard = () => {
  const [activeTab, setActiveTab] = useState('overview'); // overview, orders, inventory, users, earnings, messages
  const [stats, setStats] = useState(null);
  const [commissions, setCommissions] = useState([]);
  const [vendorEarnings, setVendorEarnings] = useState([]);
  const [vendorRequests, setVendorRequests] = useState([]);
  const [contactMessages, setContactMessages] = useState([]);
  const [messageStats, setMessageStats] = useState(null);
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [loading, setLoading] = useState(true);

  // Orders Tab State
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersTotalPages, setOrdersTotalPages] = useState(1);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [orderFilters, setOrderFilters] = useState({
    startDate: '',
    endDate: '',
    status: 'all',
    paymentStatus: 'all',
    customer: '',
    vendor: ''
  });
  const [selectedOrder, setSelectedOrder] = useState(null);

  // Inventory Tab State
  const [inventoryData, setInventoryData] = useState(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryThreshold, setInventoryThreshold] = useState(10);

  // Users & Vendors Tab State
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userRoleFilter, setUserRoleFilter] = useState('all');
  const [userSearch, setUserSearch] = useState('');
  const [usersTotal, setUsersTotal] = useState(0);

  const [allVendors, setAllVendors] = useState([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [vendorStatusFilter, setVendorStatusFilter] = useState('all');
  const [vendorSearch, setVendorSearch] = useState('');

  // Audit Logs Tab State
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotalPages, setAuditTotalPages] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditFilterAction, setAuditFilterAction] = useState('');
  const [auditFilterResource, setAuditFilterResource] = useState('all');
  const [selectedAuditLog, setSelectedAuditLog] = useState(null);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshVendorRequests();
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  // Fetch tab-specific data when active tab changes
  useEffect(() => {
    if (activeTab === 'orders') {
      fetchOrders(1);
    } else if (activeTab === 'inventory') {
      fetchInventory(inventoryThreshold);
    } else if (activeTab === 'users') {
      fetchUsers();
      fetchVendors();
    } else if (activeTab === 'audit') {
      fetchAuditLogs(1);
    }
  }, [activeTab]);

  const fetchDashboardData = async () => {
    try {
      const [statsRes, commissionsRes, earningsRes, requestsRes, messagesRes, statsRes2] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/admin/dashboard`),
        axios.get(`${API_BASE_URL}/api/admin/commissions`),
        axios.get(`${API_BASE_URL}/api/admin/vendor-earnings`),
        axios.get(`${API_BASE_URL}/api/admin/vendor-requests`),
        axios.get(`${API_BASE_URL}/api/contact/messages`),
        axios.get(`${API_BASE_URL}/api/contact/stats`)
      ]);
      setStats(statsRes.data);
      setCommissions(commissionsRes.data.commissions || []);
      setVendorEarnings(earningsRes.data || []);
      setVendorRequests(requestsRes.data.requests || []);
      setContactMessages(messagesRes.data.messages || []);
      setMessageStats(statsRes2.data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setLoading(false);
    }
  };

  const refreshVendorRequests = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/admin/vendor-requests`);
      setVendorRequests(res.data.requests || []);
    } catch (error) {
      console.error('Error fetching vendor requests:', error);
    }
  };

  // Orders Tab Handlers
  const fetchOrders = async (page = 1) => {
    setOrdersLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '15'
      });
      if (orderFilters.startDate) params.append('startDate', orderFilters.startDate);
      if (orderFilters.endDate) params.append('endDate', orderFilters.endDate);
      if (orderFilters.status && orderFilters.status !== 'all') params.append('status', orderFilters.status);
      if (orderFilters.paymentStatus && orderFilters.paymentStatus !== 'all') params.append('paymentStatus', orderFilters.paymentStatus);
      if (orderFilters.customer) params.append('customer', orderFilters.customer);
      if (orderFilters.vendor) params.append('vendor', orderFilters.vendor);

      const res = await axios.get(`${API_BASE_URL}/api/admin/orders?${params.toString()}`);
      setOrders(res.data.orders || []);
      setOrdersPage(res.data.page || 1);
      setOrdersTotalPages(res.data.totalPages || 1);
      setOrdersTotal(res.data.total || 0);
    } catch (error) {
      console.error('Error fetching admin orders:', error);
    } finally {
      setOrdersLoading(false);
    }
  };

  const handleFilterSubmit = (e) => {
    e.preventDefault();
    fetchOrders(1);
  };

  const handleResetFilters = () => {
    const defaultFilters = {
      startDate: '',
      endDate: '',
      status: 'all',
      paymentStatus: 'all',
      customer: '',
      vendor: ''
    };
    setOrderFilters(defaultFilters);
    setOrdersLoading(true);
    axios.get(`${API_BASE_URL}/api/admin/orders?page=1&limit=15`)
      .then(res => {
        setOrders(res.data.orders || []);
        setOrdersPage(1);
        setOrdersTotalPages(res.data.totalPages || 1);
        setOrdersTotal(res.data.total || 0);
      })
      .catch(console.error)
      .finally(() => setOrdersLoading(false));
  };

  // Inventory Tab Handlers
  const fetchInventory = async (threshold = 10) => {
    setInventoryLoading(true);
    try {
      const res = await axios.get(`${API_BASE_URL}/api/admin/inventory?threshold=${threshold}`);
      setInventoryData(res.data);
    } catch (error) {
      console.error('Error fetching inventory summary:', error);
    } finally {
      setInventoryLoading(false);
    }
  };

  // Users & Vendors Handlers
  const fetchUsers = async () => {
    setUsersLoading(true);
    try {
      const params = new URLSearchParams();
      if (userRoleFilter !== 'all') params.append('role', userRoleFilter);
      if (userSearch) params.append('search', userSearch);
      const res = await axios.get(`${API_BASE_URL}/api/admin/users?${params.toString()}`);
      setUsers(res.data.users || []);
      setUsersTotal(res.data.total || 0);
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setUsersLoading(false);
    }
  };

  const updateUserRole = async (userId, newRole) => {
    if (!window.confirm(`Are you sure you want to change this user's role to ${newRole}?`)) return;
    try {
      await axios.put(`${API_BASE_URL}/api/admin/users/${userId}/role`, { role: newRole });
      fetchUsers();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to update user role');
    }
  };

  const fetchVendors = async () => {
    setVendorsLoading(true);
    try {
      const params = new URLSearchParams();
      if (vendorStatusFilter !== 'all') params.append('status', vendorStatusFilter);
      if (vendorSearch) params.append('search', vendorSearch);
      const res = await axios.get(`${API_BASE_URL}/api/admin/vendors?${params.toString()}`);
      setAllVendors(res.data.vendors || []);
    } catch (error) {
      console.error('Error fetching vendors:', error);
    } finally {
      setVendorsLoading(false);
    }
  };

  const updateVendorStatus = async (vendorId, status) => {
    let notes = '';
    if (status === 'rejected') {
      notes = window.prompt('Enter rejection reason (optional):') || '';
    }
    try {
      await axios.put(`${API_BASE_URL}/api/admin/vendors/${vendorId}/status`, { status, notes });
      fetchVendors();
      fetchDashboardData();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to update vendor status');
    }
  };

  // Audit Logs Tab Handlers
  const fetchAuditLogs = async (page = 1) => {
    setAuditLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20'
      });
      if (auditFilterAction) params.append('action', auditFilterAction);
      if (auditFilterResource && auditFilterResource !== 'all') params.append('resourceType', auditFilterResource);
      const res = await axios.get(`${API_BASE_URL}/api/admin/audit-logs?${params.toString()}`);
      setAuditLogs(res.data.logs || []);
      setAuditTotal(res.data.total || 0);
      setAuditPage(res.data.page || 1);
      setAuditTotalPages(res.data.totalPages || 1);
    } catch (err) {
      console.error('Error fetching audit logs:', err);
    } finally {
      setAuditLoading(false);
    }
  };

  // Vendor Approval Quick Handlers
  const approveVendorRequest = async (vendorId) => {
    try {
      await axios.put(`${API_BASE_URL}/api/admin/vendor-requests/${vendorId}/approve`);
      await fetchDashboardData();
      if (activeTab === 'users') fetchVendors();
    } catch (error) {
      console.error('Error approving vendor request:', error);
      alert('Failed to approve vendor request');
    }
  };

  const rejectVendorRequest = async (vendorId) => {
    const notes = window.prompt('Optional rejection note');
    if (notes === null) return;
    try {
      await axios.put(`${API_BASE_URL}/api/admin/vendor-requests/${vendorId}/reject`, { notes });
      await fetchDashboardData();
      if (activeTab === 'users') fetchVendors();
    } catch (error) {
      console.error('Error rejecting vendor request:', error);
      alert('Failed to reject vendor request');
    }
  };

  // Messages Handlers
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
        const statsRes = await axios.get(`${API_BASE_URL}/api/contact/stats`);
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
            Admin Dashboard &amp; Reports
            {vendorRequests.length > 0 && (
              <span className="approval-badge">{vendorRequests.length} pending approvals</span>
            )}
          </h1>
          <p className="dashboard-subtitle">Platform overview, financial accounting, inventory, and management</p>
        </div>

        {/* Global Key Metrics Overview */}
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

            {/* Financial Reporting Cards */}
            <div className="stat-card highlight stat-gross">
              <div className="stat-icon">💳</div>
              <h3>Gross Captured Sales</h3>
              <p className="stat-value">₹{(stats.grossCapturedSales || 0).toFixed(2)}</p>
              <span className="stat-hint">Paid orders only</span>
            </div>
            <div className="stat-card highlight stat-refunds">
              <div className="stat-icon">↩️</div>
              <h3>Completed Refunds</h3>
              <p className="stat-value">₹{(stats.completedRefunds || 0).toFixed(2)}</p>
              <span className="stat-hint">Processed refunds only</span>
            </div>
            <div className="stat-card highlight stat-net">
              <div className="stat-icon">💵</div>
              <h3>Net Revenue</h3>
              <p className="stat-value">₹{(stats.netRevenue || 0).toFixed(2)}</p>
              <span className="stat-hint">Gross minus completed refunds</span>
            </div>
            <div className="stat-card highlight stat-commission">
              <div className="stat-icon">💰</div>
              <h3>Platform Commission</h3>
              <p className="stat-value">₹{(stats.platformCommission || 0).toFixed(2)}</p>
              <span className="stat-hint">Platform earnings</span>
            </div>
            <div className="stat-card highlight stat-vendor-earnings">
              <div className="stat-icon">🏷️</div>
              <h3>Vendor Earnings</h3>
              <p className="stat-value">₹{(stats.vendorEarnings || 0).toFixed(2)}</p>
              <span className="stat-hint">Gross vendor share</span>
            </div>
          </div>
        )}

        {/* Order Status Distribution Strip */}
        {stats?.orderStatusCounts && (
          <div className="status-distribution-bar">
            <span className="dist-title">Order Status Distribution:</span>
            <span className="dist-chip chip-pending">Pending: {stats.orderStatusCounts.pending || 0}</span>
            <span className="dist-chip chip-confirmed">Confirmed: {stats.orderStatusCounts.confirmed || 0}</span>
            <span className="dist-chip chip-processing">Processing: {stats.orderStatusCounts.processing || 0}</span>
            <span className="dist-chip chip-shipped">Shipped: {stats.orderStatusCounts.shipped || 0}</span>
            <span className="dist-chip chip-delivered">Delivered: {stats.orderStatusCounts.delivered || 0}</span>
            <span className="dist-chip chip-cancelled">Cancelled: {stats.orderStatusCounts.cancelled || 0}</span>
            <span className="dist-chip chip-refunded">Refunded: {stats.orderStatusCounts.refunded || 0}</span>
          </div>
        )}

        {/* Admin Navigation Tabs */}
        <div className="admin-nav-tabs" role="tablist" aria-label="Admin Dashboard Sections">
          <button
            role="tab"
            aria-selected={activeTab === 'overview'}
            className={`admin-tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            📋 Overview &amp; Approvals
            {vendorRequests.length > 0 && <span className="tab-badge">{vendorRequests.length}</span>}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'orders'}
            className={`admin-tab-btn ${activeTab === 'orders' ? 'active' : ''}`}
            onClick={() => setActiveTab('orders')}
          >
            🛍️ Orders &amp; Reports
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'inventory'}
            className={`admin-tab-btn ${activeTab === 'inventory' ? 'active' : ''}`}
            onClick={() => setActiveTab('inventory')}
          >
            📦 Inventory Summary
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'users'}
            className={`admin-tab-btn ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            👥 Users &amp; Vendors
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'earnings'}
            className={`admin-tab-btn ${activeTab === 'earnings' ? 'active' : ''}`}
            onClick={() => setActiveTab('earnings')}
          >
            💰 Commissions &amp; Earnings
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'messages'}
            className={`admin-tab-btn ${activeTab === 'messages' ? 'active' : ''}`}
            onClick={() => setActiveTab('messages')}
          >
            📨 Contact Messages
            {messageStats?.new > 0 && <span className="tab-badge">{messageStats.new}</span>}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'audit'}
            className={`admin-tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
            onClick={() => setActiveTab('audit')}
          >
            🛡️ Audit Trail
          </button>
        </div>

        {/* TAB 1: OVERVIEW & APPROVALS */}
        {activeTab === 'overview' && (
          <div className="dashboard-sections">
            <div className="section approval-section">
              <h2 className="section-title">
                <span className="section-icon">✅</span>
                Pending Vendor Shop Approvals
                <span className="section-count">{vendorRequests.length}</span>
              </h2>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Shop Name</th>
                      <th>Vendor</th>
                      <th>Email</th>
                      <th>GSTIN</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendorRequests.length > 0 ? (
                      vendorRequests.map(request => (
                        <tr key={request._id}>
                          <td>{new Date(request.approvalRequestedAt || request.createdAt).toLocaleDateString()}</td>
                          <td><strong>{request.shopName}</strong></td>
                          <td>{request.userId?.username || 'N/A'}</td>
                          <td>{request.userId?.email || 'N/A'}</td>
                          <td>{request.gstin || 'N/A'}</td>
                          <td><span className="status-badge status-new">Pending</span></td>
                          <td>
                            <div className="action-buttons">
                              <button className="btn-small btn-success" onClick={() => approveVendorRequest(request._id)}>Approve</button>
                              <button className="btn-small btn-danger" onClick={() => rejectVendorRequest(request._id)}>Reject</button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="7" className="no-data">No pending vendor shop approvals</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Reconciliation Note */}
            <div className="reconciliation-card">
              <h3>⚖️ Financial Integrity &amp; Reconciliation Status</h3>
              <p>
                <strong>Reconciliation Rule:</strong> Gross Captured Sales = Platform Commission + Vendor Earnings.
              </p>
              <div className="recon-summary">
                <span>Gross Captured: ₹{(stats?.grossCapturedSales || 0).toFixed(2)}</span>
                <span>Sum (Commission + Vendor): ₹{((stats?.platformCommission || 0) + (stats?.vendorEarnings || 0)).toFixed(2)}</span>
                <span className={`recon-status ${stats?.reconciliation?.reconciled ? 'recon-ok' : 'recon-warn'}`}>
                  {stats?.reconciliation?.reconciled ? '✓ Fully Reconciled' : `Discrepancy: ₹${stats?.reconciliation?.difference?.toFixed(2)}`}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: ORDERS & REPORTS */}
        {activeTab === 'orders' && (
          <div className="dashboard-sections">
            <div className="section orders-section">
              <h2 className="section-title">
                <span className="section-icon">🛍️</span>
                Order Reports &amp; Listing
                <span className="section-count">{ordersTotal} Orders</span>
              </h2>

              {/* Order Filter Form */}
              <form className="admin-filter-bar" onSubmit={handleFilterSubmit}>
                <div className="filter-group">
                  <label>Start Date</label>
                  <input
                    type="date"
                    value={orderFilters.startDate}
                    onChange={(e) => setOrderFilters({ ...orderFilters, startDate: e.target.value })}
                  />
                </div>
                <div className="filter-group">
                  <label>End Date</label>
                  <input
                    type="date"
                    value={orderFilters.endDate}
                    onChange={(e) => setOrderFilters({ ...orderFilters, endDate: e.target.value })}
                  />
                </div>
                <div className="filter-group">
                  <label>Order Status</label>
                  <select
                    value={orderFilters.status}
                    onChange={(e) => setOrderFilters({ ...orderFilters, status: e.target.value })}
                  >
                    <option value="all">All Statuses</option>
                    <option value="pending">Pending</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="processing">Processing</option>
                    <option value="shipped">Shipped</option>
                    <option value="delivered">Delivered</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="refunded">Refunded</option>
                  </select>
                </div>
                <div className="filter-group">
                  <label>Payment Status</label>
                  <select
                    value={orderFilters.paymentStatus}
                    onChange={(e) => setOrderFilters({ ...orderFilters, paymentStatus: e.target.value })}
                  >
                    <option value="all">All Payment Statuses</option>
                    <option value="paid">Paid (Captured)</option>
                    <option value="refunded">Refunded</option>
                    <option value="failed">Failed</option>
                    <option value="created">Created</option>
                    <option value="authorized">Authorized</option>
                  </select>
                </div>
                <div className="filter-group">
                  <label>Customer Search</label>
                  <input
                    type="text"
                    placeholder="Customer email or ID..."
                    value={orderFilters.customer}
                    onChange={(e) => setOrderFilters({ ...orderFilters, customer: e.target.value })}
                  />
                </div>
                <div className="filter-group">
                  <label>Vendor Search</label>
                  <input
                    type="text"
                    placeholder="Shop name or ID..."
                    value={orderFilters.vendor}
                    onChange={(e) => setOrderFilters({ ...orderFilters, vendor: e.target.value })}
                  />
                </div>
                <div className="filter-actions">
                  <button type="submit" className="btn-small btn-primary">Filter</button>
                  <button type="button" className="btn-small btn-secondary" onClick={handleResetFilters}>Reset</button>
                </div>
              </form>

              {/* Orders Table */}
              <div className="table-container">
                {ordersLoading ? (
                  <div className="spinner"></div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Order ID</th>
                        <th>Date</th>
                        <th>Customer</th>
                        <th>Vendor</th>
                        <th>Items</th>
                        <th>Total Amount</th>
                        <th>Payment Status</th>
                        <th>Order Status</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.length > 0 ? (
                        orders.map(o => (
                          <tr key={o._id}>
                            <td><code>{o._id.slice(-8)}</code></td>
                            <td>{new Date(o.createdAt).toLocaleDateString()}</td>
                            <td>{o.buyerId?.username || o.buyerId?.email || 'N/A'}</td>
                            <td>{o.vendorId?.shopName || 'N/A'}</td>
                            <td>{o.products?.length || 0}</td>
                            <td><strong>₹{(o.totalAmount || 0).toFixed(2)}</strong></td>
                            <td>
                              <span className={`status-badge status-pay-${o.paymentStatus}`}>
                                {o.paymentStatus}
                              </span>
                            </td>
                            <td>
                              <span className={`status-badge status-${o.status}`}>
                                {o.status}
                              </span>
                            </td>
                            <td>
                              <button
                                className="btn-small btn-outline"
                                onClick={() => setSelectedOrder(o)}
                              >
                                View
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="9" className="no-data">No orders found matching the filter criteria</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Pagination */}
              {ordersTotalPages > 1 && (
                <div className="pagination-bar">
                  <button
                    disabled={ordersPage <= 1}
                    onClick={() => fetchOrders(ordersPage - 1)}
                    className="btn-small btn-secondary"
                  >
                    &laquo; Prev
                  </button>
                  <span className="pagination-info">Page {ordersPage} of {ordersTotalPages}</span>
                  <button
                    disabled={ordersPage >= ordersTotalPages}
                    onClick={() => fetchOrders(ordersPage + 1)}
                    className="btn-small btn-secondary"
                  >
                    Next &raquo;
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: INVENTORY SUMMARY */}
        {activeTab === 'inventory' && (
          <div className="dashboard-sections">
            <div className="section inventory-section">
              <div className="section-header-flex">
                <h2 className="section-title">
                  <span className="section-icon">📦</span>
                  Product &amp; Inventory Overview
                </h2>
                <div className="threshold-selector">
                  <label>Low-Stock Threshold: </label>
                  <select
                    value={inventoryThreshold}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setInventoryThreshold(val);
                      fetchInventory(val);
                    }}
                  >
                    <option value={5}>&le; 5 units</option>
                    <option value={10}>&le; 10 units (Default)</option>
                    <option value={20}>&le; 20 units</option>
                    <option value={50}>&le; 50 units</option>
                  </select>
                </div>
              </div>

              {inventoryLoading ? (
                <div className="spinner"></div>
              ) : inventoryData && (
                <>
                  <div className="stats-grid mini-stats">
                    <div className="stat-card">
                      <h3>Total Products</h3>
                      <p className="stat-value">{inventoryData.totalProducts}</p>
                    </div>
                    <div className="stat-card">
                      <h3>Total Stock in Warehouse</h3>
                      <p className="stat-value">{inventoryData.totalStock}</p>
                    </div>
                    <div className="stat-card stat-critical">
                      <h3>Out of Stock (0 units)</h3>
                      <p className="stat-value text-danger">{inventoryData.outOfStockCount}</p>
                    </div>
                    <div className="stat-card stat-low">
                      <h3>Low Stock (&le; {inventoryData.threshold})</h3>
                      <p className="stat-value text-warning">{inventoryData.lowStockCount}</p>
                    </div>
                  </div>

                  <h3 className="subsection-title">Critical &amp; Low-Stock Products</h3>
                  <div className="table-container">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Product Name</th>
                          <th>SKU</th>
                          <th>Vendor</th>
                          <th>Category</th>
                          <th>Price</th>
                          <th>Current Stock</th>
                          <th>Inventory Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inventoryData.lowStockProducts && inventoryData.lowStockProducts.length > 0 ? (
                          inventoryData.lowStockProducts.map(p => (
                            <tr key={p._id} className={p.stock <= 0 ? 'out-of-stock-row' : 'low-stock-row'}>
                              <td><strong>{p.title}</strong></td>
                              <td><code>{p.sku || 'N/A'}</code></td>
                              <td>{p.vendorId?.shopName || 'N/A'}</td>
                              <td>{p.category}</td>
                              <td>₹{(p.price || 0).toFixed(2)}</td>
                              <td><strong>{p.stock}</strong></td>
                              <td>
                                {p.stock <= 0 ? (
                                  <span className="badge-critical">Out of Stock</span>
                                ) : (
                                  <span className="badge-warning">Low Stock ({p.stock})</span>
                                )}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="7" className="no-data">All products are healthy above {inventoryData.threshold} units</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: USERS & VENDORS */}
        {activeTab === 'users' && (
          <div className="dashboard-sections">
            {/* User Management Section */}
            <div className="section user-management-section">
              <div className="section-header-flex">
                <h2 className="section-title">
                  <span className="section-icon">👥</span>
                  User Management ({usersTotal})
                </h2>
                <div className="user-filter-controls">
                  <select
                    value={userRoleFilter}
                    onChange={(e) => {
                      setUserRoleFilter(e.target.value);
                      setTimeout(fetchUsers, 0);
                    }}
                  >
                    <option value="all">All Roles</option>
                    <option value="buyer">Buyers</option>
                    <option value="vendor">Vendors</option>
                    <option value="admin">Admins</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Search username or email..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') fetchUsers(); }}
                  />
                  <button className="btn-small btn-primary" onClick={fetchUsers}>Search</button>
                </div>
              </div>

              <div className="table-container">
                {usersLoading ? (
                  <div className="spinner"></div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Username</th>
                        <th>Email</th>
                        <th>Current Role</th>
                        <th>Joined</th>
                        <th>Change Role</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.length > 0 ? (
                        users.map(u => (
                          <tr key={u._id}>
                            <td><strong>{u.username}</strong></td>
                            <td>{u.email}</td>
                            <td>
                              <span className={`role-badge role-${u.role}`}>{u.role}</span>
                            </td>
                            <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                            <td>
                              <select
                                value={u.role}
                                onChange={(e) => updateUserRole(u._id, e.target.value)}
                                className="role-select"
                              >
                                <option value="buyer">Buyer</option>
                                <option value="vendor">Vendor</option>
                                <option value="admin">Admin</option>
                              </select>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="5" className="no-data">No users found</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Vendor Management Section */}
            <div className="section vendor-management-section">
              <div className="section-header-flex">
                <h2 className="section-title">
                  <span className="section-icon">🏪</span>
                  Vendor Management ({allVendors.length})
                </h2>
                <div className="user-filter-controls">
                  <select
                    value={vendorStatusFilter}
                    onChange={(e) => {
                      setVendorStatusFilter(e.target.value);
                      setTimeout(fetchVendors, 0);
                    }}
                  >
                    <option value="all">All Statuses</option>
                    <option value="approved">Approved</option>
                    <option value="pending">Pending</option>
                    <option value="rejected">Rejected</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Search shop name..."
                    value={vendorSearch}
                    onChange={(e) => setVendorSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') fetchVendors(); }}
                  />
                  <button className="btn-small btn-primary" onClick={fetchVendors}>Search</button>
                </div>
              </div>

              <div className="table-container">
                {vendorsLoading ? (
                  <div className="spinner"></div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Shop Name</th>
                        <th>Owner</th>
                        <th>Email</th>
                        <th>GSTIN</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allVendors.length > 0 ? (
                        allVendors.map(v => (
                          <tr key={v._id}>
                            <td><strong>{v.shopName}</strong></td>
                            <td>{v.userId?.username || 'N/A'}</td>
                            <td>{v.userId?.email || 'N/A'}</td>
                            <td>{v.gstin || 'N/A'}</td>
                            <td>
                              <span className={`status-badge status-${v.approvalStatus}`}>
                                {v.approvalStatus}
                              </span>
                            </td>
                            <td>
                              <div className="action-buttons">
                                {v.approvalStatus !== 'approved' && (
                                  <button
                                    className="btn-small btn-success"
                                    onClick={() => updateVendorStatus(v._id, 'approved')}
                                  >
                                    Approve
                                  </button>
                                )}
                                {v.approvalStatus !== 'rejected' && (
                                  <button
                                    className="btn-small btn-danger"
                                    onClick={() => updateVendorStatus(v._id, 'rejected')}
                                  >
                                    Reject
                                  </button>
                                )}
                                {v.approvalStatus !== 'pending' && (
                                  <button
                                    className="btn-small btn-secondary"
                                    onClick={() => updateVendorStatus(v._id, 'pending')}
                                  >
                                    Set Pending
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="6" className="no-data">No vendors found</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: COMMISSIONS & EARNINGS */}
        {activeTab === 'earnings' && (
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
                          <td>₹{(commission.totalAmount || 0).toFixed(2)}</td>
                          <td>₹{(commission.vendorEarning || 0).toFixed(2)}</td>
                          <td className="highlight-cell">₹{(commission.commissionAmount || 0).toFixed(2)}</td>
                          <td>{((commission.commissionRate || 0) * 100).toFixed(0)}%</td>
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
          </div>
        )}

        {/* TAB 6: CONTACT MESSAGES */}
        {activeTab === 'messages' && (
          <div className="dashboard-sections">
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
        )}

        {/* TAB 7: AUDIT TRAIL */}
        {activeTab === 'audit' && (
          <div className="dashboard-sections">
            <div className="section audit-section">
              <div className="section-header-flex">
                <h2 className="section-title">
                  <span className="section-icon">🛡️</span>
                  System Audit Trail
                  <span className="section-count">{auditTotal} Events</span>
                </h2>
                <div className="user-filter-controls">
                  <select
                    value={auditFilterResource}
                    onChange={(e) => {
                      setAuditFilterResource(e.target.value);
                      setTimeout(() => fetchAuditLogs(1), 0);
                    }}
                  >
                    <option value="all">All Resources</option>
                    <option value="Order">Orders</option>
                    <option value="Product">Products</option>
                    <option value="User">Users</option>
                    <option value="Vendor">Vendors</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Filter by action (e.g. order.status_change)..."
                    value={auditFilterAction}
                    onChange={(e) => setAuditFilterAction(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') fetchAuditLogs(1); }}
                  />
                  <button className="btn-small btn-primary" onClick={() => fetchAuditLogs(1)}>Filter</button>
                  <button className="btn-small btn-secondary" onClick={() => {
                    setAuditFilterAction('');
                    setAuditFilterResource('all');
                    setTimeout(() => fetchAuditLogs(1), 0);
                  }}>Reset</button>
                </div>
              </div>

              <div className="table-container">
                {auditLoading ? (
                  <div className="spinner"></div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Actor</th>
                        <th>Action</th>
                        <th>Resource</th>
                        <th>Resource ID</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.length > 0 ? (
                        auditLogs.map(log => (
                          <tr key={log._id}>
                            <td>{new Date(log.timestamp).toLocaleString()}</td>
                            <td>
                              <span className={`role-badge role-${log.actorRole || 'system'}`}>
                                {log.actorId?.username || log.actorRole}
                              </span>
                            </td>
                            <td><code>{log.action}</code></td>
                            <td><strong>{log.resourceType}</strong></td>
                            <td><code>{log.resourceId ? log.resourceId.slice(-8) : 'N/A'}</code></td>
                            <td>
                              <button
                                className="btn-small btn-outline"
                                onClick={() => setSelectedAuditLog(log)}
                              >
                                View Snapshot
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="6" className="no-data">No audit logs found matching criteria</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>

              {auditTotalPages > 1 && (
                <div className="pagination-bar">
                  <button
                    disabled={auditPage <= 1}
                    onClick={() => fetchAuditLogs(auditPage - 1)}
                    className="btn-small btn-secondary"
                  >
                    &laquo; Prev
                  </button>
                  <span className="pagination-info">Page {auditPage} of {auditTotalPages}</span>
                  <button
                    disabled={auditPage >= auditTotalPages}
                    onClick={() => fetchAuditLogs(auditPage + 1)}
                    className="btn-small btn-secondary"
                  >
                    Next &raquo;
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modal: Order Detail View */}
        {selectedOrder && (
          <div className="message-modal" onClick={() => setSelectedOrder(null)} role="dialog" aria-modal="true" aria-label="Order Details Modal">
            <div className="message-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="message-modal-header">
                <h2>Order Details: #{selectedOrder._id}</h2>
                <button className="close-btn" onClick={() => setSelectedOrder(null)} aria-label="Close order details modal">&times;</button>
              </div>
              <div className="message-modal-body">
                <div className="message-info">
                  <p><strong>Customer:</strong> {selectedOrder.buyerId?.username} ({selectedOrder.buyerId?.email})</p>
                  <p><strong>Vendor:</strong> {selectedOrder.vendorId?.shopName || 'N/A'}</p>
                  <p><strong>Date:</strong> {new Date(selectedOrder.createdAt).toLocaleString()}</p>
                  <p><strong>Order Status:</strong> <span className={`status-badge status-${selectedOrder.status}`}>{selectedOrder.status}</span></p>
                  <p><strong>Payment Status:</strong> <span className={`status-badge status-pay-${selectedOrder.paymentStatus}`}>{selectedOrder.paymentStatus}</span></p>
                  <p><strong>Total Amount:</strong> ₹{(selectedOrder.totalAmount || 0).toFixed(2)}</p>
                  <p><strong>Admin Commission:</strong> ₹{(selectedOrder.adminCommission || 0).toFixed(2)}</p>
                  <p><strong>Vendor Share:</strong> ₹{(selectedOrder.vendorEarning || 0).toFixed(2)}</p>
                </div>
                <h3>Items:</h3>
                <ul className="modal-item-list">
                  {selectedOrder.products?.map((item, idx) => (
                    <li key={idx}>
                      {item.title || item.productId?.title || 'Product'} &times; {item.quantity} — ₹{((item.price || 0) * item.quantity).toFixed(2)}
                      {item.variant && <span> (Variant: {item.variant.name || item.variant.sku})</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Contact Message Detail View */}
        {selectedMessage && (
          <div className="message-modal" onClick={() => setSelectedMessage(null)} role="dialog" aria-modal="true" aria-label="Contact Message Details Modal">
            <div className="message-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="message-modal-header">
                <h2>{selectedMessage.subject}</h2>
                <button className="close-btn" onClick={() => setSelectedMessage(null)} aria-label="Close message modal">&times;</button>
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
        {/* Modal: Audit Log Snapshot View */}
        {selectedAuditLog && (
          <div className="message-modal" onClick={() => setSelectedAuditLog(null)} role="dialog" aria-modal="true" aria-label="Audit Event Details Modal">
            <div className="message-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="message-modal-header">
                <h2>Audit Event: {selectedAuditLog.action}</h2>
                <button className="close-btn" onClick={() => setSelectedAuditLog(null)} aria-label="Close audit log modal">&times;</button>
              </div>
              <div className="message-modal-body">
                <div className="message-info">
                  <p><strong>Resource:</strong> {selectedAuditLog.resourceType} ({selectedAuditLog.resourceId || 'N/A'})</p>
                  <p><strong>Actor:</strong> {selectedAuditLog.actorId?.username || 'N/A'} (Role: {selectedAuditLog.actorRole})</p>
                  <p><strong>Timestamp:</strong> {new Date(selectedAuditLog.timestamp).toLocaleString()}</p>
                </div>
                <h3>Before State:</h3>
                <pre className="audit-json">{JSON.stringify(selectedAuditLog.before || 'None', null, 2)}</pre>
                <h3>After State:</h3>
                <pre className="audit-json">{JSON.stringify(selectedAuditLog.after || 'None', null, 2)}</pre>
                {selectedAuditLog.metadata && Object.keys(selectedAuditLog.metadata).length > 0 && (
                  <>
                    <h3>Metadata:</h3>
                    <pre className="audit-json">{JSON.stringify(selectedAuditLog.metadata, null, 2)}</pre>
                  </>
                )}
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
