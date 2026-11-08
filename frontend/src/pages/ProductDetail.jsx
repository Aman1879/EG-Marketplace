import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../config/api';
import './ProductDetail.css';

const ProductDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, addToCart } = useAuth();
  const [product, setProduct] = useState(null);
  const [ratings, setRatings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [showRatingForm, setShowRatingForm] = useState(false);
  const [rating, setRating] = useState(5);
  const [review, setReview] = useState('');

  useEffect(() => {
    fetchProduct();
    fetchRatings();
  }, [id]);

  const fetchProduct = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await axios.get(`${API_BASE_URL}/api/products/${id}`);
      setProduct(response.data);
      setSelectedImage(response.data.imageUrl);
      if (response.data.variants && response.data.variants.length > 0) {
        setSelectedVariant(response.data.variants[0]);
      }
      setLoading(false);
    } catch (err) {
      console.error('Error fetching product:', err);
      setError(err.response?.data?.message || 'Failed to load product details');
      setLoading(false);
    }
  };

  const fetchRatings = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/ratings/product/${id}`);
      setRatings(response.data || []);
    } catch (err) {
      console.error('Error fetching ratings:', err);
    }
  };

  const currentStock = selectedVariant && selectedVariant.stock !== undefined
    ? selectedVariant.stock
    : (product ? product.stock : 0);

  const currentPrice = selectedVariant && selectedVariant.price !== undefined
    ? selectedVariant.price
    : (product ? product.price : 0);

  const handleAddToCart = async () => {
    if (!user) {
      navigate('/login');
      return;
    }
    if (currentStock <= 0) {
      alert('This product is out of stock');
      return;
    }
    const result = await addToCart(product._id, quantity, selectedVariant?._id);
    if (result.success) {
      alert('Product added to cart!');
    } else {
      alert(result.message || 'Could not add to cart');
    }
  };

  const handleSubmitRating = async (e) => {
    e.preventDefault();
    if (!user || user.role !== 'buyer') {
      alert('Only buyers can rate products');
      return;
    }

    try {
      // Find user's order for this product
      const ordersResponse = await axios.get(`${API_BASE_URL}/api/orders/buyer/my-orders`);
      const orders = ordersResponse.data;
      const order = orders.find(o =>
        o.products.some(p => (p.productId?._id || p.productId) === id) && o.status === 'Delivered'
      );

      if (!order) {
        alert('You can only rate products from delivered orders');
        return;
      }

      await axios.post(`${API_BASE_URL}/api/ratings`, {
        productId: id,
        orderId: order._id,
        rating,
        review
      });

      alert('Rating submitted successfully!');
      setShowRatingForm(false);
      setReview('');
      fetchProduct();
      fetchRatings();
    } catch (err) {
      alert(err.response?.data?.message || 'Error submitting rating');
    }
  };

  const renderStars = (ratingVal) => {
    const stars = [];
    for (let i = 0; i < 5; i++) {
      stars.push(
        <span key={i} className={i < ratingVal ? 'star' : 'star empty'} aria-hidden="true">
          ★
        </span>
      );
    }
    return stars;
  };

  if (loading) {
    return <div className="spinner"></div>;
  }

  if (error || !product) {
    return (
      <div className="container" style={{ padding: '60px 20px', textAlign: 'center' }}>
        <h2>{error || 'Product not found'}</h2>
        <button onClick={() => navigate('/products')} className="btn btn-primary" style={{ marginTop: '20px' }}>
          Back to Catalogue
        </button>
      </div>
    );
  }

  const allImages = Array.from(new Set([product.imageUrl, ...(product.images || [])].filter(Boolean)));

  return (
    <div className="product-detail">
      <div className="container">
        <div className="breadcrumb" style={{ marginBottom: '20px' }}>
          <Link to="/products">Catalogue</Link>
          {product.category && (
            <>
              <span> / </span>
              <Link to={`/products?category=${encodeURIComponent(product.category)}`}>
                {product.category}
              </Link>
            </>
          )}
          <span> / </span>
          <span>{product.title}</span>
        </div>

        <div className="product-detail-content">
          <div className="product-image-section">
            <img
              src={selectedImage || product.imageUrl || 'https://via.placeholder.com/500'}
              alt={product.title}
              className="product-main-image"
            />
            {allImages.length > 1 && (
              <div className="thumbnail-gallery" role="group" aria-label="Product image gallery">
                {allImages.map((img, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`thumb-btn ${selectedImage === img ? 'active' : ''}`}
                    onClick={() => setSelectedImage(img)}
                    aria-label={`View product image ${idx + 1}`}
                  >
                    <img src={img} alt={`${product.title} thumbnail ${idx + 1}`} loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="product-info-section">
            <div className="product-header-tags">
              {product.category && (
                <span className="product-category-badge">{product.category}</span>
              )}
              {currentStock <= 0 ? (
                <span className="product-stock-badge out-of-stock">Out of Stock</span>
              ) : currentStock <= 5 ? (
                <span className="product-stock-badge low-stock">Only {currentStock} left</span>
              ) : (
                <span className="product-stock-badge in-stock">In Stock ({currentStock})</span>
              )}
            </div>

            <h1 className="product-title">{product.title}</h1>
            <p className="product-vendor">
              by {product.vendorId?._id ? (
                <Link to={`/shops/${product.vendorId._id}`} className="vendor-link">
                  {product.vendorId.shopName || 'Shop'}
                </Link>
              ) : (
                product.vendorId?.shopName || 'Shop'
              )}
            </p>

            <div
              className="product-rating-section"
              aria-label={product.averageRating > 0 ? `Rating: ${product.averageRating.toFixed(1)} out of 5 stars (${product.totalRatings} reviews)` : 'No ratings yet'}
            >
              {product.averageRating > 0 ? (
                <>
                  <div className="stars">{renderStars(Math.round(product.averageRating))}</div>
                  <span className="rating-value">
                    {product.averageRating.toFixed(1)} ({product.totalRatings} reviews)
                  </span>
                </>
              ) : (
                <span className="no-rating">No ratings yet</span>
              )}
            </div>

            <p className="product-price">₹{Number(currentPrice || 0).toFixed(2)}</p>

            {product.variants && product.variants.length > 0 && (
              <div className="variants-section">
                <label className="variants-label" id="variants-options-label">Select Option:</label>
                <div className="variants-options" role="group" aria-labelledby="variants-options-label">
                  {product.variants.map((v, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`variant-chip ${selectedVariant === v ? 'active' : ''}`}
                      onClick={() => setSelectedVariant(v)}
                      aria-pressed={selectedVariant === v}
                    >
                      {v.name || `Option ${i + 1}`}
                      {v.price !== undefined && ` - ₹${v.price}`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="product-description">{product.description}</p>

            <div className="product-actions">
              {currentStock > 0 ? (
                <>
                  <div className="quantity-selector">
                    <label htmlFor="product-quantity-input">Quantity:</label>
                    <input
                      id="product-quantity-input"
                      type="number"
                      min="1"
                      max={currentStock}
                      value={quantity}
                      aria-label="Item quantity"
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 1;
                        setQuantity(Math.max(1, Math.min(val, currentStock)));
                      }}
                    />
                  </div>
                  <button onClick={handleAddToCart} className="btn btn-primary btn-large">
                    Add to Cart
                  </button>
                </>
              ) : (
                <button disabled className="btn btn-disabled btn-large">
                  Out of Stock
                </button>
              )}
            </div>

            {currentStock > 0 && currentStock < 5 && (
              <p className="stock-warning">Hurry! Only {currentStock} left in stock!</p>
            )}
          </div>
        </div>

        <div className="product-reviews">
          <div className="reviews-header">
            <h2>Reviews ({ratings.length})</h2>
            {user && user.role === 'buyer' && (
              <button
                onClick={() => setShowRatingForm(!showRatingForm)}
                className="btn btn-secondary"
              >
                {showRatingForm ? 'Cancel' : 'Write a Review'}
              </button>
            )}
          </div>

          {showRatingForm && (
            <form onSubmit={handleSubmitRating} className="rating-form">
              <div className="form-group">
                <label htmlFor="rating-stars-select">Rating:</label>
                <select
                  id="rating-stars-select"
                  value={rating}
                  onChange={(e) => setRating(parseInt(e.target.value))}
                >
                  <option value={5}>5 Stars</option>
                  <option value={4}>4 Stars</option>
                  <option value={3}>3 Stars</option>
                  <option value={2}>2 Stars</option>
                  <option value={1}>1 Star</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="rating-review-textarea">Review:</label>
                <textarea
                  id="rating-review-textarea"
                  value={review}
                  onChange={(e) => setReview(e.target.value)}
                  rows="4"
                  placeholder="Write your review..."
                />
              </div>
              <button type="submit" className="btn btn-primary">
                Submit Review
              </button>
            </form>
          )}

          <div className="reviews-list">
            {ratings.length > 0 ? (
              ratings.map(ratingItem => (
                <div key={ratingItem._id} className="review-item">
                  <div className="review-header">
                    <strong>{ratingItem.buyerId?.username || 'Anonymous'}</strong>
                    <div className="stars">{renderStars(ratingItem.rating)}</div>
                  </div>
                  {ratingItem.review && <p className="review-text">{ratingItem.review}</p>}
                  <p className="review-date">
                    {new Date(ratingItem.createdAt).toLocaleDateString()}
                  </p>
                </div>
              ))
            ) : (
              <p className="no-reviews">No reviews yet. Be the first to review!</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetail;

