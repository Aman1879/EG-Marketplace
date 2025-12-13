import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import './ProductDetail.css';

const ProductDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, addToCart } = useAuth();
  const [product, setProduct] = useState(null);
  const [ratings, setRatings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [showRatingForm, setShowRatingForm] = useState(false);
  const [rating, setRating] = useState(5);
  const [review, setReview] = useState('');

  useEffect(() => {
    fetchProduct();
    fetchRatings();
  }, [id]);

  const fetchProduct = async () => {
    try {
      const response = await axios.get(`http://localhost:3000/api/products/${id}`);
      setProduct(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching product:', error);
      setLoading(false);
    }
  };

  const fetchRatings = async () => {
    try {
      const response = await axios.get(`http://localhost:3000/api/ratings/product/${id}`);
      setRatings(response.data);
    } catch (error) {
      console.error('Error fetching ratings:', error);
    }
  };

  const handleAddToCart = async () => {
    if (!user) {
      navigate('/login');
      return;
    }
    const result = await addToCart(product._id, quantity);
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
      const ordersResponse = await axios.get('http://localhost:3000/api/orders/buyer/my-orders');
      const orders = ordersResponse.data;
      const order = orders.find(o =>
        o.products.some(p => p.productId._id === id) && o.status === 'Delivered'
      );

      if (!order) {
        alert('You can only rate products from delivered orders');
        return;
      }

      await axios.post('http://localhost:3000/api/ratings', {
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
    } catch (error) {
      alert(error.response?.data?.message || 'Error submitting rating');
    }
  };

  const renderStars = (rating) => {
    const stars = [];
    for (let i = 0; i < 5; i++) {
      stars.push(
        <span key={i} className={i < rating ? 'star' : 'star empty'}>
          ★
        </span>
      );
    }
    return stars;
  };

  if (loading) {
    return <div className="spinner"></div>;
  }

  if (!product) {
    return <div className="container">Product not found</div>;
  }

  return (
    <div className="product-detail">
      <div className="container">
        <div className="product-detail-content">
          <div className="product-image-section">
            <img
              src={product.imageUrl || 'https://via.placeholder.com/500'}
              alt={product.title}
              className="product-main-image"
            />
          </div>

          <div className="product-info-section">
            <h1 className="product-title">{product.title}</h1>
            <p className="product-vendor">by {product.vendorId?.shopName || 'Shop'}</p>

            <div className="product-rating-section">
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

            <p className="product-price">₹{product.price.toFixed(2)}</p>

            <p className="product-description">{product.description}</p>

            <div className="product-actions">
              <div className="quantity-selector">
                <label>Quantity:</label>
                <input
                  type="number"
                  min="1"
                  max={product.stock}
                  value={quantity}
                  onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                />
              </div>
              <button onClick={handleAddToCart} className="btn btn-primary btn-large">
                Add to Cart
              </button>
            </div>

            {product.stock < 5 && (
              <p className="stock-warning">Only {product.stock} left in stock!</p>
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
                <label>Rating:</label>
                <select value={rating} onChange={(e) => setRating(parseInt(e.target.value))}>
                  <option value={5}>5 Stars</option>
                  <option value={4}>4 Stars</option>
                  <option value={3}>3 Stars</option>
                  <option value={2}>2 Stars</option>
                  <option value={1}>1 Star</option>
                </select>
              </div>
              <div className="form-group">
                <label>Review:</label>
                <textarea
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
              ratings.map(rating => (
                <div key={rating._id} className="review-item">
                  <div className="review-header">
                    <strong>{rating.buyerId?.username || 'Anonymous'}</strong>
                    <div className="stars">{renderStars(rating.rating)}</div>
                  </div>
                  {rating.review && <p className="review-text">{rating.review}</p>}
                  <p className="review-date">
                    {new Date(rating.createdAt).toLocaleDateString()}
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

