import './Logo.css';

const Logo = ({ showText = true, size = 'medium' }) => {
  return (
    <div className={`logo-container logo-${size}`}>
      <div className="logo-icon">
        <img
          src="/logo-icon.png"
          alt="SpotBazar"
          className="logo-img"
          width="40"
          height="45"
        />
      </div>
      {showText && (
        <div className="logo-text">
          <span className="logo-text-line1">Spot</span>
          <span className="logo-text-line2">Bazar</span>
        </div>
      )}
    </div>
  );
};

export default Logo;
