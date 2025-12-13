// API Configuration
// Use environment variables in production, fallback to localhost for development
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

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

