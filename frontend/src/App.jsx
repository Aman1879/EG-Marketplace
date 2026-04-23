import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AuthProvider } from './context/AuthContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Notification from './components/Notification';
import AnimatedPage from './components/AnimatedPage';
import Home from './pages/Home';
import Products from './pages/Products';
import ProductDetail from './pages/ProductDetail';
import Cart from './pages/Cart';
import Checkout from './pages/Checkout';
import Login from './pages/Login';
import Register from './pages/Register';
import OrderHistory from './pages/OrderHistory';
import VendorDashboard from './pages/VendorDashboard';
import VendorEarnings from './pages/VendorEarnings';
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
  const easeOut = [0.22, 1, 0.36, 1];

  return (
    <div className="App">
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: easeOut }}
      >
        <Navbar />
      </motion.div>
      <Notification />
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<AnimatedPage><Home /></AnimatedPage>} />
          <Route path="/buyer/dashboard" element={<AnimatedPage><Home /></AnimatedPage>} />
          <Route path="/products" element={<AnimatedPage><Products /></AnimatedPage>} />
          <Route path="/products/:id" element={<AnimatedPage><ProductDetail /></AnimatedPage>} />
          <Route path="/cart" element={<AnimatedPage><Cart /></AnimatedPage>} />
          <Route path="/login" element={<AnimatedPage><Login /></AnimatedPage>} />
          <Route path="/register" element={<AnimatedPage><Register /></AnimatedPage>} />
          <Route
            path="/checkout"
            element={
              <ProtectedRoute>
                <AnimatedPage><Checkout /></AnimatedPage>
              </ProtectedRoute>
            }
          />
          <Route
            path="/orders"
            element={
              <ProtectedRoute allowedRoles={['buyer']}>
                <AnimatedPage><OrderHistory /></AnimatedPage>
              </ProtectedRoute>
            }
          />
          <Route
            path="/vendor/dashboard"
            element={
              <ProtectedRoute allowedRoles={['vendor']}>
                <AnimatedPage><VendorDashboard /></AnimatedPage>
              </ProtectedRoute>
            }
          />
          <Route
            path="/vendor/earnings"
            element={
              <ProtectedRoute allowedRoles={['vendor']}>
                <AnimatedPage><VendorEarnings /></AnimatedPage>
              </ProtectedRoute>
            }
          />
          <Route
            path="/vendor/onboarding"
            element={
              <ProtectedRoute allowedRoles={['vendor']}>
                <AnimatedPage><VendorOnboarding /></AnimatedPage>
              </ProtectedRoute>
            }
          />
          <Route
            path="/vendor/create-shop"
            element={
              <ProtectedRoute allowedRoles={['vendor']}>
                <AnimatedPage><VendorCreateShop /></AnimatedPage>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/dashboard"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AnimatedPage><AdminDashboard /></AnimatedPage>
              </ProtectedRoute>
            }
          />
          <Route
            path="/disputes"
            element={
              <ProtectedRoute>
                <AnimatedPage><DisputeCenter /></AnimatedPage>
              </ProtectedRoute>
            }
          />
          <Route path="/shops/:id" element={<AnimatedPage><ShopPage /></AnimatedPage>} />
          <Route path="/contact" element={<AnimatedPage><ContactUs /></AnimatedPage>} />
          <Route path="/our-story" element={<AnimatedPage><OurStory /></AnimatedPage>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AnimatePresence>
      {!isAdminPage && (
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, ease: easeOut, delay: 0.1 }}
        >
          <Footer />
        </motion.div>
      )}
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppContent />
      </Router>
    </AuthProvider>
  );
}

export default App;

