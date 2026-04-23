import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../config/api';
import './Checkout.css';

const Checkout = () => {
  const { cart, clearCart } = useAuth();
  const navigate = useNavigate();
  const [address, setAddress] = useState({
    house: '',
    street: '',
    city: '',
    state: '',
    pin: '',
    phone: ''
  });
  const [loading, setLoading] = useState(false);
  const [razorpayLoaded, setRazorpayLoaded] = useState(false);

  useEffect(() => {
    // Load Razorpay script
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => setRazorpayLoaded(true);
    script.onerror = () => console.error('Failed to load Razorpay');
    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  const total = cart.reduce((sum, item) => {
    const price = item.priceAtAdd ?? item.product?.price ?? 0;
    return sum + price * item.quantity;
  }, 0);

  const indianStates = [
    'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
    'Andaman and Nicobar Islands','Chandigarh','Dadra and Nagar Haveli and Daman and Diu','Delhi','Jammu and Kashmir','Ladakh','Lakshadweep','Puducherry'
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const phoneValid = /^[6-9]\d{9}$/.test(address.phone);
    const pinValid = /^\d{6}$/.test(address.pin);
    if (!phoneValid) return alert('Enter a valid 10-digit Indian mobile number (starts with 6/7/8/9)');
    if (!pinValid) return alert('Enter a valid 6-digit PIN code');
    if (!address.state) return alert('Select a state/UT');

    setLoading(true);

    try {
      const shippingAddress = `${address.house}, ${address.street}, ${address.city}, ${address.state} - ${address.pin}. Phone: ${address.phone}`;
      const orderData = {
        products: cart.map(item => ({
          productId: item.productId,
          quantity: item.quantity
        })),
        shippingAddress
      };

      // Step 1: Create Razorpay order
      const response = await axios.post(`${API_BASE_URL}/api/orders/create-razorpay-order`, orderData);
      
      const { razorpayOrder, orderId, key } = response.data;

      if (!window.Razorpay) {
        throw new Error('Razorpay SDK not loaded');
      }

      const options = {
        key,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        name: 'EG Marketplace',
        description: `Order #${orderId}`,
        order_id: razorpayOrder.id,
        handler: async (paymentResponse) => {
          try {
            // Step 2: Verify payment on backend
            await axios.post(`${API_BASE_URL}/api/orders/verify-payment`, {
              orderId,
              razorpay_order_id: paymentResponse.razorpay_order_id,
              razorpay_payment_id: paymentResponse.razorpay_payment_id,
              razorpay_signature: paymentResponse.razorpay_signature
            });

            alert('Payment successful! Your order has been placed.');
            clearCart();
            navigate('/orders');
          } catch (verifyError) {
            console.error('Payment verification failed:', verifyError);
            alert(verifyError.response?.data?.message || 'Payment verification failed. Please contact support.');
          }
        },
        prefill: {
          phone: address.phone
        },
        theme: {
          color: '#3399cc'
        },
        modal: {
          ondismiss: () => {
            alert('Payment cancelled');
            setLoading(false);
          }
        }
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (error) {
      alert(error.response?.data?.message || 'Error creating order');
      console.error('Checkout error:', error);
    } finally {
      setLoading(false);
    }
  };

  if (cart.length === 0) {
    return (
      <div className="checkout-page">
        <div className="container">
          <h1 className="page-title">Checkout</h1>
          <p>Your cart is empty</p>
          <button onClick={() => navigate('/products')} className="btn btn-primary">
            Continue Shopping
          </button>
        </div>
      </div>
    );
  }

  if (!razorpayLoaded) {
    return (
      <div className="checkout-page">
        <div className="container">
          <p>Loading payment gateway...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="checkout-page">
      <div className="container">
        <h1 className="page-title">Checkout</h1>
        <div className="checkout-content">
          <div className="checkout-form-section">
            <form onSubmit={handleSubmit} className="checkout-form">
              <div className="form-grid">
                <div className="form-group">
                  <label>House/Flat No. *</label>
                  <input
                    type="text"
                    value={address.house}
                    onChange={(e) => setAddress({ ...address, house: e.target.value })}
                    required
                    placeholder="e.g., 12B"
                  />
                </div>
                <div className="form-group">
                  <label>Street / Locality *</label>
                  <input
                    type="text"
                    value={address.street}
                    onChange={(e) => setAddress({ ...address, street: e.target.value })}
                    required
                    placeholder="e.g., MG Road, Koramangala"
                  />
                </div>
                <div className="form-group">
                  <label>City *</label>
                  <input
                    type="text"
                    value={address.city}
                    onChange={(e) => setAddress({ ...address, city: e.target.value })}
                    required
                    placeholder="e.g., Bengaluru"
                  />
                </div>
                <div className="form-group">
                  <label>State / UT *</label>
                  <select
                    value={address.state}
                    onChange={(e) => setAddress({ ...address, state: e.target.value })}
                    required
                  >
                    <option value="">Select state/UT</option>
                    {indianStates.map(st => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>PIN Code *</label>
                  <input
                    type="text"
                    value={address.pin}
                    onChange={(e) => setAddress({ ...address, pin: e.target.value })}
                    required
                    pattern="\d{6}"
                    inputMode="numeric"
                    placeholder="6-digit PIN"
                  />
                </div>
                <div className="form-group">
                  <label>Mobile (India) *</label>
                  <input
                    type="text"
                    value={address.phone}
                    onChange={(e) => setAddress({ ...address, phone: e.target.value })}
                    required
                    pattern="[6-9]\d{9}"
                    inputMode="numeric"
                    placeholder="Enter your 10-digit Indian mobile number"
                  />
                </div>
              </div>

              <div className="order-items">
                <h3>Order Items</h3>
                {cart.map(item => (
                  <div key={item.productId} className="order-item">
                    <img
                      src={item.product?.imageUrl || 'https://via.placeholder.com/80'}
                      alt={item.product?.title || 'Product'}
                      className="order-item-image"
                    />
                    <div className="order-item-info">
                      <h4>{item.product?.title || 'Product removed'}</h4>
                      <p>Quantity: {item.quantity}</p>
                    </div>
                    <div className="order-item-price">
                      ₹{((item.priceAtAdd ?? item.product?.price ?? 0) * item.quantity).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-large"
                disabled={loading}
              >
                {loading ? 'Processing...' : 'Proceed to Payment'}
              </button>
            </form>
          </div>

          <div className="checkout-summary">
            <div className="summary-card">
              <h2>Order Summary</h2>
              <div className="summary-row">
                <span>Subtotal:</span>
                <span>₹{total.toFixed(2)}</span>
              </div>
              <div className="summary-row">
                <span>Shipping:</span>
                <span>Free</span>
              </div>
              <div className="summary-row total">
                <span>Total:</span>
                <span>₹{total.toFixed(2)}</span>
              </div>
              <p className="info-text">You'll be redirected to Razorpay to complete payment securely.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Checkout;

