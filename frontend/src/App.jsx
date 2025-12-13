import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Notification from './components/Notification';
import Home from './pages/Home';
import Products from './pages/Products';
import ProductDetail from './pages/ProductDetail';
import Cart from './pages/Cart';
import Checkout from './pages/Checkout';
import Login from './pages/Login';
import Register from './pages/Register';
import OrderHistory from './pages/OrderHistory';
import VendorDashboard from './pages/VendorDashboard';
import AdminDashboard from './pages/AdminDashboard';
import DisputeCenter from './pages/DisputeCenter';
import VendorOnboarding from './pages/VendorOnboarding';
import VendorCreateShop from './pages/VendorCreateShop';
import ShopPage from './pages/ShopPage';
import ContactUs from './pages/ContactUs';
import OurStory from './pages/OurStory';
import ProtectedRoute from './components/ProtectedRoute';
import './App.css';

function AppContent() {
  const location = useLocation();
  const isAdminPage = location.pathname.startsWith('/admin');

  return (
    <div className="App">
      <Navbar />
      <Notification />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/buyer/dashboard" element={<Home />} />
        <Route path="/products" element={<Products />} />
        <Route path="/products/:id" element={<ProductDetail />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/checkout"
          element={
            <ProtectedRoute>
              <Checkout />
            </ProtectedRoute>
          }
        />
        <Route
          path="/orders"
          element={
            <ProtectedRoute allowedRoles={['buyer']}>
              <OrderHistory />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vendor/dashboard"
          element={
            <ProtectedRoute allowedRoles={['vendor']}>
              <VendorDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vendor/onboarding"
          element={
            <ProtectedRoute allowedRoles={['vendor']}>
              <VendorOnboarding />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vendor/create-shop"
          element={
            <ProtectedRoute allowedRoles={['vendor']}>
              <VendorCreateShop />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/dashboard"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/disputes"
          element={
            <ProtectedRoute>
              <DisputeCenter />
            </ProtectedRoute>
          }
        />
        <Route path="/shops/:id" element={<ShopPage />} />
        <Route path="/contact" element={<ContactUs />} />
        <Route path="/our-story" element={<OurStory />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!isAdminPage && <Footer />}
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppContent />
      </Router>
    </AuthProvider>
  );
}

export default App;

