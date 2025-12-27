import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import ProductCard from '../components/ProductCard';
import './Products.css';

const Products = () => {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const category = params.get('category');
  const searchParam = params.get('search');

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState(searchParam || '');

  useEffect(() => {
    fetchProducts(category);
  }, [category]);

  useEffect(() => {
    // Update search term when URL parameter changes
    if (searchParam !== null) {
      setSearchTerm(searchParam);
    }
  }, [searchParam]);

  const fetchProducts = async (cat) => {
    try {
      const url = cat
        ? `${API_BASE_URL}/api/products?category=${encodeURIComponent(cat)}`
        : `${API_BASE_URL}/api/products`;
      const response = await axios.get(url);
      setProducts(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching products:', error);
      setLoading(false);
    }
  };

  const filteredProducts = useMemo(() => {
    const base = products;
    const term = searchTerm.trim().toLowerCase();
    if (!term) return base;
    return base.filter(product => {
      const title = (product.title || '').toLowerCase();
      const desc = (product.description || '').toLowerCase();
      const categoryField = (product.category || '').toLowerCase();
      const vendor = (product.vendorId?.shopName || '').toLowerCase();
      return (
        title.includes(term) ||
        desc.includes(term) ||
        categoryField.includes(term) ||
        vendor.includes(term)
      );
    });
  }, [products, searchTerm]);

  if (loading) {
    return <div className="spinner"></div>;
  }

  return (
    <div className="products-page">
      <div className="container">
        <h1 className="page-title">Shop All Products</h1>
        
        <div className="search-bar">
          <input
            type="text"
            placeholder="Search for anything..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                const newParams = new URLSearchParams(location.search);
                if (searchTerm.trim()) {
                  newParams.set('search', searchTerm.trim());
                } else {
                  newParams.delete('search');
                }
                window.history.pushState({}, '', `${location.pathname}?${newParams.toString()}`);
              }
            }}
            className="search-input"
          />
        </div>

        {filteredProducts.length > 0 ? (
          <>
            <div className="results-count">
              {filteredProducts.length} {filteredProducts.length === 1 ? 'product' : 'products'} found
            </div>
            <div className="products-grid">
              {filteredProducts.map(product => (
                <ProductCard key={product._id} product={product} />
              ))}
            </div>
          </>
        ) : (
          <div className="no-products">
            <p>No products found matching "{searchTerm}"</p>
            <p style={{ marginTop: '10px', fontSize: '16px' }}>Try a different search term</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Products;

