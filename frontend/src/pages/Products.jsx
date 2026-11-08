import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import ProductCard from '../components/ProductCard';
import './Products.css';

const CATEGORIES = [
  'All Categories',
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

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest Arrivals' },
  { value: 'price_asc', label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'name_asc', label: 'Name: A to Z' },
  { value: 'name_desc', label: 'Name: Z to A' },
  { value: 'rating_desc', label: 'Highest Rated' }
];

const Products = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // URL state
  const querySearch = searchParams.get('search') || '';
  const queryCategory = searchParams.get('category') || '';
  const queryMinPrice = searchParams.get('minPrice') || '';
  const queryMaxPrice = searchParams.get('maxPrice') || '';
  const queryInStock = searchParams.get('inStock') === 'true';
  const querySort = searchParams.get('sort') || 'newest';
  const queryPage = parseInt(searchParams.get('page') || '1', 10);

  // Local draft states for inputs
  const [searchInput, setSearchInput] = useState(querySearch);
  const [minPriceInput, setMinPriceInput] = useState(queryMinPrice);
  const [maxPriceInput, setMaxPriceInput] = useState(queryMaxPrice);

  // Products and pagination data
  const [products, setProducts] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Sync draft inputs when URL changes
  useEffect(() => {
    setSearchInput(querySearch);
  }, [querySearch]);

  useEffect(() => {
    setMinPriceInput(queryMinPrice);
  }, [queryMinPrice]);

  useEffect(() => {
    setMaxPriceInput(queryMaxPrice);
  }, [queryMaxPrice]);

  // Update a set of params in URL
  const updateParams = useCallback((updates) => {
    const nextParams = new URLSearchParams(searchParams);

    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '' || (key === 'page' && value === 1)) {
        nextParams.delete(key);
      } else {
        nextParams.set(key, String(value));
      }
    });

    setSearchParams(nextParams);
  }, [searchParams, setSearchParams]);

  // Fetch products from backend whenever URL searchParams change
  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = {};
      if (querySearch.trim()) params.search = querySearch.trim();
      if (queryCategory.trim() && queryCategory !== 'All Categories') params.category = queryCategory.trim();
      if (queryMinPrice !== '') params.minPrice = queryMinPrice;
      if (queryMaxPrice !== '') params.maxPrice = queryMaxPrice;
      if (queryInStock) params.inStock = 'true';
      if (querySort) params.sort = querySort;
      params.page = queryPage > 0 ? queryPage : 1;
      params.limit = 12;

      const response = await axios.get(`${API_BASE_URL}/api/products`, { params });
      const data = response.data;

      if (data && Array.isArray(data.products)) {
        setProducts(data.products);
        setTotalCount(data.totalCount || data.total || 0);
        setTotalPages(data.totalPages || 1);
        setCurrentPage(data.currentPage || data.page || 1);
      } else if (Array.isArray(data)) {
        setProducts(data);
        setTotalCount(data.length);
        setTotalPages(1);
        setCurrentPage(1);
      } else {
        setProducts([]);
        setTotalCount(0);
        setTotalPages(1);
      }
    } catch (err) {
      console.error('Error fetching products:', err);
      setError(err.response?.data?.message || 'Failed to load products. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [querySearch, queryCategory, queryMinPrice, queryMaxPrice, queryInStock, querySort, queryPage]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Handlers
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    updateParams({
      search: searchInput.trim(),
      page: 1
    });
  };

  const handleClearSearch = () => {
    setSearchInput('');
    updateParams({ search: '', page: 1 });
  };

  const handleCategoryChange = (e) => {
    const selected = e.target.value;
    updateParams({
      category: selected === 'All Categories' ? '' : selected,
      page: 1
    });
  };

  const handlePriceApply = (e) => {
    e.preventDefault();
    const min = minPriceInput.trim();
    const max = maxPriceInput.trim();

    if (min !== '' && (isNaN(Number(min)) || Number(min) < 0)) {
      alert('Minimum price must be a non-negative number');
      return;
    }
    if (max !== '' && (isNaN(Number(max)) || Number(max) < 0)) {
      alert('Maximum price must be a non-negative number');
      return;
    }
    if (min !== '' && max !== '' && Number(min) > Number(max)) {
      alert('Minimum price cannot be greater than maximum price');
      return;
    }

    updateParams({
      minPrice: min,
      maxPrice: max,
      page: 1
    });
  };

  const handleClearPrice = () => {
    setMinPriceInput('');
    setMaxPriceInput('');
    updateParams({ minPrice: '', maxPrice: '', page: 1 });
  };

  const handleInStockToggle = (e) => {
    updateParams({
      inStock: e.target.checked ? 'true' : '',
      page: 1
    });
  };

  const handleSortChange = (e) => {
    updateParams({
      sort: e.target.value,
      page: 1
    });
  };

  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > totalPages || newPage === currentPage) return;
    updateParams({ page: newPage });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleResetAll = () => {
    setSearchInput('');
    setMinPriceInput('');
    setMaxPriceInput('');
    setSearchParams(new URLSearchParams());
  };

  // Has active non-default filters?
  const hasActiveFilters = Boolean(
    querySearch ||
    (queryCategory && queryCategory !== 'All Categories') ||
    queryMinPrice ||
    queryMaxPrice ||
    queryInStock ||
    (querySort && querySort !== 'newest')
  );

  const startResult = totalCount === 0 ? 0 : (currentPage - 1) * 12 + 1;
  const endResult = Math.min(currentPage * 12, totalCount);

  return (
    <div className="products-page">
      <div className="container">
        <div className="products-header">
          <h1 className="page-title">
            {queryCategory && queryCategory !== 'All Categories' ? queryCategory : 'Shop All Products'}
          </h1>
          <p className="page-subtitle">
            Explore quality handcrafted and curated goods from independent sellers across India.
          </p>
        </div>

        {/* Filter & Search Toolbar */}
        <div className="catalogue-controls-card">
          <form className="catalogue-search-row" onSubmit={handleSearchSubmit} role="search">
            <div className="search-input-wrapper">
              <span className="search-icon" aria-hidden="true">🔍</span>
              <input
                type="text"
                placeholder="Search products by name, description, or keyword..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="search-input"
                aria-label="Search products by name, description, or keyword"
              />
              {searchInput && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={handleClearSearch}
                  title="Clear search"
                  aria-label="Clear search input"
                >
                  ✕
                </button>
              )}
            </div>
            <button type="submit" className="btn btn-primary search-action-btn">
              Search
            </button>
          </form>

          <div className="filters-row">
            {/* Category Filter */}
            <div className="filter-group">
              <label htmlFor="category-select" className="filter-label">Category</label>
              <select
                id="category-select"
                value={queryCategory || 'All Categories'}
                onChange={handleCategoryChange}
                className="filter-select"
              >
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            {/* Price Range Filter */}
            <div className="filter-group price-filter-group">
              <span className="filter-label" id="price-range-label">Price Range (₹)</span>
              <form onSubmit={handlePriceApply} className="price-inputs-form" aria-labelledby="price-range-label">
                <input
                  id="min-price-input"
                  type="number"
                  placeholder="Min"
                  min="0"
                  step="any"
                  value={minPriceInput}
                  onChange={(e) => setMinPriceInput(e.target.value)}
                  className="price-input"
                  title="Minimum price"
                  aria-label="Minimum price in rupees"
                />
                <span className="price-separator" aria-hidden="true">-</span>
                <input
                  id="max-price-input"
                  type="number"
                  placeholder="Max"
                  min="0"
                  step="any"
                  value={maxPriceInput}
                  onChange={(e) => setMaxPriceInput(e.target.value)}
                  className="price-input"
                  title="Maximum price"
                  aria-label="Maximum price in rupees"
                />
                <button type="submit" className="btn btn-secondary btn-apply-price" title="Apply price filter" aria-label="Apply price filter">
                  Apply
                </button>
              </form>
            </div>

            {/* Availability Filter */}
            <div className="filter-group availability-group">
              <label className="checkbox-label" htmlFor="filter-in-stock" title="Show only in-stock items">
                <input
                  id="filter-in-stock"
                  type="checkbox"
                  checked={queryInStock}
                  onChange={handleInStockToggle}
                  className="custom-checkbox"
                />
                <span>In Stock Only</span>
              </label>
            </div>

            {/* Sort Dropdown */}
            <div className="filter-group sort-group">
              <label htmlFor="sort-select" className="filter-label">Sort By</label>
              <select
                id="sort-select"
                value={querySort}
                onChange={handleSortChange}
                className="filter-select"
              >
                {SORT_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Reset All Filters */}
            {hasActiveFilters && (
              <div className="filter-group reset-group">
                <button
                  type="button"
                  onClick={handleResetAll}
                  className="btn btn-outline-reset"
                  title="Reset all filters"
                  aria-label="Reset all filters"
                >
                  Reset Filters ✕
                </button>
              </div>
            )}
          </div>

          {/* Active Filter Chips */}
          {hasActiveFilters && (
            <div className="active-chips-bar" role="group" aria-label="Active filters">
              <span className="chips-label">Active Filters:</span>
              {querySearch && (
                <span className="filter-chip">
                  Keyword: "{querySearch}"
                  <button type="button" onClick={handleClearSearch} aria-label="Remove search filter">✕</button>
                </span>
              )}
              {queryCategory && queryCategory !== 'All Categories' && (
                <span className="filter-chip">
                  Category: {queryCategory}
                  <button type="button" onClick={() => updateParams({ category: '', page: 1 })} aria-label="Remove category filter">✕</button>
                </span>
              )}
              {(queryMinPrice || queryMaxPrice) && (
                <span className="filter-chip">
                  Price: ₹{queryMinPrice || '0'} - {queryMaxPrice ? `₹${queryMaxPrice}` : '∞'}
                  <button type="button" onClick={handleClearPrice} aria-label="Remove price filter">✕</button>
                </span>
              )}
              {queryInStock && (
                <span className="filter-chip">
                  In Stock Only
                  <button type="button" onClick={() => updateParams({ inStock: '', page: 1 })} aria-label="Remove in-stock filter">✕</button>
                </span>
              )}
              {querySort !== 'newest' && (
                <span className="filter-chip">
                  Sort: {SORT_OPTIONS.find(o => o.value === querySort)?.label || querySort}
                  <button type="button" onClick={() => updateParams({ sort: 'newest', page: 1 })} aria-label="Remove sort filter">✕</button>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Results Metadata Header */}
        {!loading && !error && totalCount > 0 && (
          <div className="catalogue-meta-bar">
            <span className="results-count">
              Showing <strong>{startResult}–{endResult}</strong> of <strong>{totalCount}</strong> {totalCount === 1 ? 'product' : 'products'}
            </span>
            <span className="page-indicator">
              Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
            </span>
          </div>
        )}

        {/* Loading Spinner */}
        {loading && (
          <div className="catalogue-loading-container">
            <div className="spinner"></div>
            <p>Loading catalogue products...</p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="catalogue-error-card">
            <h3>Something went wrong</h3>
            <p>{error}</p>
            <button onClick={fetchProducts} className="btn btn-primary" style={{ marginTop: '12px' }}>
              Try Again
            </button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && products.length === 0 && (
          <div className="no-products">
            <div className="no-products-icon">📦</div>
            <h3>No products found</h3>
            <p>
              {hasActiveFilters
                ? 'We could not find any products matching your selected search or filter criteria.'
                : 'No products are currently available in the catalogue.'}
            </p>
            {hasActiveFilters && (
              <button onClick={handleResetAll} className="btn btn-primary" style={{ marginTop: '16px' }}>
                Clear All Filters
              </button>
            )}
          </div>
        )}

        {/* Product Grid */}
        {!loading && !error && products.length > 0 && (
          <div className="products-grid">
            {products.map(product => (
              <ProductCard key={product._id} product={product} />
            ))}
          </div>
        )}

        {/* Server-Side Pagination Controls */}
        {!loading && !error && totalPages > 1 && (
          <div className="pagination-container">
            <button
              className="pagination-btn nav-btn"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage <= 1}
              aria-label="Previous Page"
            >
              ← Previous
            </button>

            <div className="pagination-pages">
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
                .reduce((acc, p, idx, arr) => {
                  if (idx > 0 && p - arr[idx - 1] > 1) {
                    acc.push('ellipsis-' + p);
                  }
                  acc.push(p);
                  return acc;
                }, [])
                .map((item) => {
                  if (typeof item === 'string') {
                    return <span key={item} className="pagination-ellipsis">…</span>;
                  }
                  return (
                    <button
                      key={item}
                      className={`pagination-btn page-num-btn ${item === currentPage ? 'active' : ''}`}
                      onClick={() => handlePageChange(item)}
                      aria-label={`Go to page ${item}`}
                      aria-current={item === currentPage ? 'page' : undefined}
                    >
                      {item}
                    </button>
                  );
                })}
            </div>

            <button
              className="pagination-btn nav-btn"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
              aria-label="Next Page"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Products;
