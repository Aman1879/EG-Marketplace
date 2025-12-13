import { createContext, useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { API_ENDPOINTS } from '../config/api';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState([]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      fetchUser();
    } else {
      setLoading(false);
    }
  }, []);

  const fetchUser = async () => {
    try {
      const response = await axios.get(`${API_ENDPOINTS.AUTH}/me`);
      const mergedUser = {
        ...response.data.user,
        vendorProfile: response.data.vendorProfile || null
      };
      setUser(mergedUser);
      await fetchCart();
    } catch (error) {
      localStorage.removeItem('token');
      delete axios.defaults.headers.common['Authorization'];
    } finally {
      setLoading(false);
    }
  };

  const fetchCart = async () => {
    try {
      const res = await axios.get(API_ENDPOINTS.CART);
      setCart(res.data || []);
    } catch (error) {
      // If unauthorized or other error, fallback to empty cart
      if (error.response?.status === 401) {
        setCart([]);
      }
    }
  };

  const login = async (email, password) => {
    try {
      const response = await axios.post(`${API_ENDPOINTS.AUTH}/login`, {
        email,
        password
      });
      localStorage.setItem('token', response.data.token);
      axios.defaults.headers.common['Authorization'] = `Bearer ${response.data.token}`;
      const mergedUser = {
        ...response.data.user,
        vendorProfile: response.data.vendorProfile || null
      };
      setUser(mergedUser);
      await fetchCart();
      return { success: true, user: mergedUser };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Login failed'
      };
    }
  };

  const register = async (userData) => {
    try {
      const response = await axios.post(`${API_ENDPOINTS.AUTH}/register`, userData);
      // Do not auto-login after register; require explicit login
      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Registration failed'
      };
    }
  };

  const logout = async () => {
    try {
      await axios.post(`${API_ENDPOINTS.AUTH}/logout`);
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      localStorage.removeItem('token');
      delete axios.defaults.headers.common['Authorization'];
      setUser(null);
      setCart([]);
    }
  };

  const addToCart = async (product, quantity = 1) => {
    const productId = typeof product === 'string' ? product : product?._id;
    if (!productId) return { success: false, message: 'Invalid product' };
    try {
      await axios.post(`${API_ENDPOINTS.CART}/add`, { productId, quantity });
      await fetchCart();
      return { success: true };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || 'Could not add to cart' };
    }
  };

  const removeFromCart = async (productId) => {
    try {
      await axios.delete(`${API_ENDPOINTS.CART}/remove/${productId}`);
      await fetchCart();
    } catch (error) {
      console.error('Remove cart item error:', error);
    }
  };

  const updateCartQuantity = async (productId, quantity) => {
    try {
      await axios.put(`${API_ENDPOINTS.CART}/update`, { productId, quantity });
      await fetchCart();
    } catch (error) {
      console.error('Update cart error:', error);
    }
  };

  const clearCart = async () => {
    try {
      await axios.delete(`${API_ENDPOINTS.CART}/clear`);
    } catch (error) {
      // ignore
    } finally {
      setCart([]);
    }
  };

  const value = {
    user,
    loading,
    login,
    register,
    logout,
    cart,
    addToCart,
    removeFromCart,
    updateCartQuantity,
    clearCart
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

