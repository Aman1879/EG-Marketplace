import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import ProductCard from '../components/ProductCard';
import './BuyerDashboard.css';

const CATEGORY_OPTIONS = [
  'Clothing',
  'Electronics',
  'Home Decor',
  'Jewellery',
  'Art & Crafts',
  'Beauty Products',
  'Footwear',
  'Books',
  'Toys & Games',
  'Kitchenware',
  'Handmade Items',
  'Accessories',
  'Bags',
  'Stationery',
  'Gadgets',
  'DIY Supplies'
];

const BuyerDashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [selectedCategory, setSelectedCategory] = useState(CATEGORY_OPTIONS[0]);
  const [shops, setShops] = useState([]);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchShops(selectedCategory), fetchProducts(selectedCategory)]);
      setLoading(false);
    };
    load();
  }, [selectedCategory]);

  const fetchShops = async (category) => {
    try {
      const res = await axios.get('http://localhost:3000/api/vendors/shops', {
        params: { category }
      });
      setShops(res.data || []);
    } catch (error) {
      console.error('Error fetching shops', error);
    }
  };

  const fetchProducts = async (category) => {
    try {
      const res = await axios.get('http://localhost:3000/api/products', {
        params: { category }
      });
      setProducts(res.data || []);
    } catch (error) {
      console.error('Error fetching products', error);
    }
  };

  const filteredProducts = useMemo(() => {
    if (!search.trim()) return products;
    return products.filter(p =>
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase())
    );
  }, [products, search]);

  if (loading) {
    return <div className="spinner"></div>;
  }

  return (
    <div className="buyer-dashboard">
      <section className="hero-banner">
        <div className="hero-overlay">
          <div className="hero-glass">
            <div className="hero-top-nav">
              <div className="hero-logo">Eg Marketplace</div>
              <div className="hero-links">
                <a href="#categories">Categories</a>
                <a href="#deals">Deals</a>
                <a href="#support">Support</a>
              </div>
              <div className="hero-auth">
                <Link to="/login">Sign In</Link>
                <Link to="/register" className="btn-link">Register</Link>
              </div>
            </div>

            <div className="hero-main">
              <h1 className="hero-title">Discover Unique & Handmade Products</h1>
              <p className="hero-subtitle">Beautiful items crafted by local creators across India</p>
              <div className="hero-search">
                <input
                  type="text"
                  placeholder="Search for products, shops or categories..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button className="btn btn-primary" onClick={() => { /* filtering happens via input */ }}>
                  Search
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="category-showcase">
        <div className="section-heading category-heading">
          <div>
            <p className="section-subtitle">Shop by category</p>
            <h2 className="section-title">Find your perfect match</h2>
            <div className="section-accent"></div>
          </div>
          <p className="muted">{CATEGORY_OPTIONS.length} categories curated for you</p>
        </div>
        <div className="category-grid">
          {CATEGORY_OPTIONS.map(cat => (
            <button
              key={cat}
              className={`category-card ${selectedCategory === cat ? 'active' : ''}`}
              onClick={() => setSelectedCategory(cat)}
            >
              <div className="category-card-title">{cat}</div>
              <p className="category-card-subtitle">Explore {cat} picks</p>
            </button>
          ))}
        </div>
      </section>

      <section className="shops-section">
        <div className="section-heading spaced">
          <div>
            <p className="section-subtitle">Vendors</p>
            <h2 className="section-title">Shops in {selectedCategory}</h2>
          </div>
          <p className="muted">{shops.length} {shops.length === 1 ? 'shop' : 'shops'} found</p>
        </div>
        {shops.length ? (
          <div className="shops-grid">
            {shops.map(shop => (
              <div key={shop._id} className="shop-card" onClick={() => navigate(`/shops/${shop._id}`)}>
                <div className="shop-banner">
                  {shop.bannerUrl ? (
                    <img src={shop.bannerUrl} alt={shop.shopName} />
                  ) : (
                    <div className="banner-placeholder"></div>
                  )}
                </div>
                <div className="shop-body">
                  <div className="shop-logo">
                    {shop.logoUrl ? (
                      <img src={shop.logoUrl} alt={shop.shopName} />
                    ) : (
                      <div className="logo-placeholder">{shop.shopName?.charAt(0) || 'S'}</div>
                    )}
                  </div>
                  <div className="shop-info">
                    <h3>{shop.shopName}</h3>
                    <p className="muted">{shop.description || 'No description yet.'}</p>
                    <p className="muted small">
                      {shop.categories?.length ? shop.categories.join(', ') : shop.category || 'No categories'}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No shops yet in this category.</p>
        )}
      </section>

      <section className="products-section">
        <div className="section-heading spaced">
          <div>
            <p className="section-subtitle">Products</p>
            <h2 className="section-title">Products in {selectedCategory}</h2>
          </div>
          <p className="muted">{filteredProducts.length} items</p>
        </div>
        {filteredProducts.length ? (
          <div className="products-grid">
            {filteredProducts.map(product => (
              <ProductCard key={product._id} product={product} />
            ))}
          </div>
        ) : (
          <p className="muted">No products found.</p>
        )}
      </section>
    </div>
  );
};

export default BuyerDashboard;


