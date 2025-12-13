import './Logo.css';

const Logo = ({ showText = true, size = 'medium' }) => {
  return (
    <div className={`logo-container logo-${size}`}>
      <div className="logo-icon">
        <svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg">
          {/* Shopping Bag Body - rounded rectangle */}
          <rect
            x="20"
            y="25"
            width="80"
            height="95"
            rx="8"
            ry="8"
            fill="#FF6B35"
          />
          {/* Bag Handle - semi-circular */}
          <path
            d="M 35 25 Q 35 15 45 15 L 75 15 Q 85 15 85 25"
            fill="none"
            stroke="#FF6B35"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Eg Text inside bag - properly spaced */}
          <text
            x="60"
            y="80"
            fontSize="32"
            fontWeight="bold"
            fill="white"
            textAnchor="middle"
            fontFamily="Arial, sans-serif"
          >
            <tspan x="50" dy="0">E</tspan>
            <tspan x="70" dy="0">g</tspan>
          </text>
        </svg>
      </div>
      {showText && (
        <div className="logo-text">
          <span className="logo-text-line1">Market</span>
          <span className="logo-text-line2">Place</span>
        </div>
      )}
    </div>
  );
};

export default Logo;

