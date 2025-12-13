import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Cart.css';

const Cart = () => {
  const { cart, removeFromCart, updateCartQuantity } = useAuth();
  const navigate = useNavigate();

  const total = cart.reduce((sum, item) => {
    const price = item.priceAtAdd ?? item.product?.price ?? 0;
    return sum + price * item.quantity;
  }, 0);

  const handleCheckout = () => {
    if (cart.length === 0) {
      alert('Your cart is empty');
      return;
    }
    navigate('/checkout');
  };

  if (cart.length === 0) {
    return (
      <div className="cart-page">
        <div className="container">
          <h1 className="page-title">Shopping Cart</h1>
          <div className="cart-nav">
            <button onClick={() => navigate('/buyer/dashboard')} className="btn btn-secondary btn-small">
              Go to Dashboard
            </button>
          </div>
          <div className="empty-cart">
            <p>Your cart is empty</p>
            <button onClick={() => navigate('/products')} className="btn btn-primary">
              Continue Shopping
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cart-page">
      <div className="container">
        <div className="cart-header">
          <h1 className="page-title">Shopping Cart</h1>
          <div className="cart-nav">
            <button onClick={() => navigate('/buyer/dashboard')} className="btn btn-secondary btn-small">
              Go to Dashboard
            </button>
          </div>
        </div>
        <div className="cart-content">
          <div className="cart-items">
            {cart.map(item => (
              <div key={item.productId} className="cart-item">
                <img
                  src={item.product?.imageUrl || 'https://via.placeholder.com/150'}
                  alt={item.product?.title || 'Product'}
                  className="cart-item-image"
                />
                <div className="cart-item-info">
                  <h3>{item.product?.title || 'Product removed'}</h3>
                  <p className="cart-item-vendor">by {item.product?.vendorId?.shopName || 'Shop'}</p>
                  <p className="cart-item-price">₹{(item.priceAtAdd ?? item.product?.price ?? 0).toFixed(2)}</p>
                </div>
                <div className="cart-item-actions">
                  <div className="quantity-controls">
                    <button
                      onClick={() => updateCartQuantity(item.productId, item.quantity - 1)}
                      className="quantity-btn"
                    >
                      -
                    </button>
                    <span className="quantity">{item.quantity}</span>
                    <button
                      onClick={() => updateCartQuantity(item.productId, item.quantity + 1)}
                      className="quantity-btn"
                    >
                      +
                    </button>
                  </div>
                  <button
                    onClick={() => removeFromCart(item.productId)}
                    className="btn btn-danger btn-small"
                  >
                    Remove
                  </button>
                </div>
                <div className="cart-item-total">
                  ₹{((item.priceAtAdd ?? item.product?.price ?? 0) * item.quantity).toFixed(2)}
                </div>
              </div>
            ))}
          </div>

          <div className="cart-summary">
            <div className="summary-card">
              <h2>Order Summary</h2>
              <div className="summary-row">
                <span>Subtotal:</span>
                <span>₹{total.toFixed(2)}</span>
              </div>
              <div className="summary-row">
                <span>Shipping:</span>
                <span>Calculated at checkout</span>
              </div>
              <div className="summary-row total">
                <span>Total:</span>
                <span>₹{total.toFixed(2)}</span>
              </div>
              <button onClick={handleCheckout} className="btn btn-primary btn-large">
                Proceed to Checkout
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Cart;

