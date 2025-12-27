import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import ProductCard from '../components/ProductCard';
import './Home.css';

const Home = () => {
  const [products, setProducts] = useState([]);
  const [shops, setShops] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [prodRes, shopRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/products`),
        axios.get(`${API_BASE_URL}/api/vendors/shops`)
      ]);
      setProducts(prodRes.data || []);
      setShops((shopRes.data || []).slice(0, 6)); // featured shops
      setLoading(false);
    } catch (error) {
      console.error('Error fetching products:', error);
      setLoading(false);
    }
  };

  const categories = [
    { name: 'Clothing', image: 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=500&h=350&fit=crop', link: '/products?category=Clothing' },
    { name: 'Electronics', image: 'https://images.unsplash.com/photo-1468495244123-6c6c332eeece?w=500&h=350&fit=crop', link: '/products?category=Electronics' },
    { name: 'Home Decor', image: 'https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=500&h=350&fit=crop', link: '/products?category=Home Decor' },
    { name: 'Jewellery', image: 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=500&h=350&fit=crop', link: '/products?category=Jewellery' },
    { name: 'Art & Crafts', image: 'https://images.unsplash.com/photo-1501004318641-b39e6451bec6?w=500&h=350&fit=crop', link: '/products?category=Art & Crafts' },
    { name: 'Beauty Products', image: 'https://images.unsplash.com/photo-1506617420156-8e4536971650?w=500&h=350&fit=crop', link: '/products?category=Beauty Products' },
    { name: 'Footwear', image: 'https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?w=500&h=350&fit=crop', link: '/products?category=Footwear' },
    { name: 'Books', image: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=500&h=350&fit=crop', link: '/products?category=Books' },
    { name: 'Toys & Games', image: 'https://images.unsplash.com/photo-1556012018-50c5c0da73bf?w=500&h=350&fit=crop', link: '/products?category=Toys & Games' },
    { name: 'Kitchenware', image: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=500&h=350&fit=crop', link: '/products?category=Kitchenware' },
    { name: 'Handmade Items', image: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=500&h=350&fit=crop', link: '/products?category=Handmade Items' },
    { name: 'Accessories', image: 'https://images.unsplash.com/photo-1606760227091-3dd870d97f1d?w=500&h=350&fit=crop', link: '/products?category=Accessories' },
    { name: 'Bags', image: 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=500&h=350&fit=crop', link: '/products?category=Bags' },
    { name: 'Stationery', image: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=500&h=350&fit=crop', link: '/products?category=Stationery' },
    { name: 'Gadgets', image: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=500&h=350&fit=crop', link: '/products?category=Gadgets' },
    { name: 'DIY Supplies', image: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=500&h=350&fit=crop', link: '/products?category=DIY Supplies' },
  ];

  if (loading) {
    return <div className="spinner"></div>;
  }

  const featuredProducts = products.slice(0, 8);
  const promotions = [
    { title: 'Trending Now', subtitle: 'Check out the most popular products across India.', cta: '/products' },
    { title: 'New Arrivals', subtitle: 'Discover the latest products added by our trusted vendors.', cta: '/products' },
    { title: 'Top Rated', subtitle: 'Shop the highest-rated items loved by our buyers.', cta: '/products' },
    { title: 'Local Favorites', subtitle: 'Support local makers and explore products from nearby vendors.', cta: '/products' },
    { title: 'Gift Ideas', subtitle: 'Find perfect gifts for birthdays, festivals, and special occasions.', cta: '/products' }
  ];

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-content">
          <h1 className="hero-title">Find something you'll love</h1>
          <p className="hero-subtitle">
            Discover unique and handmade items from independent sellers around the India
          </p>
          <div className="hero-search">
            <input type="text" placeholder="Search for anything..." className="hero-search-input" />
            <Link to="/products" className="btn btn-primary hero-search-btn">Search</Link>
          </div>
        </div>
      </section>

      <section className="categories-section">
        <div className="container">
          <h2 className="section-title">Shop by Category</h2>
          <div className="categories-grid">
            {categories.map((category, index) => (
              <Link key={index} to={category.link} className="category-card">
                <div className="category-image">
                  <img src={category.image} alt={category.name} />
                </div>
                <h3 className="category-name">{category.name}</h3>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="featured-products">
        <div className="container">
          <h2 className="section-title">Eg Marketplace Picks</h2>
          <div className="marketplace-grid">
            <div className="marketplace-card">
              <h3>Featured Shops</h3>
              {shops.length ? (
                <div className="shops-list">
                  {shops.map(shop => (
                    <Link key={shop._id} to={`/shops/${shop._id}`} className="shop-row">
                      <div className="shop-row-logo">
                        {shop.logoUrl ? (
                          <img src={shop.logoUrl} alt={shop.shopName} />
                        ) : (
                          <div className="logo-placeholder">{shop.shopName?.charAt(0) || 'S'}</div>
                        )}
                      </div>
                      <div>
                        <p className="shop-row-name">{shop.shopName}</p>
                        <p className="shop-row-meta">{shop.categories?.join(', ') || shop.category || 'Shop'}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="muted">No shops yet.</p>
              )}
              <Link to="/products" className="btn btn-secondary btn-small">Explore all</Link>
            </div>

            <div className="marketplace-card">
              <h3>Trending Categories</h3>
              <div className="pill-grid">
                {categories.slice(0, 8).map(cat => (
                  <Link key={cat.name} to={cat.link} className="pill-link">
                    {cat.name}
                  </Link>
                ))}
              </div>
            </div>

            <div className="marketplace-card">
              <h3>Featured Products</h3>
              {featuredProducts.length ? (
                <div className="mini-products-grid">
                  {featuredProducts.map(product => (
                    <ProductCard key={product._id} product={product} />
                  ))}
                </div>
              ) : (
                <p className="muted">No featured products yet.</p>
              )}
              <Link to="/products" className="btn btn-secondary btn-small">View all products</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="promotions-section">
        <div className="container promo-grid">
          {promotions.map((promo, idx) => (
            <Link key={idx} to={promo.cta} className="promo-card">
              <h3>{promo.title}</h3>
              <p>{promo.subtitle}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="why-shop-section">
        <div className="container">
          <h2 className="section-title">Why Shop With Us?</h2>
          <div className="features-grid">
            <div className="feature-item">
              <div className="feature-icon">🛍️</div>
              <h3>Unique Items</h3>
              <p>Find one-of-a-kind products from independent sellers</p>
            </div>
            <div className="feature-item">
              <div className="feature-icon">⭐</div>
              <h3>Quality Guaranteed</h3>
              <p>All products are reviewed and rated by buyers</p>
            </div>
            <div className="feature-item">
              <div className="feature-icon">🚚</div>
              <h3>Fast Shipping</h3>
              <p>Quick delivery from sellers Indiawide</p>
            </div>
            <div className="feature-item">
              <div className="feature-icon">💬</div>
              <h3>Support Sellers</h3>
              <p>Directly support independent creators</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;

