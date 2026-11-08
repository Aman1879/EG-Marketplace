import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../config/api';
import './AddressBook.css';

const INDIAN_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
  'Andaman and Nicobar Islands','Chandigarh','Dadra and Nagar Haveli and Daman and Diu','Delhi','Jammu and Kashmir','Ladakh','Lakshadweep','Puducherry'
];

const INITIAL_FORM = {
  fullName: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  landmark: '',
  city: '',
  state: '',
  postalCode: '',
  isDefault: false
};

const AddressBook = () => {
  const { user } = useAuth();
  const [addresses, setAddresses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchAddresses = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE_URL}/api/addresses`);
      const list = Array.isArray(res.data) ? res.data : (res.data?.addresses || []);
      setAddresses(list);
    } catch (err) {
      console.error('Failed to load addresses:', err);
      setErrorMsg(err.response?.data?.message || 'Failed to load address book.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAddresses();
  }, []);

  const resetForm = () => {
    setFormData(INITIAL_FORM);
    setEditingId(null);
    setShowForm(false);
    setErrorMsg('');
  };

  const handleOpenAdd = () => {
    resetForm();
    setShowForm(true);
  };

  const handleEdit = (addr) => {
    setErrorMsg('');
    setSuccessMsg('');
    setEditingId(addr._id);
    setFormData({
      fullName: addr.fullName || '',
      phone: addr.phone || '',
      addressLine1: addr.addressLine1 || '',
      addressLine2: addr.addressLine2 || '',
      landmark: addr.landmark || '',
      city: addr.city || '',
      state: addr.state || '',
      postalCode: addr.postalCode || '',
      isDefault: Boolean(addr.isDefault)
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this address?')) {
      return;
    }
    try {
      setErrorMsg('');
      setSuccessMsg('');
      await axios.delete(`${API_BASE_URL}/api/addresses/${id}`);
      setSuccessMsg('Address removed successfully.');
      if (editingId === id) resetForm();
      fetchAddresses();
    } catch (err) {
      console.error('Delete address failed:', err);
      setErrorMsg(err.response?.data?.message || 'Failed to delete address.');
    }
  };

  const handleSetDefault = async (id) => {
    try {
      setErrorMsg('');
      setSuccessMsg('');
      await axios.patch(`${API_BASE_URL}/api/addresses/${id}/default`);
      setSuccessMsg('Default address updated.');
      fetchAddresses();
    } catch (err) {
      console.error('Set default failed:', err);
      setErrorMsg(err.response?.data?.message || 'Failed to set default address.');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!formData.fullName.trim()) {
      return setErrorMsg('Recipient full name is required');
    }
    const cleanPhone = formData.phone.trim().replace(/^(\+91[\-\s]?|0)/, '').replace(/[\s\-]/g, '');
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return setErrorMsg('Enter a valid 10-digit Indian mobile number (starts with 6, 7, 8, or 9)');
    }
    if (!formData.addressLine1.trim()) {
      return setErrorMsg('Address Line 1 (House / Flat / Building) is required');
    }
    if (!formData.city.trim()) {
      return setErrorMsg('City is required');
    }
    if (!formData.state.trim()) {
      return setErrorMsg('State is required');
    }
    if (!/^\d{6}$/.test(formData.postalCode.trim())) {
      return setErrorMsg('Enter a valid 6-digit postal code / PIN');
    }

    setIsSubmitting(true);
    try {
      const payload = {
        fullName: formData.fullName.trim(),
        phone: cleanPhone,
        addressLine1: formData.addressLine1.trim(),
        addressLine2: formData.addressLine2.trim(),
        landmark: formData.landmark.trim(),
        city: formData.city.trim(),
        state: formData.state.trim(),
        postalCode: formData.postalCode.trim(),
        isDefault: formData.isDefault
      };

      if (editingId) {
        await axios.put(`${API_BASE_URL}/api/addresses/${editingId}`, payload);
        setSuccessMsg('Address updated successfully!');
      } else {
        await axios.post(`${API_BASE_URL}/api/addresses`, payload);
        setSuccessMsg('New address added successfully!');
      }

      resetForm();
      fetchAddresses();
    } catch (err) {
      console.error('Save address error:', err);
      setErrorMsg(err.response?.data?.message || 'Failed to save address. Please verify your details.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="address-book-page">
      <div className="container">
        <div className="address-book-header">
          <div>
            <h1 className="page-title">Saved Delivery Addresses</h1>
            <p className="page-subtitle">Manage your shipping destinations for faster checkout</p>
          </div>
          {!showForm && (
            <button className="btn btn-primary" onClick={handleOpenAdd}>
              + Add New Address
            </button>
          )}
        </div>

        {errorMsg && <div className="alert alert-danger" role="alert">{errorMsg}</div>}
        {successMsg && <div className="alert alert-success" role="alert">{successMsg}</div>}

        {showForm && (
          <div className="address-form-card" role="region" aria-labelledby="address-form-title">
            <div className="form-card-header">
              <h2 id="address-form-title">{editingId ? 'Edit Address' : 'Add New Delivery Address'}</h2>
              <button className="btn-close-link" onClick={resetForm} aria-label="Cancel address form">✕ Cancel</button>
            </div>
            <form onSubmit={handleSubmit} className="address-form">
              <div className="form-grid">
                <div className="form-group">
                  <label htmlFor="addr-fullName">Recipient Full Name *</label>
                  <input
                    id="addr-fullName"
                    type="text"
                    required
                    placeholder="e.g., Rahul Sharma"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="addr-phone">Mobile Number (India) *</label>
                  <input
                    id="addr-phone"
                    type="text"
                    required
                    pattern="[6-9]\d{9}"
                    placeholder="10-digit mobile number"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
                <div className="form-group span-2">
                  <label htmlFor="addr-line1">House No. / Flat / Building *</label>
                  <input
                    id="addr-line1"
                    type="text"
                    required
                    placeholder="e.g., Flat 402, Sunshine Apartments"
                    value={formData.addressLine1}
                    onChange={(e) => setFormData({ ...formData, addressLine1: e.target.value })}
                  />
                </div>
                <div className="form-group span-2">
                  <label htmlFor="addr-line2">Street / Area / Locality</label>
                  <input
                    id="addr-line2"
                    type="text"
                    placeholder="e.g., 5th Cross, Indiranagar"
                    value={formData.addressLine2}
                    onChange={(e) => setFormData({ ...formData, addressLine2: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="addr-landmark">Landmark (Optional)</label>
                  <input
                    id="addr-landmark"
                    type="text"
                    placeholder="e.g., Opposite Metro Station"
                    value={formData.landmark}
                    onChange={(e) => setFormData({ ...formData, landmark: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="addr-city">City *</label>
                  <input
                    id="addr-city"
                    type="text"
                    required
                    placeholder="e.g., Bengaluru"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="addr-state">State / UT *</label>
                  <select
                    id="addr-state"
                    required
                    value={formData.state}
                    onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                  >
                    <option value="">Select State / UT</option>
                    {INDIAN_STATES.map((st) => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="addr-postalCode">PIN Code *</label>
                  <input
                    id="addr-postalCode"
                    type="text"
                    required
                    pattern="\d{6}"
                    placeholder="6-digit PIN"
                    value={formData.postalCode}
                    onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-checkbox-group">
                <label className="checkbox-label" htmlFor="addr-isDefault">
                  <input
                    id="addr-isDefault"
                    type="checkbox"
                    checked={formData.isDefault}
                    onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                  />
                  <span>Set as default delivery address</span>
                </label>
              </div>

              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : (editingId ? 'Update Address' : 'Save Address')}
                </button>
                <button type="button" className="btn btn-secondary" onClick={resetForm}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div className="loading-state">Loading your saved addresses...</div>
        ) : addresses.length === 0 ? (
          <div className="empty-address-state">
            <div className="empty-icon">📍</div>
            <h3>No addresses saved yet</h3>
            <p>Save your delivery locations to place orders seamlessly with one click.</p>
            {!showForm && (
              <button className="btn btn-primary" onClick={handleOpenAdd}>
                Add Your First Address
              </button>
            )}
          </div>
        ) : (
          <div className="addresses-grid">
            {addresses.map((addr) => (
              <div key={addr._id} className={`address-card ${addr.isDefault ? 'is-default' : ''}`}>
                <div className="address-card-top">
                  <div className="address-recipient">
                    <h3>{addr.fullName}</h3>
                    {addr.isDefault && <span className="badge-default">Default</span>}
                  </div>
                  <div className="address-actions-menu">
                    <button
                      className="btn-link edit-link"
                      onClick={() => handleEdit(addr)}
                      title="Edit address"
                      aria-label={`Edit address for ${addr.fullName}`}
                    >
                      Edit
                    </button>
                    <button
                      className="btn-link delete-link"
                      onClick={() => handleDelete(addr._id)}
                      title="Delete address"
                      aria-label={`Delete address for ${addr.fullName}`}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="address-body">
                  <p className="address-line">
                    {addr.addressLine1}
                    {addr.addressLine2 && `, ${addr.addressLine2}`}
                  </p>
                  {addr.landmark && (
                    <p className="address-landmark">Landmark: {addr.landmark}</p>
                  )}
                  <p className="address-city-state">
                    {addr.city}, {addr.state} - <strong>{addr.postalCode}</strong>
                  </p>
                  <p className="address-phone">
                    <span>Phone:</span> {addr.phone}
                  </p>
                </div>

                {!addr.isDefault && (
                  <div className="address-card-footer">
                    <button
                      className="btn-make-default"
                      onClick={() => handleSetDefault(addr._id)}
                      aria-label={`Set address for ${addr.fullName} as default`}
                    >
                      Set as Default
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AddressBook;

