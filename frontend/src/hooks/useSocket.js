import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { SOCKET_URL } from '../config/api';

export const useSocket = () => {
  const { user } = useAuth();
  const [socket, setSocket] = useState(null);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    if (user) {
      const newSocket = io(SOCKET_URL, {
        withCredentials: true
      });

      newSocket.on('connect', () => {
        console.log('Connected to server');
      });

      // Listen for new orders (vendors)
      newSocket.on('newOrder', (data) => {
        if (user.role === 'vendor') {
          const orderId = typeof data.orderId === 'string' ? data.orderId : data.orderId.toString();
          setNotifications(prev => [...prev, {
            id: Date.now() + Math.random(),
            type: 'newOrder',
            message: `New order received! Order ID: ${orderId.slice(-8)}`,
            data
          }]);
        }
      });

      // Listen for order status updates (buyers)
      newSocket.on('orderUpdate', (data) => {
        if (user.role === 'buyer') {
          setNotifications(prev => [...prev, {
            id: Date.now() + Math.random(),
            type: 'orderUpdate',
            message: `Your order status has been updated to: ${data.status}`,
            data
          }]);
        }
      });

      // Listen for dispute notifications
      newSocket.on('newDispute', (data) => {
        if (user.role === 'vendor' || user.role === 'admin') {
          setNotifications(prev => [...prev, {
            id: Date.now() + Math.random(),
            type: 'newDispute',
            message: 'A new dispute has been opened',
            data
          }]);
        }
      });

      newSocket.on('disputeUpdate', (data) => {
        setNotifications(prev => [...prev, {
          id: Date.now() + Math.random(),
          type: 'disputeUpdate',
          message: 'A dispute has been resolved',
          data
        }]);
      });

      setSocket(newSocket);

      return () => {
        newSocket.close();
      };
    }
  }, [user]);

  const removeNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  return { socket, notifications, removeNotification };
};

