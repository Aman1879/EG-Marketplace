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
  const [cartSummary, setCartSummary] = useState({
    subtotal: 0,
    shipping: 0,
    tax: 0,
    discount: 0,
    total: 0,
    itemCount: 0,
    totalQuantity: 0,
    canCheckout: false
  });

  const computeLocalSummary = (items = []) => {
    let subtotalPaise = 0;
    let totalQty = 0;
    let allInStock = items.length > 0;

    for (const item of items) {
      const unitPrice = item.unitPrice ?? item.price ?? item.priceAtAdd ?? item.product?.price ?? 0;
      const qty = item.quantity || 1;
      subtotalPaise += Math.round(Number(unitPrice) * 100) * qty;
      totalQty += qty;
      if (item.inStock === false || item.isAvailable === false) {
        allInStock = false;
      }
    }

    const subtotal = Number((subtotalPaise / 100).toFixed(2));
    const shipping = 0.00;
    const tax = 0.00;
    const discount = 0.00;
    const total = subtotal;

    return {
      subtotal,
      shipping,
      tax,
      discount,
      total,
      itemCount: items.length,
      totalQuantity: totalQty,
      canCheckout: items.length > 0 && allInStock
    };
  };

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
      const res = await axios.get(`${API_ENDPOINTS.CART}?format=summary`);
      if (res.data && Array.isArray(res.data.items)) {
        setCart(res.data.items);
        setCartSummary({
          subtotal: res.data.subtotal ?? 0,
          shipping: res.data.shipping ?? 0,
          tax: res.data.tax ?? 0,
          discount: res.data.discount ?? 0,
          total: res.data.total ?? 0,
          itemCount: res.data.itemCount ?? res.data.items.length,
          totalQuantity: res.data.totalQuantity ?? 0,
          canCheckout: Boolean(res.data.canCheckout)
        });
      } else if (Array.isArray(res.data)) {
        setCart(res.data);
        setCartSummary(computeLocalSummary(res.data));
      } else {
        setCart([]);
        setCartSummary(computeLocalSummary([]));
      }
    } catch (error) {
      // If unauthorized or other error, fallback to empty cart
      if (error.response?.status === 401) {
        setCart([]);
        setCartSummary(computeLocalSummary([]));
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
      setCartSummary(computeLocalSummary([]));
    }
  };

  const addToCart = async (product, quantity = 1, variantId = null) => {
    const productId = typeof product === 'string' ? product : product?._id;
    if (!productId) return { success: false, message: 'Invalid product' };
    try {
      await axios.post(`${API_ENDPOINTS.CART}/add`, { productId, quantity, variantId });
      await fetchCart();
      return { success: true };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || 'Could not add to cart' };
    }
  };

  const removeFromCart = async (identifier, variantId = null) => {
    try {
      const url = variantId
        ? `${API_ENDPOINTS.CART}/remove/${identifier}?variantId=${encodeURIComponent(variantId)}`
        : `${API_ENDPOINTS.CART}/remove/${identifier}`;
      await axios.delete(url);
      await fetchCart();
      return { success: true };
    } catch (error) {
      console.error('Remove cart item error:', error);
      return { success: false, message: error.response?.data?.message || 'Could not remove item' };
    }
  };

  const updateCartQuantity = async (identifier, quantity, variantId = null) => {
    try {
      const body = { quantity };
      if (variantId) {
        body.productId = identifier;
        body.variantId = variantId;
      } else {
        body.cartItemId = identifier;
        body.productId = identifier;
      }
      await axios.put(`${API_ENDPOINTS.CART}/update`, body);
      await fetchCart();
      return { success: true };
    } catch (error) {
      console.error('Update cart error:', error);
      return { success: false, message: error.response?.data?.message || 'Could not update quantity' };
    }
  };

  const clearCart = async () => {
    try {
      await axios.delete(`${API_ENDPOINTS.CART}/clear`);
    } catch (error) {
      // ignore
    } finally {
      setCart([]);
      setCartSummary(computeLocalSummary([]));
    }
  };

  const value = {
    user,
    loading,
    login,
    register,
    logout,
    cart,
    cartSummary,
    fetchCart,
    addToCart,
    removeFromCart,
    updateCartQuantity,
    clearCart
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

