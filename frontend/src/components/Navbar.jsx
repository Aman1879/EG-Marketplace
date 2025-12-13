import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Logo from './Logo';
import './Navbar.css';

const Navbar = () => {
  const { user, logout, cart } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchTerm, setSearchTerm] = useState('');

  // Sync search term with URL when on products page
  useEffect(() => {
    if (location.pathname === '/products') {
      const params = new URLSearchParams(location.search);
      const searchParam = params.get('search');
      if (searchParam) {
        setSearchTerm(searchParam);
      }
    }
  }, [location]);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const handleSearch = () => {
    if (searchTerm.trim()) {
      navigate(`/products?search=${encodeURIComponent(searchTerm.trim())}`);
    } else {
      navigate('/products');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link to="/" className="navbar-logo">
          <Logo showText={true} size="medium" />
        </Link>

        <div className="navbar-search">
          <input
            type="text"
            placeholder="Search for anything..."
            className="search-input"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyPress={handleKeyPress}
          />
          <button 
            className="search-btn"
            onClick={handleSearch}
          >
            Search
          </button>
        </div>

        <div className="navbar-links">
          {user ? (
            <>
              {user.role === 'buyer' && (
                <>
                  <Link to="/buyer/dashboard" className="nav-link">
                    Dashboard
                  </Link>
                  <Link to="/cart" className="cart-button">
                    <span className="cart-icon">🛒</span>
                    <span className="cart-text">Cart</span>
                    <span className="cart-badge">{cartCount}</span>
                  </Link>
                  <Link to="/orders" className="nav-link">
                    Orders
                  </Link>
                </>
              )}
              {user.role === 'vendor' && (
                <Link to="/vendor/dashboard" className="nav-link">
                  Dashboard
                </Link>
              )}
              {user.role === 'vendor' && (
                <Link to="/vendor/onboarding" className="nav-link">
                  Start Shop
                </Link>
              )}
              {user.role === 'admin' && (
                <Link to="/admin/dashboard" className="nav-link">
                  Admin
                </Link>
              )}
              <Link to="/disputes" className="nav-link">
                Disputes
              </Link>
              <span className="nav-user">Hello, {user.username}</span>
              <button onClick={handleLogout} className="btn btn-secondary">
                Logout
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="nav-link">
                Sign in
              </Link>
              <Link to="/register" className="btn btn-primary">
                Register
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;

