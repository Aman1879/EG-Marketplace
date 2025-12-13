import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import ProductCard from '../components/ProductCard';
import './ShopPage.css';

const ShopPage = () => {
  const { id } = useParams();
  const [shop, setShop] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await axios.get(`http://localhost:3000/api/vendors/${id}/public`);
        setShop(res.data.vendor);
        setProducts(res.data.products);
      } catch (error) {
        console.error('Error loading shop', error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  if (loading) return <div className="spinner"></div>;
  if (!shop) return <div className="container">Shop not found.</div>;

  return (
    <div className="shop-page">
      <div className="shop-hero">
        <div className="banner">
          {shop.bannerUrl ? (
            <img src={shop.bannerUrl} alt={shop.shopName} />
          ) : (
            <div className="banner-placeholder"></div>
          )}
        </div>
        <div className="shop-meta container">
          <div className="logo">
            {shop.logoUrl ? (
              <img src={shop.logoUrl} alt={shop.shopName} />
            ) : (
              <div className="logo-placeholder">{shop.shopName?.charAt(0) || 'S'}</div>
            )}
          </div>
          <div className="info">
            <p className="eyebrow">Vendor Shop</p>
            <h1>{shop.shopName}</h1>
            <p className="muted">{shop.description || 'No description yet.'}</p>
            <p className="muted small">
              {shop.categories?.length ? shop.categories.join(', ') : shop.category || 'No categories'}
            </p>
            <p className="muted small">
              {shop.contactEmail || 'Contact not set'} {shop.contactPhone && `• ${shop.contactPhone}`}
            </p>
          </div>
        </div>
      </div>

      <div className="container">
        <div className="section-heading">
          <h2>Products</h2>
          <p className="muted">{products.length} items</p>
        </div>
        {products.length ? (
          <div className="products-grid">
            {products.map(product => (
              <ProductCard key={product._id} product={product} />
            ))}
          </div>
        ) : (
          <p className="muted">No products yet.</p>
        )}
      </div>
    </div>
  );
};

export default ShopPage;


