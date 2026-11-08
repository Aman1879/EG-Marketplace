import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../config/api';
import './Checkout.css';

const getOrGenerateIdempotencyKey = (cartItems) => {
  const cartFingerprint = (cartItems || [])
    .map(i => `${i.productId}_${i.variantId || ''}_${i.quantity}`)
    .sort()
    .join('|');
  const storageKey = 'eg_active_checkout_key';

  try {
    const saved = sessionStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.fingerprint === cartFingerprint && parsed.key) {
        return parsed.key;
      }
    }
  } catch (e) {}

  const newKey = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `checkout_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  try {
    sessionStorage.setItem(storageKey, JSON.stringify({ key: newKey, fingerprint: cartFingerprint }));
  } catch (e) {}

  return newKey;
};

const Checkout = () => {
  const { user, cart, clearCart } = useAuth();
  const navigate = useNavigate();
  const [address, setAddress] = useState({
    fullName: '',
    house: '',
    street: '',
    landmark: '',
    city: '',
    state: '',
    pin: '',
    phone: ''
  });
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState('new');
  const [saveToBook, setSaveToBook] = useState(false);
  const [isDefaultNew, setIsDefaultNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => getOrGenerateIdempotencyKey(cart));
  const [razorpayLoaded, setRazorpayLoaded] = useState(false);
  const [razorpayStatus, setRazorpayStatus] = useState('checking');
  const [razorpayMessage, setRazorpayMessage] = useState('Checking payment gateway...');

  useEffect(() => {
    // Retain or regenerate idempotency key for this cart configuration across reloads
    setIdempotencyKey(getOrGenerateIdempotencyKey(cart));
  }, [cart]);

  // Load saved delivery addresses for authenticated customer
  useEffect(() => {
    const fetchSavedAddresses = async () => {
      try {
        const res = await axios.get(`${API_BASE_URL}/api/addresses`);
        const list = Array.isArray(res.data) ? res.data : (res.data?.addresses || []);
        setSavedAddresses(list);
        if (list.length > 0) {
          const defaultAddr = list.find(a => a.isDefault) || list[0];
          setSelectedAddressId(defaultAddr._id);
          setAddress({
            fullName: defaultAddr.fullName || '',
            house: defaultAddr.addressLine1 || '',
            street: defaultAddr.addressLine2 || '',
            landmark: defaultAddr.landmark || '',
            city: defaultAddr.city || '',
            state: defaultAddr.state || '',
            pin: defaultAddr.postalCode || '',
            phone: defaultAddr.phone || ''
          });
        } else {
          setSelectedAddressId('new');
          setSaveToBook(true);
        }
      } catch (err) {
        console.warn('Could not load saved addresses:', err.message);
      }
    };

    fetchSavedAddresses();
  }, []);

  const handleSelectAddress = (id) => {
    setSelectedAddressId(id);
    if (id === 'new') {
      setAddress({
        fullName: user?.username || '',
        house: '',
        street: '',
        landmark: '',
        city: '',
        state: '',
        pin: '',
        phone: ''
      });
      setSaveToBook(true);
    } else {
      const selected = savedAddresses.find(a => a._id === id);
      if (selected) {
        setAddress({
          fullName: selected.fullName || '',
          house: selected.addressLine1 || '',
          street: selected.addressLine2 || '',
          landmark: selected.landmark || '',
          city: selected.city || '',
          state: selected.state || '',
          pin: selected.postalCode || '',
          phone: selected.phone || ''
        });
      }
    }
  };

  useEffect(() => {
    // Load Razorpay script
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => setRazorpayLoaded(true);
    script.onerror = () => console.error('Failed to load Razorpay');
    document.body.appendChild(script);

    const checkRazorpay = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/orders/health/razorpay`);
        if (response.data?.configured) {
          setRazorpayStatus('ready');
          setRazorpayMessage('Payment gateway is ready.');
        } else {
          setRazorpayStatus('unconfigured');
          setRazorpayMessage('Payment gateway is not configured on the hosted server. Please contact support.');
        }
      } catch (error) {
        setRazorpayStatus('error');
        setRazorpayMessage('Unable to verify payment gateway configuration. Please try again later.');
      }
    };

    checkRazorpay();

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  const totalPaise = cart.reduce((sumPaise, item) => {
    const unitPrice = item.unitPrice ?? item.price ?? item.priceAtAdd ?? item.product?.price ?? 0;
    return sumPaise + Math.round(Number(unitPrice) * 100) * (item.quantity || 1);
  }, 0);
  const total = Number((totalPaise / 100).toFixed(2));

  const indianStates = [
    'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
    'Andaman and Nicobar Islands','Chandigarh','Dadra and Nagar Haveli and Daman and Diu','Delhi','Jammu and Kashmir','Ladakh','Lakshadweep','Puducherry'
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isSubmitting || loading) {
      return;
    }

    if (razorpayStatus === 'unconfigured') {
      alert('Payment gateway is not configured on the hosted server. Please contact support.');
      return;
    }

    const problematicItem = cart.find(
      item => item.inStock === false || item.isAvailable === false || item.stockStatus === 'out_of_stock' || item.stockStatus === 'insufficient_stock'
    );
    if (problematicItem) {
      alert(`Product "${problematicItem.product?.title || 'item'}" has stock constraints. Please return to the cart to adjust.`);
      navigate('/cart');
      return;
    }
    
    const cleanPhone = address.phone.trim().replace(/^(\+91[\-\s]?|0)/, '').replace(/[\s\-]/g, '');
    const phoneValid = /^[6-9]\d{9}$/.test(cleanPhone);
    const pinValid = /^\d{6}$/.test(address.pin.trim());
    if (!phoneValid) return alert('Enter a valid 10-digit Indian mobile number (starts with 6/7/8/9)');
    if (!pinValid) return alert('Enter a valid 6-digit PIN code');
    if (!address.state) return alert('Select a state/UT');

    setIsSubmitting(true);
    setLoading(true);

    try {
      let activeAddressId = selectedAddressId !== 'new' ? selectedAddressId : null;

      // If user is entering a new address and requested saving it to Address Book
      if (selectedAddressId === 'new' && saveToBook) {
        try {
          const saveRes = await axios.post(`${API_BASE_URL}/api/addresses`, {
            fullName: address.fullName.trim() || user?.username || 'Customer',
            phone: cleanPhone,
            addressLine1: address.house.trim(),
            addressLine2: address.street.trim(),
            landmark: address.landmark?.trim() || '',
            city: address.city.trim(),
            state: address.state.trim(),
            postalCode: address.pin.trim(),
            isDefault: isDefaultNew
          });
          if (saveRes.data?.address?._id) {
            activeAddressId = saveRes.data.address._id;
          }
        } catch (saveErr) {
          console.warn('Could not auto-save address to book:', saveErr.message);
        }
      }

      const landmarkPart = address.landmark?.trim() ? `, Near ${address.landmark.trim()}` : '';
      const streetPart = address.street?.trim() ? `, ${address.street.trim()}` : '';
      const namePart = address.fullName?.trim() ? `${address.fullName.trim()}, ` : '';
      const shippingAddress = `${namePart}${address.house.trim()}${streetPart}${landmarkPart}, ${address.city.trim()}, ${address.state.trim()} - ${address.pin.trim()}. Phone: ${cleanPhone}`;

      const orderData = {
        idempotencyKey,
        products: cart.map(item => ({
          productId: item.productId,
          variantId: item.variantId || null,
          variantName: item.variantName || '',
          variantSku: item.variantSku || '',
          quantity: item.quantity
        })),
        shippingAddress,
        ...(activeAddressId ? { addressId: activeAddressId } : {})
      };

      // Step 1: Create or retrieve existing Razorpay order (idempotent)
      const response = await axios.post(
        `${API_BASE_URL}/api/orders/create-razorpay-order`,
        orderData,
        {
          headers: {
            'Idempotency-Key': idempotencyKey
          }
        }
      );
      
      const { razorpayOrder, orderId, key } = response.data;

      if (!window.Razorpay) {
        throw new Error('Razorpay SDK not loaded');
      }

      const options = {
        key,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        name: 'SpotBazar',
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
            try { sessionStorage.removeItem('eg_active_checkout_key'); } catch (e) {}
            clearCart();
            navigate('/orders');
          } catch (verifyError) {
            console.error('Payment verification failed:', verifyError);
            alert(verifyError.response?.data?.message || 'Payment verification failed. Please contact support.');
          } finally {
            setIsSubmitting(false);
            setLoading(false);
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
            setIsSubmitting(false);
            setLoading(false);
          }
        }
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (error) {
      if (error.response?.status === 409) {
        // Payload changed under the same key; generate new key for next attempt
        try { sessionStorage.removeItem('eg_active_checkout_key'); } catch (e) {}
        setIdempotencyKey(getOrGenerateIdempotencyKey(cart));
        alert('Checkout parameters changed. A fresh checkout attempt has been prepared. Please click Proceed to Payment again.');
      } else {
        alert(error.response?.data?.message || 'Error creating order');
        console.error('Checkout error:', error);
      }
      setIsSubmitting(false);
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
          <p>{razorpayMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="checkout-page">
      <div className="container">
        <h1 className="page-title">Checkout</h1>
        {razorpayStatus === 'unconfigured' && (
          <div className="gateway-warning" role="alert">
            <strong>Payment gateway unavailable on hosting.</strong>
            <span>{razorpayMessage}</span>
          </div>
        )}
        <div className="checkout-content">
          <div className="checkout-form-section">
            <form onSubmit={handleSubmit} className="checkout-form">
              {savedAddresses.length > 0 && (
                <div className="checkout-address-section">
                  <div className="checkout-address-header">
                    <h3>Select Delivery Address</h3>
                    <Link to="/addresses" className="manage-addresses-link" target="_blank" rel="noopener noreferrer">
                      Manage Address Book ↗
                    </Link>
                  </div>
                  <div className="saved-addresses-selector" role="radiogroup" aria-label="Select delivery address">
                    {savedAddresses.map((addr) => (
                      <label
                        key={addr._id}
                        className={`checkout-address-option ${selectedAddressId === addr._id ? 'selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="checkoutAddress"
                          value={addr._id}
                          checked={selectedAddressId === addr._id}
                          onChange={() => handleSelectAddress(addr._id)}
                        />
                        <div className="option-details">
                          <div className="option-title">
                            <strong>{addr.fullName}</strong>
                            {addr.isDefault && <span className="option-badge-default">Default</span>}
                          </div>
                          <div>
                            {addr.addressLine1}{addr.addressLine2 ? `, ${addr.addressLine2}` : ''}
                            {addr.landmark ? `, Near ${addr.landmark}` : ''}
                          </div>
                          <div>
                            {addr.city}, {addr.state} - {addr.postalCode} | Phone: {addr.phone}
                          </div>
                        </div>
                      </label>
                    ))}

                    <label className={`checkout-address-option ${selectedAddressId === 'new' ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="checkoutAddress"
                        value="new"
                        checked={selectedAddressId === 'new'}
                        onChange={() => handleSelectAddress('new')}
                      />
                      <div className="option-details">
                        <strong>+ Deliver to a different / new address</strong>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              <div className="form-grid">
                <div className="form-group span-2">
                  <label htmlFor="checkout-fullName">Recipient Name</label>
                  <input
                    id="checkout-fullName"
                    type="text"
                    value={address.fullName}
                    onChange={(e) => setAddress({ ...address, fullName: e.target.value })}
                    placeholder="Recipient's Name (e.g., Rahul Sharma)"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="checkout-house">House/Flat No. *</label>
                  <input
                    id="checkout-house"
                    type="text"
                    value={address.house}
                    onChange={(e) => setAddress({ ...address, house: e.target.value })}
                    required
                    placeholder="e.g., 12B"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="checkout-street">Street / Locality *</label>
                  <input
                    id="checkout-street"
                    type="text"
                    value={address.street}
                    onChange={(e) => setAddress({ ...address, street: e.target.value })}
                    required
                    placeholder="e.g., MG Road, Koramangala"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="checkout-landmark">Landmark (Optional)</label>
                  <input
                    id="checkout-landmark"
                    type="text"
                    value={address.landmark}
                    onChange={(e) => setAddress({ ...address, landmark: e.target.value })}
                    placeholder="e.g., Near Metro Station"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="checkout-city">City *</label>
                  <input
                    id="checkout-city"
                    type="text"
                    value={address.city}
                    onChange={(e) => setAddress({ ...address, city: e.target.value })}
                    required
                    placeholder="e.g., Bengaluru"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="checkout-state">State / UT *</label>
                  <select
                    id="checkout-state"
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
                  <label htmlFor="checkout-pin">PIN Code *</label>
                  <input
                    id="checkout-pin"
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
                  <label htmlFor="checkout-phone">Mobile (India) *</label>
                  <input
                    id="checkout-phone"
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

              {selectedAddressId === 'new' && (
                <div className="save-checkbox-container">
                  <label htmlFor="checkout-save-book">
                    <input
                      id="checkout-save-book"
                      type="checkbox"
                      checked={saveToBook}
                      onChange={(e) => setSaveToBook(e.target.checked)}
                    />
                    Save this address to Address Book for future checkouts
                  </label>
                  {saveToBook && (
                    <label htmlFor="checkout-default-new">
                      <input
                        id="checkout-default-new"
                        type="checkbox"
                        checked={isDefaultNew}
                        onChange={(e) => setIsDefaultNew(e.target.checked)}
                      />
                      Make this my default delivery address
                    </label>
                  )}
                </div>
              )}

              <div className="order-items">
                <h3>Order Items</h3>
                {cart.map(item => (
                  <div key={item._id || `${item.productId}_${item.variantId || 'base'}`} className="order-item">
                    <img
                      src={item.product?.imageUrl || 'https://via.placeholder.com/80'}
                      alt={item.product?.title || 'Product'}
                      className="order-item-image"
                      loading="lazy"
                    />
                    <div className="order-item-info">
                      <h4>
                        {item.product?.title || 'Product removed'}
                        {item.variantName && <span style={{ fontSize: '13px', color: '#666', fontWeight: 'normal', marginLeft: '6px' }}>({item.variantName})</span>}
                      </h4>
                      <p>Quantity: {item.quantity}</p>
                    </div>
                    <div className="order-item-price">
                      ₹{Number(item.itemSubtotal !== undefined ? item.itemSubtotal : ((item.unitPrice ?? item.price ?? item.priceAtAdd ?? item.product?.price ?? 0) * item.quantity)).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-large"
                disabled={loading || !razorpayLoaded || razorpayStatus === 'unconfigured'}
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

