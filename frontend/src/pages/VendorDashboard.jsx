import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';
import { API_BASE_URL } from '../config/api';
import './VendorDashboard.css';

const VendorDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { socket } = useSocket();
  const [shops, setShops] = useState([]);
  const [activeShopId, setActiveShopId] = useState('');
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [disputes, setDisputes] = useState([]);
  const [showDisputes, setShowDisputes] = useState(false);
  const [loading, setLoading] = useState(true);
  const [vendorProfile, setVendorProfile] = useState(null);
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [productForm, setProductForm] = useState({
    title: '',
    description: '',
    price: '',
    imageUrl: '',
    stock: 1,
    category: ''
  });
  const [imageSource, setImageSource] = useState('url'); // 'url' | 'upload'
  const [imageFileName, setImageFileName] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    // Refresh orders when shop changes
    if (activeShopId) {
      fetchShopData(activeShopId);
    }
  }, [activeShopId]);

  // Listen for new orders and disputes via Socket.IO
  useEffect(() => {
    if (socket) {
      socket.on('newOrder', (data) => {
        // Refresh orders when a new order is received
        if (activeShopId) {
          fetchShopData(activeShopId);
        } else {
          fetchData();
        }
      });

      socket.on('newDispute', (data) => {
        // Refresh disputes when a new dispute is created
        if (activeShopId) {
          fetchShopData(activeShopId);
        } else {
          fetchData();
        }
      });

      return () => {
        socket.off('newOrder');
        socket.off('newDispute');
      };
    }
  }, [socket, activeShopId]);

  const fetchData = async () => {
    try {
      const shopsRes = await axios.get(`${API_BASE_URL}/api/vendors/my-shops`);
      setShops(shopsRes.data || []);
      const chosenShop = shopsRes.data?.[0];
      if (chosenShop) {
        setActiveShopId(chosenShop._id);
        setVendorProfile(chosenShop);
        await fetchShopData(chosenShop._id);
      } else {
        setLoading(false);
      }
    } catch (error) {
      if (error.response?.status === 404) {
        navigate('/vendor/onboarding');
        return;
      }
      console.error('Error fetching data:', error);
      setLoading(false);
    }
  };

  const fetchShopData = async (shopId) => {
    try {
      const [productsRes, ordersRes, disputesRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/products/vendor/my-products`, {
          params: { vendorId: shopId }
        }),
        axios.get(`${API_BASE_URL}/api/orders/vendor/my-orders`),
        axios.get(`${API_BASE_URL}/api/disputes/vendor/my-disputes`)
      ]);
      setProducts(productsRes.data);
      // Filter orders to show only orders for the selected shop
      // Handle both populated and non-populated vendorId
      const shopOrders = ordersRes.data.filter(order => {
        const orderVendorId = order.vendorId?._id || order.vendorId;
        return orderVendorId && orderVendorId.toString() === shopId.toString();
      });
      setOrders(shopOrders);
      // Filter disputes to show only disputes for the selected shop
      const shopDisputes = disputesRes.data.filter(dispute => {
        const disputeVendorId = dispute.vendorId?._id || dispute.vendorId;
        return disputeVendorId && disputeVendorId.toString() === shopId.toString();
      });
      setDisputes(shopDisputes);
      setVendorProfile(shops.find(s => s._id === shopId) || vendorProfile);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching data:', error);
      setLoading(false);
    }
  };

  const handleProductSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingProduct) {
        await axios.put(`${API_BASE_URL}/api/products/${editingProduct._id}`, {
          ...productForm,
          vendorId: activeShopId
        });
      } else {
        await axios.post(`${API_BASE_URL}/api/products`, {
          ...productForm,
          vendorId: activeShopId
        });
      }
      setShowProductForm(false);
      setEditingProduct(null);
      setProductForm({ title: '', description: '', price: '', imageUrl: '', stock: 1, category: '' });
      setImageFileName('');
      fetchShopData(activeShopId);
    } catch (error) {
      alert(error.response?.data?.message || 'Error saving product');
    }
  };

  const handleEditProduct = (product) => {
    setEditingProduct(product);
    setProductForm({
      title: product.title,
      description: product.description,
      price: product.price,
      imageUrl: product.imageUrl,
      stock: product.stock,
      category: product.category
    });
    setImageSource('url');
    setImageFileName('');
    setShowProductForm(true);
  };

  const handleDeleteProduct = async (productId) => {
    if (!window.confirm('Are you sure you want to delete this product?')) return;
    
    try {
      await axios.delete(`${API_BASE_URL}/api/products/${productId}`);
      fetchData();
    } catch (error) {
      alert(error.response?.data?.message || 'Error deleting product');
    }
  };

  const handleUpdateOrderStatus = async (orderId, status) => {
    try {
      await axios.put(`${API_BASE_URL}/api/orders/${orderId}/status`, { status });
      fetchData();
    } catch (error) {
      alert(error.response?.data?.message || 'Error updating order status');
    }
  };

  if (loading) {
    return <div className="spinner"></div>;
  }

  return (
    <div className="vendor-dashboard">
      <div className="container">
        <div className="dashboard-top">
          <h1 className="page-title">Vendor Dashboard</h1>
          <div className="shop-actions">
            <select
              value={activeShopId}
              onChange={(e) => {
                const id = e.target.value;
                setActiveShopId(id);
                fetchShopData(id);
              }}
              className="shop-selector"
            >
              {shops.map(shop => (
                <option key={shop._id} value={shop._id}>{shop.shopName}</option>
              ))}
            </select>
            <button className="btn btn-secondary" onClick={() => navigate('/vendor/create-shop')}>
              Add Shop
            </button>
          </div>
        </div>

        {vendorProfile && (
          <div className="shop-summary">
            <div className="shop-info">
              <div className="shop-logo">
                {vendorProfile.logoUrl ? (
                  <img src={vendorProfile.logoUrl} alt={vendorProfile.shopName} />
                ) : (
                  <div className="logo-placeholder">{vendorProfile.shopName?.charAt(0) || 'S'}</div>
                )}
              </div>
              <div>
                <h2>{vendorProfile.shopName}</h2>
                <p>{vendorProfile.description || 'No description yet.'}</p>
                <p className="muted">
                  {vendorProfile.categories?.length
                    ? `${vendorProfile.categories.join(', ')}`
                    : (vendorProfile.category || 'No categories set')}
                  {vendorProfile.country && ` • ${vendorProfile.country}`}
                </p>
                <p className="muted">
                  {vendorProfile.contactEmail || 'Contact email not set'} {vendorProfile.contactPhone && `• ${vendorProfile.contactPhone}`}
                </p>
              </div>
            </div>
            <div className="shop-actions">
              <button className="btn btn-secondary" onClick={() => navigate('/vendor/create-shop')}>
                Edit Shop
              </button>
              <button className="btn btn-primary" onClick={() => setShowProductForm(true)}>
                Add Product
              </button>
            </div>
          </div>
        )}

            <div className="dashboard-tabs">
          <button
            className={`tab ${!showProductForm && !showDisputes ? 'active' : ''}`}
            onClick={() => {
              setShowProductForm(false);
              setShowDisputes(false);
            }}
          >
            My Products ({products.length})
          </button>
          <button
            className={`tab ${showProductForm ? 'active' : ''}`}
            onClick={() => {
              setShowProductForm(true);
              setShowDisputes(false);
              setEditingProduct(null);
              setProductForm({ title: '', description: '', price: '', imageUrl: '', stock: 1, category: '' });
            }}
          >
            {editingProduct ? 'Edit Product' : 'Add Product'}
          </button>
          <button
            className={`tab ${showDisputes ? 'active' : ''}`}
            onClick={() => {
              setShowDisputes(true);
              setShowProductForm(false);
            }}
          >
            Disputes ({disputes.length})
          </button>
        </div>

        {showProductForm ? (
          <div className="product-form-section">
            <form onSubmit={handleProductSubmit} className="product-form">
              <div className="form-group">
                <label>Title *</label>
                <input
                  type="text"
                  value={productForm.title}
                  onChange={(e) => setProductForm({ ...productForm, title: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>Description *</label>
                <textarea
                  value={productForm.description}
                  onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                  rows="4"
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Price *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={productForm.price}
                    onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Stock *</label>
                  <input
                    type="number"
                    min="0"
                    value={productForm.stock}
                    onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Category *</label>
                <input
                  type="text"
                  value={productForm.category}
                  onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}
                  required
                  placeholder="e.g., Electronics"
                />
              </div>

              <div className="form-group">
                <label>Image URL *</label>
                <div className="image-source-toggle">
                  <label>
                    <input
                      type="radio"
                      name="imageSource"
                      value="url"
                      checked={imageSource === 'url'}
                      onChange={() => setImageSource('url')}
                    />
                    URL
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="imageSource"
                      value="upload"
                      checked={imageSource === 'upload'}
                      onChange={() => setImageSource('upload')}
                    />
                    Upload
                  </label>
                </div>
                {imageSource === 'url' ? (
                  <input
                    type="url"
                    value={productForm.imageUrl}
                    onChange={(e) => setProductForm({ ...productForm, imageUrl: e.target.value })}
                    required
                    placeholder="https://example.com/image.jpg"
                  />
                ) : (
                  <div className="file-input">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setImageFileName(file.name);
                        const reader = new FileReader();
                        reader.onload = (evt) => {
                          const result = evt.target?.result;
                          if (typeof result === 'string') {
                            setProductForm({ ...productForm, imageUrl: result });
                          }
                        };
                        reader.readAsDataURL(file);
                      }}
                      required={imageSource === 'upload' && !productForm.imageUrl}
                    />
                    {imageFileName && <p className="muted small">Selected: {imageFileName}</p>}
                  </div>
                )}
              </div>

              <div className="form-actions">
                <button type="submit" className="btn btn-primary">
                  {editingProduct ? 'Update Product' : 'Add Product'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowProductForm(false);
                    setEditingProduct(null);
                  }}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        ) : (
          <>
            <div className="products-section">
              <h2>My Products</h2>
              {products.length > 0 ? (
                <div className="products-grid">
                  {products.map(product => (
                    <div key={product._id} className="product-card-admin">
                      <img
                        src={product.imageUrl || 'https://via.placeholder.com/200'}
                        alt={product.title}
                        className="product-image"
                      />
                      <div className="product-info">
                        <h3>{product.title}</h3>
                        <p>₹{product.price.toFixed(2)}</p>
                        <p>Stock: {product.stock}</p>
                        <div className="product-actions">
                          <button
                            onClick={() => handleEditProduct(product)}
                            className="btn btn-secondary btn-small"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteProduct(product._id)}
                            className="btn btn-danger btn-small"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="no-data">No products yet. Add your first product!</p>
              )}
            </div>

            <div className="orders-section">
              <h2>Orders for {vendorProfile?.shopName || 'Selected Shop'}</h2>
              {orders.length > 0 ? (
                <div className="orders-list">
                  {orders.map(order => (
                    <div key={order._id} className="order-card-admin">
                      <div className="order-header">
                        <div>
                          <h3>Order #{order._id.slice(-8)}</h3>
                          <p><strong>Buyer:</strong> {order.buyerId?.username || order.buyerId?.email || 'N/A'}</p>
                          <p><strong>Date:</strong> {new Date(order.createdAt).toLocaleDateString()}</p>
                          <p><strong>Total:</strong> ₹{order.totalAmount.toFixed(2)}</p>
                          <p><strong>Your Earning:</strong> ₹{order.vendorEarning?.toFixed(2) || '0.00'}</p>
                        </div>
                        <div className="order-status-controls">
                          <label>Status:</label>
                          <select
                            value={order.status || 'pending'}
                            onChange={(e) => handleUpdateOrderStatus(order._id, e.target.value)}
                            className="status-select"
                          >
                            <option value="pending">Pending</option>
                            <option value="confirmed">Confirmed</option>
                            <option value="shipped">Shipped</option>
                            <option value="delivered">Delivered</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </div>
                      </div>
                      <div className="order-items">
                        <h4>Products:</h4>
                        {order.products && order.products.length > 0 ? (
                          order.products.map((item, index) => (
                            <div key={index} className="order-item-small">
                              <span>{item.productId?.title || 'Product'}</span>
                              <span>Qty: {item.quantity}</span>
                              <span>₹{((item.price || 0) * (item.quantity || 0)).toFixed(2)}</span>
                            </div>
                          ))
                        ) : (
                          <p className="muted">No products in this order</p>
                        )}
                      </div>
                      {order.shippingAddress && (
                        <div className="shipping-address">
                          <h4>Shipping Address:</h4>
                          <p>
                            {typeof order.shippingAddress === 'string' 
                              ? order.shippingAddress 
                              : `${order.shippingAddress.street || ''}, ${order.shippingAddress.city || ''}, ${order.shippingAddress.state || ''} - ${order.shippingAddress.pincode || ''}`}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="no-data">No orders yet for this shop.</p>
              )}
            </div>

            {showDisputes && (
              <div className="disputes-section">
                <h2>Disputes for {vendorProfile?.shopName || 'Selected Shop'}</h2>
                {disputes.length > 0 ? (
                  <div className="disputes-list">
                    {disputes.map(dispute => (
                      <div key={dispute._id} className="dispute-card-admin">
                        <div className="dispute-header">
                          <div>
                            <h3>Dispute #{dispute._id.slice(-8)}</h3>
                            <p><strong>Buyer:</strong> {dispute.buyerId?.username || dispute.buyerId?.email || 'N/A'}</p>
                            <p><strong>Order:</strong> #{dispute.orderId?._id?.slice(-8) || dispute.orderId?.slice(-8) || 'N/A'}</p>
                            <p><strong>Reason:</strong> {dispute.reason?.replace(/_/g, ' ') || 'N/A'}</p>
                            <p><strong>Date:</strong> {new Date(dispute.createdAt).toLocaleDateString()}</p>
                          </div>
                          <span className={`status-badge dispute-status-${dispute.status}`}>
                            {dispute.status?.replace(/-/g, ' ') || 'open'}
                          </span>
                        </div>
                        <div className="dispute-content">
                          <p><strong>Description:</strong></p>
                          <p>{dispute.description || 'No description'}</p>
                          {dispute.messages && dispute.messages.length > 0 && (
                            <div className="dispute-messages">
                              <h4>Messages:</h4>
                              {dispute.messages.map((msg, idx) => (
                                <div key={idx} className={`message ${msg.senderType}`}>
                                  <strong>{msg.senderType === 'buyer' ? 'Buyer' : msg.senderType === 'vendor' ? 'You' : 'Admin'}:</strong>
                                  <p>{msg.message}</p>
                                </div>
                              ))}
                            </div>
                          )}
                          {dispute.images && dispute.images.length > 0 && (
                            <div className="dispute-images">
                              <h4>Images:</h4>
                              <div className="images-grid">
                                {dispute.images.map((img, idx) => (
                                  <img key={idx} src={img} alt={`Dispute evidence ${idx + 1}`} className="dispute-image" />
                                ))}
                              </div>
                            </div>
                          )}
                          {(dispute.status === 'open' || dispute.status === 'vendor-responded') && (
                            <div className="dispute-actions">
                              <button
                                onClick={() => navigate(`/disputes`)}
                                className="btn btn-primary"
                              >
                                View & Respond
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="no-data">No disputes for this shop.</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default VendorDashboard;

