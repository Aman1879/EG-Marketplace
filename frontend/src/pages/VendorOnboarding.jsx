import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './VendorOnboarding.css';

const VendorOnboarding = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'vendor') {
      navigate('/');
    } else if (user.vendorProfile?.onboardingComplete) {
      navigate('/vendor/dashboard');
    }
  }, [user, navigate]);

  if (!user || user.role !== 'vendor') {
    return null;
  }

  return (
    <div className="onboarding-page">
      <div className="container">
        <div className="onboarding-hero">
          <div>
            <p className="eyebrow">Welcome, {user.username}</p>
            <h1>Open your shop in a few steps</h1>
            <p className="subtitle">
              Tell us about your shop, add branding, and set contact details before you start selling.
            </p>
            <div className="onboarding-actions">
              <button className="btn btn-primary btn-large" onClick={() => navigate('/vendor/create-shop')}>
                Start Your Shop
              </button>
              <button className="btn btn-secondary" onClick={() => navigate('/vendor/dashboard')}>
                Skip to Dashboard
              </button>
            </div>
          </div>
          <div className="onboarding-card highlight">
            <h3>What to expect</h3>
            <ul>
              <li>Add a shop name and logo</li>
              <li>Share what you sell and where you are based</li>
              <li>Provide contact details buyers can trust</li>
            </ul>
          </div>
        </div>

        <div className="onboarding-grid">
          <div className="onboarding-card secondary">
            <h3>Why set up your shop?</h3>
            <ul>
              <li>Build trust with a clear brand</li>
              <li>Get ready to add products and take orders</li>
              <li>Keep buyers informed with up-to-date contact info</li>
            </ul>
          </div>
          <div className="onboarding-card secondary">
            <h3>Need help?</h3>
            <p>We’ll guide you through the basics. You can edit everything later from your dashboard.</p>
            <button className="btn btn-primary" onClick={() => navigate('/vendor/create-shop')}>
              Begin Setup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VendorOnboarding;

