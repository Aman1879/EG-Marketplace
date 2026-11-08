// API Configuration
// Use environment variables in production, fallback to localhost for development

const rawApiUrl =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? 'http://localhost:3000' : 'https://eg-marketplace-1.onrender.com');

// Normalize API base URL: strip trailing slashes and trailing /api so endpoints with `/api/...` never double-prefix
const API_BASE_URL = rawApiUrl.replace(/\/+$/, '').replace(/\/api$/, '');

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || API_BASE_URL;

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

