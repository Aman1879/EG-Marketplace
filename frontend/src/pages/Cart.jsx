import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Cart.css';

const Cart = () => {
  const { cart, cartSummary, removeFromCart, updateCartQuantity } = useAuth();
  const navigate = useNavigate();
  const [updatingId, setUpdatingId] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isNavigating, setIsNavigating] = useState(false);

  // Compute pricing from items or fallback to cartSummary
  const pricing = cartSummary || {
    subtotal: 0,
    shipping: 0,
    tax: 0,
    discount: 0,
    total: 0,
    canCheckout: false
  };

  const handleQuantityChange = async (item, newQuantity) => {
    setErrorMessage('');
    if (newQuantity <= 0) {
      await handleRemove(item);
      return;
    }

    if (item.availableStock !== undefined && newQuantity > item.availableStock) {
      setErrorMessage(`Cannot exceed available stock (${item.availableStock} available).`);
      return;
    }

    const itemKey = item._id || `${item.productId}_${item.variantId || 'base'}`;
    setUpdatingId(itemKey);

    const result = await updateCartQuantity(
      item._id || item.productId,
      newQuantity,
      item.variantId
    );

    if (result && !result.success) {
      setErrorMessage(result.message || 'Could not update quantity');
    }
    setUpdatingId(null);
  };

  const handleRemove = async (item) => {
    setErrorMessage('');
    const itemKey = item._id || `${item.productId}_${item.variantId || 'base'}`;
    setUpdatingId(itemKey);

    const result = await removeFromCart(
      item._id || item.productId,
      item.variantId
    );

    if (result && !result.success) {
      setErrorMessage(result.message || 'Could not remove item');
    }
    setUpdatingId(null);
  };

  const hasStockIssues = cart.some(
    item => item.inStock === false || item.isAvailable === false || item.stockStatus === 'out_of_stock' || item.stockStatus === 'insufficient_stock'
  );

  const canProceedToCheckout = cart.length > 0 && !hasStockIssues && !isNavigating;

  const handleCheckout = () => {
    if (cart.length === 0) {
      setErrorMessage('Your cart is empty');
      return;
    }

    if (hasStockIssues) {
      setErrorMessage('Please adjust your cart: some items are out of stock or exceed available quantity.');
      return;
    }

    setIsNavigating(true);
    navigate('/checkout');
  };

  if (!cart || cart.length === 0) {
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
            <div className="empty-cart-icon">🛒</div>
            <h2>Your cart is empty</h2>
            <p>Looks like you haven't added any products to your cart yet.</p>
            <button onClick={() => navigate('/products')} className="btn btn-primary">
              Browse Products
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
          <h1 className="page-title">Shopping Cart ({cart.length} {cart.length === 1 ? 'item' : 'items'})</h1>
          <div className="cart-nav">
            <button onClick={() => navigate('/buyer/dashboard')} className="btn btn-secondary btn-small">
              Go to Dashboard
            </button>
          </div>
        </div>

        {errorMessage && (
          <div className="cart-alert-banner" role="alert">
            <span>{errorMessage}</span>
            <button
              onClick={() => setErrorMessage('')}
              className="alert-close-btn"
              aria-label="Dismiss error message"
            >
              &times;
            </button>
          </div>
        )}

        <div className="cart-content">
          <div className="cart-items">
            {cart.map(item => {
              const itemKey = item._id || `${item.productId}_${item.variantId || 'base'}`;
              const isUpdating = updatingId === itemKey;
              const unitPrice = item.unitPrice ?? item.price ?? item.priceAtAdd ?? item.product?.price ?? 0;
              const subtotal = item.itemSubtotal ?? (unitPrice * item.quantity);
              const maxStock = item.availableStock !== undefined ? item.availableStock : 999;
              const isAtMaxStock = item.quantity >= maxStock;

              return (
                <div
                  key={itemKey}
                  className={`cart-item ${item.stockStatus === 'out_of_stock' || item.isAvailable === false ? 'item-unavailable' : ''}`}
                >
                  <img
                    src={item.product?.imageUrl || 'https://via.placeholder.com/150'}
                    alt={item.product?.title || 'Product'}
                    className="cart-item-image"
                    loading="lazy"
                  />
                  <div className="cart-item-info">
                    <h3>{item.product?.title || 'Product removed'}</h3>

                    {item.variantName && (
                      <p className="cart-item-variant">
                        <span className="variant-tag">{item.variantName}</span>
                        {item.variantSku && <span className="sku-tag"> SKU: {item.variantSku}</span>}
                      </p>
                    )}

                    <p className="cart-item-vendor">
                      by {item.product?.vendorId?.shopName || 'Marketplace Vendor'}
                    </p>

                    <div className="cart-item-price-row">
                      <span className="unit-price-label">Unit Price:</span>
                      <span className="cart-item-price">₹{Number(unitPrice).toFixed(2)}</span>
                    </div>

                    <div className="stock-status-container">
                      {item.isAvailable === false ? (
                        <span className="stock-badge badge-unavailable">Unavailable</span>
                      ) : item.stockStatus === 'out_of_stock' || item.availableStock <= 0 ? (
                        <span className="stock-badge badge-out-of-stock">Out of Stock</span>
                      ) : item.stockStatus === 'insufficient_stock' ? (
                        <span className="stock-badge badge-insufficient">
                          Only {item.availableStock} in stock (adjust quantity)
                        </span>
                      ) : item.stockStatus === 'low_stock' ? (
                        <span className="stock-badge badge-low-stock">
                          Only {item.availableStock} left in stock
                        </span>
                      ) : (
                        <span className="stock-badge badge-in-stock">In Stock</span>
                      )}
                    </div>
                  </div>

                  <div className="cart-item-actions">
                    <div className="quantity-controls" role="group" aria-label={`Quantity for ${item.product?.title || 'item'}`}>
                      <button
                        onClick={() => handleQuantityChange(item, item.quantity - 1)}
                        className="quantity-btn"
                        disabled={isUpdating || item.quantity <= 1}
                        title={item.quantity <= 1 ? 'Minimum quantity is 1' : 'Decrease quantity'}
                        aria-label={`Decrease quantity for ${item.product?.title || 'item'}`}
                      >
                        -
                      </button>
                      <span className="quantity" aria-label={`Current quantity: ${item.quantity}`}>{item.quantity}</span>
                      <button
                        onClick={() => handleQuantityChange(item, item.quantity + 1)}
                        className="quantity-btn"
                        disabled={isUpdating || isAtMaxStock}
                        title={isAtMaxStock ? `Max stock reached (${maxStock})` : 'Increase quantity'}
                        aria-label={`Increase quantity for ${item.product?.title || 'item'}`}
                      >
                        +
                      </button>
                    </div>

                    <button
                      onClick={() => handleRemove(item)}
                      className="btn btn-danger btn-small"
                      disabled={isUpdating}
                      aria-label={`Remove ${item.product?.title || 'item'} from cart`}
                    >
                      {isUpdating ? 'Updating...' : 'Remove'}
                    </button>
                  </div>

                  <div className="cart-item-total">
                    <span className="item-subtotal-label">Subtotal:</span>
                    <span className="item-subtotal-val">₹{Number(subtotal).toFixed(2)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="cart-summary">
            <div className="summary-card">
              <h2>Order Summary</h2>

              <div className="summary-row">
                <span>Items Subtotal:</span>
                <span>₹{Number(pricing.subtotal).toFixed(2)}</span>
              </div>

              <div className="summary-row">
                <span>Standard Delivery:</span>
                <span className="free-shipping-tag">FREE</span>
              </div>

              <div className="summary-row">
                <span>Taxes & GST:</span>
                <span className="tax-tag">Included in Price</span>
              </div>

              {pricing.discount > 0 && (
                <div className="summary-row discount">
                  <span>Discount:</span>
                  <span>-₹{Number(pricing.discount).toFixed(2)}</span>
                </div>
              )}

              <div className="summary-row total">
                <span>Total Amount:</span>
                <span>₹{Number(pricing.total).toFixed(2)}</span>
              </div>

              {hasStockIssues && (
                <div className="checkout-warning-note">
                  One or more items in your cart cannot be checked out due to stock constraints. Please review item quantities before proceeding.
                </div>
              )}

              <button
                onClick={handleCheckout}
                disabled={!canProceedToCheckout}
                className="btn btn-primary btn-large btn-checkout"
              >
                {isNavigating ? 'Proceeding...' : 'Proceed to Checkout'}
              </button>

              <button
                onClick={() => navigate('/products')}
                className="btn btn-secondary btn-continue-shopping"
              >
                Continue Shopping
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Cart;
