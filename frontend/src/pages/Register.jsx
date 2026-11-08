import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AuthPromoPanel from '../components/AuthPromoPanel';
import './Auth.css';
import './Register.css';

const Register = () => {
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    role: 'buyer'
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleRoleSelect = (selectedRole) => {
    setFormData(prev => ({
      ...prev,
      role: selectedRole
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (formData.username.trim().length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      const result = await register(formData);
      setLoading(false);
      if (result.success) {
        navigate('/login');
      } else {
        setError(result.message || 'Registration failed. Please check your details.');
      }
    } catch (err) {
      setLoading(false);
      setError('An unexpected error occurred during registration. Please try again.');
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* Left Column: Orange Gradient Promotional Panel */}
        <AuthPromoPanel mode="register" />

        {/* Right Column: Clean Authentication Form */}
        <div className="auth-form-section">
          <div className="auth-header">
            <h1 className="auth-title">Create an Account</h1>
            <p className="auth-subtitle">
              Join EG Marketplace to buy unique handcrafted goods or sell to customers across India.
            </p>
          </div>

          {error && (
            <div className="auth-error-banner" role="alert">
              <span className="auth-error-icon" aria-hidden="true">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form">
            <div className="form-group">
              <label htmlFor="register-username">Username *</label>
              <input
                id="register-username"
                type="text"
                name="username"
                className="auth-input"
                placeholder="e.g., priya_sharma"
                value={formData.username}
                onChange={handleChange}
                autoComplete="username"
                required
                minLength={3}
              />
            </div>

            <div className="form-group">
              <label htmlFor="register-email">Email Address *</label>
              <input
                id="register-email"
                type="email"
                name="email"
                className="auth-input"
                placeholder="e.g., name@example.com"
                value={formData.email}
                onChange={handleChange}
                autoComplete="email"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="register-password">Password (min 6 characters) *</label>
              <div className="password-input-wrapper">
                <input
                  id="register-password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  className="auth-input"
                  placeholder="Create a secure password"
                  value={formData.password}
                  onChange={handleChange}
                  autoComplete="new-password"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  tabIndex={0}
                >
                  {showPassword ? (
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label id="account-type-label">Select Account Type *</label>
              <div className="role-cards-grid" role="radiogroup" aria-labelledby="account-type-label">
                <button
                  type="button"
                  role="radio"
                  aria-checked={formData.role === 'buyer'}
                  className={`role-card-btn ${formData.role === 'buyer' ? 'active' : ''}`}
                  onClick={() => handleRoleSelect('buyer')}
                >
                  <span className="role-card-icon" aria-hidden="true">🛍️</span>
                  <div className="role-card-info">
                    <strong>Buyer / Shopper</strong>
                    <span>Discover &amp; purchase unique handcrafted finds</span>
                  </div>
                </button>

                <button
                  type="button"
                  role="radio"
                  aria-checked={formData.role === 'vendor'}
                  className={`role-card-btn ${formData.role === 'vendor' ? 'active' : ''}`}
                  onClick={() => handleRoleSelect('vendor')}
                >
                  <span className="role-card-icon" aria-hidden="true">🏪</span>
                  <div className="role-card-info">
                    <strong>Artisan / Vendor</strong>
                    <span>Open a shop &amp; sell products across India</span>
                  </div>
                </button>
              </div>

              {/* Hidden select to ensure standard form accessibility */}
              <select
                id="register-role"
                name="role"
                value={formData.role}
                onChange={handleChange}
                className="sr-only"
                aria-hidden="true"
                tabIndex={-1}
              >
                <option value="buyer">Buyer</option>
                <option value="vendor">Vendor</option>
              </select>
            </div>

            {formData.role === 'vendor' && (
              <div className="vendor-onboarding-note" role="note">
                <span className="vendor-note-icon" aria-hidden="true">ℹ️</span>
                <span>
                  <strong>Seller Verification:</strong> After signup, create your shop profile and submit your GSTIN. Your shop will be published once approved by platform admin.
                </span>
              </div>
            )}

            <button
              type="submit"
              className="btn-auth-submit"
              disabled={loading}
              aria-label="Create your account"
            >
              {loading ? 'Creating Account...' : 'Register Account'}
            </button>
          </form>

          <p className="auth-switch-prompt">
            Already have an account?{' '}
            <Link to="/login" className="auth-switch-link">
              Sign in here
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Register;
