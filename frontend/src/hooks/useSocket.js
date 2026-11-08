import { useEffect, useState, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { SOCKET_URL } from '../config/api';

export const useSocket = () => {
  const { user } = useAuth();
  const [socket, setSocket] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const socketRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem('token');

    // Only connect if user is authenticated and token is available
    if (user && token) {
      const newSocket = io(SOCKET_URL, {
        auth: { token },
        withCredentials: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        transports: ['websocket', 'polling']
      });

      socketRef.current = newSocket;

      newSocket.on('connect', () => {
        console.log('Socket connected successfully to server');
      });

      newSocket.on('connect_error', (error) => {
        console.warn('Socket connection/authentication error:', error.message);
      });

      // Listen for new orders (authorized vendor shop or admin)
      const handleNewOrder = (data) => {
        if (user.role === 'vendor' || user.role === 'admin') {
          const orderId = typeof data.orderId === 'string' ? data.orderId : String(data.orderId || '');
          setNotifications(prev => [...prev, {
            id: Date.now() + Math.random(),
            type: 'newOrder',
            message: `New order received! Order ID: ${orderId.slice(-8)}`,
            data
          }]);
        }
      };

      // Listen for order status updates (buyer owning order, vendor, or admin)
      const handleOrderUpdate = (data) => {
        setNotifications(prev => [...prev, {
          id: Date.now() + Math.random(),
          type: 'orderUpdate',
          message: `Your order status has been updated to: ${data.status}`,
          data
        }]);
      };

      // Listen for dispute notifications
      const handleNewDispute = (data) => {
        setNotifications(prev => [...prev, {
          id: Date.now() + Math.random(),
          type: 'newDispute',
          message: 'A new dispute has been opened',
          data
        }]);
      };

      // Listen for new vendor request notifications (admin only)
      const handleNewVendorRequest = (data) => {
        if (user.role === 'admin') {
          setNotifications(prev => [...prev, {
            id: Date.now() + Math.random(),
            type: 'newVendorRequest',
            message: `New vendor shop request: ${data.shopName || 'Shop request submitted'}`,
            data
          }]);
        }
      };

      // Listen for vendor approval updates (specific vendor user)
      const handleVendorApprovalUpdate = (data) => {
        setNotifications(prev => [...prev, {
          id: Date.now() + Math.random(),
          type: 'vendorApprovalUpdate',
          message: `Your shop approval status changed to: ${data.approvalStatus}`,
          data
        }]);
      };

      // Listen for dispute resolution updates
      const handleDisputeUpdate = (data) => {
        setNotifications(prev => [...prev, {
          id: Date.now() + Math.random(),
          type: 'disputeUpdate',
          message: 'A dispute has been resolved',
          data
        }]);
      };

      newSocket.on('newOrder', handleNewOrder);
      newSocket.on('orderUpdate', handleOrderUpdate);
      newSocket.on('newDispute', handleNewDispute);
      newSocket.on('newVendorRequest', handleNewVendorRequest);
      newSocket.on('vendorApprovalUpdate', handleVendorApprovalUpdate);
      newSocket.on('disputeUpdate', handleDisputeUpdate);

      setSocket(newSocket);

      return () => {
        newSocket.off('newOrder', handleNewOrder);
        newSocket.off('orderUpdate', handleOrderUpdate);
        newSocket.off('newDispute', handleNewDispute);
        newSocket.off('newVendorRequest', handleNewVendorRequest);
        newSocket.off('vendorApprovalUpdate', handleVendorApprovalUpdate);
        newSocket.off('disputeUpdate', handleDisputeUpdate);
        newSocket.disconnect();
        socketRef.current = null;
        setSocket(null);
      };
    } else {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
      }
    }
  }, [user]);

  const removeNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  return { socket, notifications, removeNotification };
};


