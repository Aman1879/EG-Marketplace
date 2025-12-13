import { useEffect } from 'react';
import { useSocket } from '../hooks/useSocket';
import './Notification.css';

const Notification = () => {
  const { notifications, removeNotification } = useSocket();

  useEffect(() => {
    const timers = notifications.map(notification => {
      return setTimeout(() => {
        removeNotification(notification.id);
      }, 5000);
    });

    return () => {
      timers.forEach(timer => clearTimeout(timer));
    };
  }, [notifications, removeNotification]);

  if (notifications.length === 0) return null;

  return (
    <div className="notifications-container">
      {notifications.map(notification => (
        <div
          key={notification.id}
          className={`notification ${notification.type === 'newOrder' || notification.type === 'newDispute' ? 'success' : 'info'}`}
        >
          <p>{notification.message}</p>
          <button
            onClick={() => removeNotification(notification.id)}
            className="notification-close"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};

export default Notification;

