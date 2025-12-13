# Environment Variables

Create a `.env` file in `backend/` with:

```
MONGODB_URI=mongodb://localhost:27017/marketplace
PORT=3000
JWT_SECRET=your-secret-key-here-change-in-production
SESSION_SECRET=your-session-secret-here-change-in-production
```

For MongoDB Atlas, replace with your connection string, e.g.:

```
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/marketplace?retryWrites=true&w=majority
```

**Important:** Change JWT_SECRET and SESSION_SECRET to secure random strings in production!

