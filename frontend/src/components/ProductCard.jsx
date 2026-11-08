import { Link } from 'react-router-dom';
import './ProductCard.css';

const ProductCard = ({ product }) => {
  const renderStars = (rating) => {
    const stars = [];
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;

    for (let i = 0; i < 5; i++) {
      if (i < fullStars) {
        stars.push(<span key={i} className="star" aria-hidden="true">★</span>);
      } else if (i === fullStars && hasHalfStar) {
        stars.push(<span key={i} className="star" aria-hidden="true">☆</span>);
      } else {
        stars.push(<span key={i} className="star empty" aria-hidden="true">★</span>);
      }
    }

    return stars;
  };

  return (
    <Link to={`/products/${product._id}`} className="product-card" aria-label={`${product.title}, ₹${Number(product.price || 0).toFixed(2)}`}>
      <div className="product-image">
        <img
          src={product.imageUrl || 'https://via.placeholder.com/300'}
          alt={product.title}
          loading="lazy"
        />
        {product.stock <= 0 ? (
          <span className="card-badge out-of-stock-badge">Out of Stock</span>
        ) : product.stock <= 3 ? (
          <span className="card-badge low-stock-badge">Only {product.stock} left</span>
        ) : null}
        {product.category && (
          <span className="card-badge category-tag">{product.category}</span>
        )}
      </div>
      <div className="product-info">
        <h3 className="product-title">{product.title}</h3>
        <p className="product-vendor">{product.vendorId?.shopName || 'Shop'}</p>
        <div
          className="product-rating"
          aria-label={product.averageRating > 0 ? `Rating: ${product.averageRating.toFixed(1)} out of 5 stars (${product.totalRatings || 0} reviews)` : 'No ratings yet'}
        >
          {product.averageRating > 0 ? (
            <>
              <div className="stars">{renderStars(product.averageRating)}</div>
              <span className="rating-text">
                ({product.totalRatings || 0})
              </span>
            </>
          ) : (
            <span className="no-rating">No ratings yet</span>
          )}
        </div>
        <p className="product-price">₹{Number(product.price || 0).toFixed(2)}</p>
      </div>
    </Link>
  );
};

export default ProductCard;

