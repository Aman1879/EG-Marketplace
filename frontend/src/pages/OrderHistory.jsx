import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import './OrderHistory.css';

const OrderHistory = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/orders/buyer/my-orders`);
      setOrders(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching orders:', error);
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Delivered':
        return 'status-delivered';
      case 'Shipped':
        return 'status-shipped';
      case 'Pending':
        return 'status-pending';
      case 'Processing':
      case 'Confirmed':
        return 'status-processing';
      case 'Cancelled':
        return 'status-cancelled';
      case 'Refunded':
        return 'status-refunded';
      default:
        return 'status-default';
    }
  };

  if (loading) {
    return <div className="spinner"></div>;
  }

  return (
    <div className="order-history-page">
      <div className="container">
        <h1 className="page-title">My Orders</h1>
        
        {orders.length > 0 ? (
          <div className="orders-list">
            {orders.map(order => (
              <div key={order._id} className="order-card">
                <div className="order-header">
                  <div>
                    <h3>Order #{order._id.slice(-8)}</h3>
                    <p className="order-date">
                      {new Date(order.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="order-status">
                    <span className={`status-badge ${getStatusColor(order.status)}`}>
                      {order.status}
                    </span>
                  </div>
                </div>

                <div className="order-items">
                  {order.products.map((item, index) => (
                    <div key={index} className="order-item">
                      <img
                        src={item.productId?.imageUrl || 'https://via.placeholder.com/80'}
                        alt={item.productId?.title || 'Product'}
                        className="order-item-image"
                        loading="lazy"
                      />
                      <div className="order-item-info">
                        <h4>
                          {item.productId?.title || 'Product'}
                          {item.variantName && (
                            <span style={{ fontSize: '13px', color: '#666', fontWeight: 'normal', marginLeft: '6px' }}>
                              ({item.variantName})
                            </span>
                          )}
                        </h4>
                        {item.variantSku && <p style={{ fontSize: '12px', color: '#888' }}>SKU: {item.variantSku}</p>}
                        <p>Quantity: {item.quantity}</p>
                        <p>Price: ₹{item.price.toFixed(2)}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="order-footer">
                  <div className="order-total">
                    <strong>Total: ₹{order.totalAmount.toFixed(2)}</strong>
                  </div>
                  <div className="order-shipping">
                    <p><strong>Shipping to:</strong> {order.shippingAddress}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="no-orders">
            <p>You haven't placed any orders yet.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderHistory;

