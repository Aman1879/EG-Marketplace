// API Configuration
// Use environment variables in production, fallback to localhost for development
const API_BASE_URL = 'https://eg-marketplace-1.onrender.com';
const SOCKET_URL = 'https://eg-marketplace-1.onrender.com';
export const API_ENDPOINTS = {
  AUTH: `${API_BASE_URL}/api/auth`,
  PRODUCTS: `${API_BASE_URL}/api/products`,
  ORDERS: `${API_BASE_URL}/api/orders`,
  RATINGS: `${API_BASE_URL}/api/ratings`,
  DISPUTES: `${API_BASE_URL}/api/disputes`,
  ADMIN: `${API_BASE_URL}/api/admin`,
  VENDORS: `${API_BASE_URL}/api/vendors`,
  CART: `${API_BASE_URL}/api/cart`,
  CONTACT: `${API_BASE_URL}/api/contact`,
};

export { API_BASE_URL, SOCKET_URL };

