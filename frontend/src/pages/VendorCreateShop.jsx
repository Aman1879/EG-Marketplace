import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../config/api';
import './VendorOnboarding.css';

const VendorCreateShop = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    shopName: '',
    description: '',
    category: '',
    categories: [],
    country: 'India',
    logoUrl: '',
    bannerUrl: '',
    address: '',
    contactEmail: '',
    contactPhone: ''
  });
  const [logoSource, setLogoSource] = useState('url'); // 'url' | 'upload'
  const [bannerSource, setBannerSource] = useState('url'); // 'url' | 'upload'
  const [logoFileName, setLogoFileName] = useState('');
  const [bannerFileName, setBannerFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchVendor = async () => {
      try {
        const res = await axios.get(`${API_BASE_URL}/api/vendors/me`);
        if (res.data) {
          setForm({
            shopName: res.data.shopName || '',
            description: res.data.description || '',
            category: res.data.category || '',
            categories: res.data.categories || [],
            country: 'India',
            logoUrl: res.data.logoUrl || '',
            bannerUrl: res.data.bannerUrl || '',
            address: res.data.address || '',
            contactEmail: res.data.contactEmail || '',
            contactPhone: res.data.contactPhone || ''
          });
        }
      } catch (err) {
        // ok if no profile yet
      }
    };

    if (user?.role === 'vendor') {
      fetchVendor();
    } else {
      navigate('/');
    }
  }, [user, navigate]);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (!form.category || !form.category.trim()) {
        setError('Please select a category');
        setLoading(false);
        return;
      }
      
      // Ensure token is in headers
      const token = localStorage.getItem('token');
      if (!token) {
        setError('You must be logged in to create a shop');
        setLoading(false);
        return;
      }

      const payload = {
        shopName: form.shopName.trim(),
        description: form.description?.trim() || '',
        category: form.category.trim(),
        categories: [form.category.trim()], // always send array for backend
        country: form.country || 'India',
        logoUrl: form.logoUrl?.trim() || '',
        bannerUrl: form.bannerUrl?.trim() || '',
        address: form.address?.trim() || '',
        contactEmail: form.contactEmail?.trim() || '',
        contactPhone: form.contactPhone?.trim() || ''
      };

      console.log('Submitting payload:', { ...payload, logoUrl: payload.logoUrl?.substring(0, 50) + '...', bannerUrl: payload.bannerUrl?.substring(0, 50) + '...' });

      const response = await axios.post(`${API_BASE_URL}/api/vendors/create`, payload, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log('Shop created successfully:', response.data);
      navigate('/vendor/dashboard');
    } catch (err) {
      let errorMsg = 'Failed to save shop details';
      if (err.response?.data) {
        if (err.response.data.errors && err.response.data.errors.length > 0) {
          errorMsg = err.response.data.errors.map(e => `${e.param || 'Field'}: ${e.msg || e.message}`).join(', ');
        } else if (err.response.data.message) {
          errorMsg = err.response.data.message;
        } else if (err.response.data.error) {
          errorMsg = err.response.data.error;
        }
      } else if (err.message) {
        errorMsg = err.message;
      }
      setError(errorMsg);
      console.error('Shop creation error:', {
        status: err.response?.status,
        data: err.response?.data,
        message: err.message
      });
    } finally {
      setLoading(false);
    }
  };

  if (!user || user.role !== 'vendor') {
    return null;
  }

  return (
    <div className="onboarding-page">
      <div className="container">
        <div className="onboarding-hero">
          <div>
            <p className="eyebrow">Create Your Shop</p>
            <h1>Tell buyers about your store</h1>
            <p className="subtitle">
              Add your shop details, branding, and contact info so buyers know who they are purchasing from.
            </p>
          </div>
          <div className="onboarding-card highlight">
            <h3>What you will set up</h3>
            <ul>
              <li>A memorable shop name and logo</li>
              <li>What you sell and where you are based</li>
              <li>How buyers can contact you</li>
            </ul>
          </div>
        </div>

        <div className="onboarding-grid">
          <div className="onboarding-card">
            <h2>Shop details</h2>
            <form onSubmit={handleSubmit} className="onboarding-form">
              {error && <div className="error-box">{error}</div>}
              <div className="form-group">
                <label>Shop name *</label>
                <input
                  type="text"
                  name="shopName"
                  value={form.shopName}
                  onChange={handleChange}
                  required
                  minLength={3}
                  placeholder="e.g., CozyCraftsStudio"
                />
              </div>
              <div className="form-group">
                <label>Shop logo URL</label>
                <div className="image-source-toggle">
                  <label>
                    <input
                      type="radio"
                      name="logoSource"
                      value="url"
                      checked={logoSource === 'url'}
                      onChange={() => setLogoSource('url')}
                    />
                    URL
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="logoSource"
                      value="upload"
                      checked={logoSource === 'upload'}
                      onChange={() => setLogoSource('upload')}
                    />
                    Upload
                  </label>
                </div>
                {logoSource === 'url' ? (
                  <input
                    type="url"
                    name="logoUrl"
                    value={form.logoUrl}
                    onChange={handleChange}
                    placeholder="https://your-shop-logo.com/logo.png"
                  />
                ) : (
                  <div className="file-input">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setLogoFileName(file.name);
                        const reader = new FileReader();
                        reader.onload = (evt) => {
                          const result = evt.target?.result;
                          if (typeof result === 'string') {
                            setForm({ ...form, logoUrl: result });
                          }
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                    {logoFileName && <p className="muted small">Selected: {logoFileName}</p>}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label>Shop banner URL</label>
                <div className="image-source-toggle">
                  <label>
                    <input
                      type="radio"
                      name="bannerSource"
                      value="url"
                      checked={bannerSource === 'url'}
                      onChange={() => setBannerSource('url')}
                    />
                    URL
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="bannerSource"
                      value="upload"
                      checked={bannerSource === 'upload'}
                      onChange={() => setBannerSource('upload')}
                    />
                    Upload
                  </label>
                </div>
                {bannerSource === 'url' ? (
                  <input
                    type="url"
                    name="bannerUrl"
                    value={form.bannerUrl}
                    onChange={handleChange}
                    placeholder="https://your-shop-banner.com/banner.png"
                  />
                ) : (
                  <div className="file-input">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setBannerFileName(file.name);
                        const reader = new FileReader();
                        reader.onload = (evt) => {
                          const result = evt.target?.result;
                          if (typeof result === 'string') {
                            setForm({ ...form, bannerUrl: result });
                          }
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                    {bannerFileName && <p className="muted small">Selected: {bannerFileName}</p>}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label>What do you sell?</label>
                <select name="category" value={form.category} onChange={handleChange} required>
                  <option value="">Select a primary category</option>
                  <option value="Clothing">Clothing</option>
                  <option value="Electronics">Electronics</option>
                  <option value="Home Decor">Home Decor</option>
                  <option value="Jewellery">Jewellery</option>
                  <option value="Art & Crafts">Art & Crafts</option>
                  <option value="Beauty Products">Beauty Products</option>
                  <option value="Footwear">Footwear</option>
                  <option value="Books">Books</option>
                  <option value="Toys & Games">Toys & Games</option>
                  <option value="Kitchenware">Kitchenware</option>
                  <option value="Handmade Items">Handmade Items</option>
                  <option value="Accessories">Accessories</option>
                  <option value="Bags">Bags</option>
                  <option value="Stationery">Stationery</option>
                  <option value="Gadgets">Gadgets</option>
                  <option value="DIY Supplies">DIY Supplies</option>
                </select>
              </div>
              <div className="form-group">
                <label>Country</label>
                <input
                  type="text"
                  name="country"
                  value="India"
                  readOnly
                />
              </div>
              <div className="form-group">
                <label>Shop description</label>
                <textarea
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  rows="4"
                  placeholder="Tell buyers about your shop, your values, and what makes your items unique."
                />
              </div>
              <div className="form-group">
                <label>Address / Location</label>
                <input
                  type="text"
                  name="address"
                  value={form.address}
                  onChange={handleChange}
                  placeholder="e.g., 123 Market Street, Springfield"
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Contact email</label>
                  <input
                    type="email"
                    name="contactEmail"
                    value={form.contactEmail}
                    onChange={handleChange}
                    placeholder="seller@shop.com"
                  />
                </div>
                <div className="form-group">
                  <label>Contact phone</label>
                  <input
                    type="text"
                    name="contactPhone"
                    value={form.contactPhone}
                    onChange={handleChange}
                  placeholder="Enter your 10-digit Indian mobile number"
                  pattern="[6-9]\d{9}"
                  inputMode="numeric"
                  />
                </div>
              </div>
              <button type="submit" className="btn btn-primary btn-large" disabled={loading}>
                {loading ? 'Saving...' : 'Save and Continue'}
              </button>
            </form>
          </div>

          <div className="onboarding-card secondary">
            <h3>Tips for a great shop</h3>
            <ul>
              <li>Choose a memorable shop name (3+ characters)</li>
              <li>Upload a clean, square logo for trust</li>
              <li>Be clear about what you sell and where you operate</li>
              <li>Add reliable contact details buyers can trust</li>
            </ul>
            <div className="mini-banner">
              <div>
                <p className="eyebrow">Next steps</p>
                <p>After saving, head to your dashboard to add products.</p>
              </div>
              <button className="btn btn-secondary" onClick={() => navigate('/vendor/dashboard')}>
                Go to Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VendorCreateShop;


