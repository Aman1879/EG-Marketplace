import { Link } from 'react-router-dom';
import './ProductCard.css';

const ProductCard = ({ product }) => {
  const renderStars = (rating) => {
    const stars = [];
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;

    for (let i = 0; i < 5; i++) {
      if (i < fullStars) {
        stars.push(<span key={i} className="star">★</span>);
      } else if (i === fullStars && hasHalfStar) {
        stars.push(<span key={i} className="star">☆</span>);
      } else {
        stars.push(<span key={i} className="star empty">★</span>);
      }
    }

    return stars;
  };

  return (
    <Link to={`/products/${product._id}`} className="product-card">
      <div className="product-image">
        <img src={product.imageUrl || 'https://via.placeholder.com/300'} alt={product.title} />
      </div>
      <div className="product-info">
        <h3 className="product-title">{product.title}</h3>
        <p className="product-vendor">{product.vendorId?.shopName || 'Shop'}</p>
        <div className="product-rating">
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
        <p className="product-price">₹{product.price.toFixed(2)}</p>
      </div>
    </Link>
  );
};

export default ProductCard;

