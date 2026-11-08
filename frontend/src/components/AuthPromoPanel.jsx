import { Link } from 'react-router-dom';

const AuthPromoPanel = ({ mode = 'login' }) => {
  const isRegister = mode === 'register';

  return (
    <div className="auth-promo-panel">
      <div className="auth-promo-top">
        <Link to="/" className="auth-brand-badge" aria-label="Return to EG Marketplace Home">
          <span className="brand-logo-icon" aria-hidden="true">🛍️</span>
          <span className="brand-name">EG Marketplace</span>
        </Link>

        <h2 className="auth-promo-title">
          {isRegister
            ? "Join India's Thriving Artisan & Buyer Community"
            : 'Discover & Shop Handcrafted Treasures Across India'}
        </h2>
        <p className="auth-promo-subtitle">
          {isRegister
            ? 'Create your free account today to purchase authentic handcrafted goods or launch your independent online storefront.'
            : 'Sign in to access your orders, track shipments, and explore thousands of unique items from verified independent creators.'}
        </p>
      </div>

      <div className="auth-promo-illustration" aria-hidden="true">
        <svg
          viewBox="0 0 340 260"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Ambient Glows */}
          <circle cx="170" cy="130" r="110" fill="url(#paint0_radial)" opacity="0.4" />
          
          {/* Background Shopping Box / Parcel */}
          <rect x="180" y="85" width="105" height="110" rx="14" fill="#ffffff" fillOpacity="0.22" />
          <rect x="180" y="125" width="105" height="12" fill="#ffffff" fillOpacity="0.28" />
          <path d="M 232 85 L 232 195" stroke="#ffffff" strokeWidth="4" strokeOpacity="0.3" strokeDasharray="6 4" />
          
          {/* Main Shopping Bag */}
          <path
            d="M 80 90 L 190 90 L 205 200 C 205 208 198 215 190 215 L 75 215 C 67 215 60 208 60 200 L 80 90 Z"
            fill="#ffffff"
            filter="drop-shadow(0 12px 24px rgba(0, 0, 0, 0.16))"
          />
          {/* Bag Handles */}
          <path
            d="M 105 90 C 105 60 165 60 165 90"
            stroke="#f1641e"
            strokeWidth="6"
            strokeLinecap="round"
            fill="none"
          />
          {/* Bag Fold Accent */}
          <path d="M 82 105 L 188 105" stroke="#fce7dc" strokeWidth="2" strokeLinecap="round" />
          
          {/* Bag Front Logo / Monogram */}
          <circle cx="135" cy="148" r="26" fill="#fff4ee" />
          <text
            x="135"
            y="156"
            textAnchor="middle"
            fill="#f1641e"
            fontSize="20"
            fontWeight="900"
            fontFamily="Arial, sans-serif"
          >
            EG
          </text>
          
          {/* Floating Pill Badge 1: 5-Star Rating */}
          <g filter="drop-shadow(0 8px 16px rgba(0, 0, 0, 0.12))">
            <rect x="35" y="45" width="135" height="34" rx="17" fill="#ffffff" />
            <text x="48" y="67" fontSize="13" fill="#f59e0b">★</text>
            <text x="65" y="67" fontSize="11" fontWeight="700" fill="#1f2937" fontFamily="Arial, sans-serif">
              4.9 / 5.0 Rating
            </text>
          </g>

          {/* Floating Pill Badge 2: Verified Seller */}
          <g filter="drop-shadow(0 8px 16px rgba(0, 0, 0, 0.12))">
            <rect x="160" y="195" width="145" height="34" rx="17" fill="#ffffff" />
            <circle cx="178" cy="212" r="8" fill="#10b981" />
            <path d="M 175 212 L 177 214 L 181 209" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
            <text x="194" y="216" fontSize="11" fontWeight="700" fill="#1f2937" fontFamily="Arial, sans-serif">
              Verified Artisans
            </text>
          </g>

          {/* Sparkles / Stars */}
          <path d="M 285 45 L 288 53 L 296 56 L 288 59 L 285 67 L 282 59 L 274 56 L 282 53 Z" fill="#ffffff" opacity="0.9" />
          <path d="M 40 185 L 42 190 L 47 192 L 42 194 L 40 199 L 38 194 L 33 192 L 38 190 Z" fill="#ffffff" opacity="0.8" />
          <circle cx="215" cy="42" r="3" fill="#ffffff" opacity="0.7" />

          {/* Definitions */}
          <defs>
            <radialGradient id="paint0_radial" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(170 130) rotate(90) scale(110)">
              <stop stopColor="#ffffff" stopOpacity="0.4" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
          </defs>
        </svg>
      </div>

      <div className="auth-promo-bottom">
        <div className="auth-promo-features">
          <div className="promo-feature-item">
            <span className="promo-feature-icon" aria-hidden="true">✓</span>
            <span>100% Verified Indian Artisans &amp; Independent Sellers</span>
          </div>
          <div className="promo-feature-item">
            <span className="promo-feature-icon" aria-hidden="true">✓</span>
            <span>Encrypted &amp; Secure Transactions via Razorpay</span>
          </div>
          <div className="promo-feature-item">
            <span className="promo-feature-icon" aria-hidden="true">✓</span>
            <span>Live Order Tracking &amp; Transparent Delivery Updates</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthPromoPanel;

