import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../config/api';
import './VendorEarnings.css';

const VendorEarnings = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [shops, setShops] = useState([]);
  const [activeShopId, setActiveShopId] = useState('');
  const [payoutSettings, setPayoutSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showBankForm, setShowBankForm] = useState(false);
  const [bankForm, setBankForm] = useState({
    upiId: '',
    accountHolderName: '',
    accountNumber: '',
    ifscCode: '',
    bankName: '',
    beneficiaryName: ''
  });
  const [submitLoading, setSubmitLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchShops();
  }, []);

  useEffect(() => {
    if (activeShopId) {
      fetchPayoutSettings(activeShopId);
    }
  }, [activeShopId]);

  const fetchShops = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/vendors/my-shops`);
      setShops(res.data || []);
      if (res.data?.length > 0) {
        setActiveShopId(res.data[0]._id);
      } else {
        setLoading(false);
        navigate('/vendor/onboarding');
      }
    } catch (error) {
      console.error('Error fetching shops:', error);
      setLoading(false);
    }
  };

  const fetchPayoutSettings = async (shopId) => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE_URL}/api/vendors/${shopId}/payout-settings`);
      setPayoutSettings(res.data);
      setBankForm({
        upiId: res.data.upiId || '',
        accountHolderName: res.data.payoutDetails?.accountHolderName || '',
        accountNumber: '',
        ifscCode: res.data.payoutDetails?.ifscCode || '',
        bankName: res.data.payoutDetails?.bankName || '',
        beneficiaryName: res.data.payoutDetails?.beneficiaryName || ''
      });
    } catch (error) {
      console.error('Error fetching payout settings:', error);
      setMessage('Failed to load payout settings');
    } finally {
      setLoading(false);
    }
  };

  const handleBankFormChange = (e) => {
    const { name, value } = e.target;
    setBankForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmitBankDetails = async (e) => {
    e.preventDefault();
    setSubmitLoading(true);
    setMessage('');

    try {
      const payload = {
        upiId: bankForm.upiId.trim(),
        accountHolderName: bankForm.accountHolderName.trim(),
        accountNumber: bankForm.accountNumber.trim(),
        ifscCode: bankForm.ifscCode.trim().toUpperCase(),
        bankName: bankForm.bankName.trim(),
        beneficiaryName: bankForm.beneficiaryName.trim(),
        autoCreateLinkedAccount: true
      };

      await axios.put(
        `${API_BASE_URL}/api/vendors/${activeShopId}/payout-settings`,
        payload
      );

      setMessage('Payout settings updated successfully! Your Razorpay linked account is being created.');
      setShowBankForm(false);
      await fetchPayoutSettings(activeShopId);
    } catch (error) {
      const errorMsg = error.response?.data?.error || error.response?.data?.message || 'Failed to update payout settings';
      setMessage(errorMsg);
    } finally {
      setSubmitLoading(false);
    }
  };

  if (loading) {
    return <div className="spinner"></div>;
  }

  if (!payoutSettings) {
    return (
      <div className="vendor-earnings">
        <div className="container">
          <h1>Earnings & Payouts</h1>
          <p>No shop selected or settings not found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="vendor-earnings">
      <div className="container">
        <div className="dashboard-top">
          <h1 className="page-title">Earnings & Payouts</h1>
          <select
            value={activeShopId}
            onChange={(e) => setActiveShopId(e.target.value)}
            className="shop-selector"
          >
            {shops.map(shop => (
              <option key={shop._id} value={shop._id}>{shop.shopName}</option>
            ))}
          </select>
        </div>

        {message && (
          <div className={message.includes('successfully') ? 'success-box' : 'error-box'}>
            {message}
          </div>
        )}

        <div className="earnings-overview">
          <div className="earning-card">
            <h3>Total Earnings</h3>
            <p className="amount">₹{(payoutSettings.totalEarnings || 0).toFixed(2)}</p>
            <p className="label">From {payoutSettings.paidOrdersCount || 0} paid orders</p>
          </div>
          <div className="earning-card">
            <h3>Paid Out</h3>
            <p className="amount">₹{(payoutSettings.totalPaidEarnings || 0).toFixed(2)}</p>
            <p className="label">Total transferred to your account</p>
          </div>
          <div className="earning-card">
            <h3>Pending</h3>
            <p className="amount">₹{((payoutSettings.totalEarnings || 0) - (payoutSettings.totalPaidEarnings || 0)).toFixed(2)}</p>
            <p className="label">Awaiting transfer or payment verification</p>
          </div>
          <div className="earning-card">
            <h3>Total Order Volume</h3>
            <p className="amount">₹{(payoutSettings.totalOrderVolume || 0).toFixed(2)}</p>
            <p className="label">Including platform commission</p>
          </div>
        </div>

        <div className="payout-settings-section">
          <div className="section-header">
            <h2>Payout Settings</h2>
            {payoutSettings.razorpayAccountStatus === 'activated' ? (
              <span className="badge badge-success">Activated</span>
            ) : payoutSettings.razorpayAccountStatus === 'created' ? (
              <span className="badge badge-warning">Pending Activation</span>
            ) : (
              <span className="badge badge-danger">Not Configured</span>
            )}
          </div>

          {payoutSettings.razorpayAccountId ? (
            <div className="payout-info">
              <div className="info-box">
                <h3>Razorpay Account Status</h3>
                <p><strong>Account ID:</strong> {payoutSettings.razorpayAccountId}</p>
                <p><strong>Status:</strong> {payoutSettings.razorpayAccountStatus}</p>
                <p><strong>KYC Status:</strong> {payoutSettings.kycStatus}</p>
              </div>

              {payoutSettings.upiId && (
                <div className="info-box">
                  <h3>UPI ID</h3>
                  <p>{payoutSettings.upiId}</p>
                </div>
              )}

              {payoutSettings.payoutDetails && (
                <div className="info-box">
                  <h3>Bank Account Details</h3>
                  {payoutSettings.payoutDetails.bankName && (
                    <p><strong>Bank:</strong> {payoutSettings.payoutDetails.bankName}</p>
                  )}
                  {payoutSettings.payoutDetails.accountHolderName && (
                    <p><strong>Account Holder:</strong> {payoutSettings.payoutDetails.accountHolderName}</p>
                  )}
                  {payoutSettings.payoutDetails.accountNumberLast4 && (
                    <p><strong>Account (Last 4):</strong> {'*'.repeat(10)}{payoutSettings.payoutDetails.accountNumberLast4}</p>
                  )}
                  {payoutSettings.payoutDetails.ifscCode && (
                    <p><strong>IFSC Code:</strong> {payoutSettings.payoutDetails.ifscCode}</p>
                  )}
                </div>
              )}

              <button
                className="btn btn-secondary"
                onClick={() => setShowBankForm(true)}
              >
                Update Payout Details
              </button>
            </div>
          ) : (
            <div className="no-payout-setup">
              <p>You haven't set up payout details yet. Add your bank account or UPI ID to start receiving payments.</p>
              <button
                className="btn btn-primary btn-large"
                onClick={() => setShowBankForm(true)}
              >
                Set Up Payouts
              </button>
            </div>
          )}
        </div>

        {showBankForm && (
          <div className="modal-overlay" onClick={() => setShowBankForm(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Payout Details</h2>
                <button
                  className="close-btn"
                  onClick={() => setShowBankForm(false)}
                >
                  ×
                </button>
              </div>

              <form onSubmit={handleSubmitBankDetails} className="bank-form">
                <div className="form-group">
                  <label>UPI ID (Optional)</label>
                  <input
                    type="text"
                    name="upiId"
                    value={bankForm.upiId}
                    onChange={handleBankFormChange}
                    placeholder="e.g., yourname@upi"
                  />
                  <p className="form-hint">UPI ID for instant transfers</p>
                </div>

                <hr />

                <div className="form-group">
                  <label>Account Holder Name *</label>
                  <input
                    type="text"
                    name="accountHolderName"
                    value={bankForm.accountHolderName}
                    onChange={handleBankFormChange}
                    required
                    placeholder="Your full name"
                  />
                </div>

                <div className="form-group">
                  <label>Account Number *</label>
                  <input
                    type="text"
                    name="accountNumber"
                    value={bankForm.accountNumber}
                    onChange={handleBankFormChange}
                    required
                    placeholder="Bank account number"
                    inputMode="numeric"
                  />
                  <p className="form-hint">Your account will not be stored; only IFSC + account holder name is kept</p>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>IFSC Code *</label>
                    <input
                      type="text"
                      name="ifscCode"
                      value={bankForm.ifscCode}
                      onChange={handleBankFormChange}
                      required
                      placeholder="e.g., SBIN0001234"
                      style={{ textTransform: 'uppercase' }}
                    />
                  </div>

                  <div className="form-group">
                    <label>Bank Name *</label>
                    <input
                      type="text"
                      name="bankName"
                      value={bankForm.bankName}
                      onChange={handleBankFormChange}
                      required
                      placeholder="e.g., State Bank of India"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Beneficiary Name *</label>
                  <input
                    type="text"
                    name="beneficiaryName"
                    value={bankForm.beneficiaryName}
                    onChange={handleBankFormChange}
                    required
                    placeholder="Account beneficiary name"
                  />
                </div>

                <div className="form-actions">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={submitLoading}
                  >
                    {submitLoading ? 'Saving...' : 'Save & Create Razorpay Account'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowBankForm(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div className="information-section">
          <h2>How Payouts Work</h2>
          <div className="info-card">
            <h3>Payment Flow</h3>
            <ol>
              <li>Customer places an order and pays via Razorpay</li>
              <li>Payment is verified and your earnings are calculated (minus 10% platform commission)</li>
              <li>Your share is automatically transferred to your linked Razorpay account</li>
              <li>From Razorpay, you can withdraw to your bank account or UPI</li>
            </ol>
          </div>
          <div className="info-card">
            <h3>Platform Commission</h3>
            <p>The marketplace charges a 10% commission on all orders. Your earning = Order amount × 90%.</p>
          </div>
          <div className="info-card">
            <h3>Security</h3>
            <p>- Only the last 4 digits of your account number are stored</p>
            <p>- Full account details are never logged in our database</p>
            <p>- Razorpay Route handles all payouts securely</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VendorEarnings;
