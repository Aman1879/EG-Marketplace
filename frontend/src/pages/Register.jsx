import { useState, useEffect, useRef } from 'react';
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
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const otpInputRef = useRef(null);
  const { register, sendOtp } = useAuth();
  const navigate = useNavigate();

  // Resend cooldown countdown interval
  useEffect(() => {
    let interval = null;
    if (resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer(prev => (prev > 1 ? prev - 1 : 0));
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [resendTimer]);

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

  const handleSendOtp = async (e) => {
    if (e) e.preventDefault();
    setError('');
    setInfoMessage('');

    const emailTrimmed = formData.email.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailTrimmed || !emailRegex.test(emailTrimmed)) {
      setError('Please enter a valid email address before requesting a verification code.');
      return;
    }

    setSendingOtp(true);

    try {
      const res = await sendOtp(emailTrimmed);
      setSendingOtp(false);

      if (res.success) {
        setOtpSent(true);
        setResendTimer(res.resendCooldown || 60);
        setInfoMessage(res.message || 'Verification code sent to your email. Please enter the 6-digit code below.');
        setTimeout(() => {
          if (otpInputRef.current) {
            otpInputRef.current.focus();
          }
        }, 150);
      } else {
        setError(res.message || 'Failed to send verification code. Please try again.');
        if (res.retryAfter) {
          setResendTimer(res.retryAfter);
        }
      }
    } catch (err) {
      setSendingOtp(false);
      setError('An unexpected error occurred while requesting OTP. Please try again.');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfoMessage('');

    if (formData.username.trim().length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }

    const emailTrimmed = formData.email.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailTrimmed || !emailRegex.test(emailTrimmed)) {
      setError('Please enter a valid email address');
      return;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    if (!otpSent) {
      setError('Please click "Send OTP" to verify your email address before registering.');
      return;
    }

    const otpTrimmed = otp.trim();
    if (!otpTrimmed || otpTrimmed.length !== 6 || !/^\d{6}$/.test(otpTrimmed)) {
      setError('Please enter the 6-digit numeric verification code sent to your email.');
      if (otpInputRef.current) otpInputRef.current.focus();
      return;
    }

    setLoading(true);

    try {
      const result = await register({
        username: formData.username.trim(),
        email: emailTrimmed,
        password: formData.password,
        role: formData.role,
        otp: otpTrimmed
      });
      setLoading(false);

      if (result.success) {
        setInfoMessage('Account created and verified successfully! Redirecting to login...');
        setTimeout(() => {
          navigate('/login', { state: { registeredEmail: emailTrimmed } });
        }, 1400);
      } else {
        setError(result.message || 'Registration failed. Please check your details and verification code.');
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
              Join SpotBazar to buy unique handcrafted goods or sell to customers across India.
            </p>
          </div>

          {error && (
            <div className="auth-error-banner" role="alert">
              <span className="auth-error-icon" aria-hidden="true">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {infoMessage && (
            <div className="auth-success-banner" role="status">
              <span className="auth-success-icon" aria-hidden="true">✅</span>
              <span>{infoMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form" noValidate>
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
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="register-email">Email Address *</label>
              <div className="email-input-wrapper">
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
                  disabled={loading || sendingOtp}
                />
                <button
                  type="button"
                  className="btn-send-otp"
                  onClick={handleSendOtp}
                  disabled={sendingOtp || resendTimer > 0 || !formData.email.trim() || loading}
                  aria-label={otpSent ? 'Resend verification code' : 'Send verification code to email'}
                >
                  {sendingOtp
                    ? 'Sending...'
                    : resendTimer > 0
                    ? `Resend in ${resendTimer}s`
                    : otpSent
                    ? 'Resend OTP'
                    : 'Send OTP'}
                </button>
              </div>
            </div>

            {/* Display OTP input box when OTP has been sent */}
            {otpSent && (
              <div className="otp-verification-card" role="region" aria-label="Email verification code section">
                <div className="form-group">
                  <div className="otp-header-row">
                    <label htmlFor="register-otp">Enter 6-Digit OTP *</label>
                    {resendTimer > 0 && (
                      <span className="otp-countdown-badge" aria-live="polite">
                        Resend in {resendTimer}s
                      </span>
                    )}
                  </div>
                  <div className="otp-input-container">
                    <input
                      ref={otpInputRef}
                      id="register-otp"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      className="auth-input otp-code-input"
                      placeholder="••••••"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      required
                      autoComplete="one-time-code"
                      aria-describedby="otp-help-text"
                      disabled={loading}
                    />
                  </div>
                  <div className="otp-help-row">
                    <span id="otp-help-text">Valid for 5 minutes. Check inbox/spam.</span>
                    <button
                      type="button"
                      className="otp-resend-btn"
                      onClick={handleSendOtp}
                      disabled={resendTimer > 0 || sendingOtp || loading}
                    >
                      {resendTimer > 0 ? `Resend (${resendTimer}s)` : 'Resend Code'}
                    </button>
                  </div>
                </div>
              </div>
            )}

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
                  disabled={loading}
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
                  disabled={loading}
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
                  disabled={loading}
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
              disabled={loading || sendingOtp}
              aria-label={otpSent ? 'Verify and register account' : 'Verify email and register'}
            >
              {loading
                ? 'Verifying & Registering...'
                : otpSent
                ? 'Verify & Register'
                : 'Send OTP & Register'}
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
