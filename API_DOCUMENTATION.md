# API Documentation

## Base URL
```
http://localhost:3000/api
```

## Authentication

All protected routes require a JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

---

## Auth Endpoints

### Register User
```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "string (min 3 chars)",
  "email": "string (valid email)",
  "password": "string (min 6 chars)",
  "role": "buyer | vendor | admin",
  "shopName": "string (required if role is vendor)"
}
```

**Response:**
```json
{
  "message": "User registered successfully",
  "token": "jwt_token",
  "user": {
    "id": "user_id",
    "username": "string",
    "email": "string",
    "role": "string"
  }
}
```

### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "string",
  "password": "string"
}
```

**Response:**
```json
{
  "message": "Login successful",
  "token": "jwt_token",
  "user": {
    "id": "user_id",
    "username": "string",
    "email": "string",
    "role": "string"
  }
}
```

### Get Current User
```http
GET /api/auth/me
Authorization: Bearer <token>
```

**Response:**
```json
{
  "user": {
    "id": "user_id",
    "username": "string",
    "email": "string",
    "role": "string"
  },
  "vendorProfile": {
    "shopName": "string",
    "totalEarnings": 0
  }
}
```

### Logout
```http
POST /api/auth/logout
Authorization: Bearer <token>
```

---

## Product Endpoints

### Get All Products
```http
GET /api/products
```

**Response:**
```json
[
  {
    "_id": "product_id",
    "title": "string",
    "description": "string",
    "price": 0,
    "imageUrl": "string",
    "averageRating": 0,
    "totalRatings": 0,
    "vendorId": {
      "_id": "vendor_id",
      "shopName": "string"
    }
  }
]
```

### Get Single Product
```http
GET /api/products/:id
```

### Create Product (Vendor Only)
```http
POST /api/products
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "string",
  "description": "string",
  "price": 0,
  "imageUrl": "string (valid URL)",
  "stock": 1,
  "category": "string (optional)"
}
```

### Update Product (Vendor Only)
```http
PUT /api/products/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "string",
  "description": "string",
  "price": 0,
  "imageUrl": "string",
  "stock": 1
}
```

### Delete Product (Vendor Only)
```http
DELETE /api/products/:id
Authorization: Bearer <token>
```

### Get Vendor's Products
```http
GET /api/products/vendor/my-products
Authorization: Bearer <token>
```

---

## Order Endpoints

### Create Order (Buyer Only)
```http
POST /api/orders
Authorization: Bearer <token>
Content-Type: application/json

{
  "products": [
    {
      "productId": "product_id",
      "quantity": 1
    }
  ],
  "shippingAddress": "string"
}
```

**Response:**
```json
{
  "_id": "order_id",
  "buyerId": "user_id",
  "vendorId": "vendor_id",
  "products": [...],
  "totalAmount": 0,
  "vendorEarning": 0,
  "adminCommission": 0,
  "status": "Pending",
  "shippingAddress": "string"
}
```

### Get Buyer's Orders
```http
GET /api/orders/buyer/my-orders
Authorization: Bearer <token>
```

### Get Vendor's Orders
```http
GET /api/orders/vendor/my-orders
Authorization: Bearer <token>
```

### Get Single Order
```http
GET /api/orders/:id
Authorization: Bearer <token>
```

### Update Order Status (Vendor Only)
```http
PUT /api/orders/:id/status
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "Pending | Shipped | Delivered | Cancelled"
}
```

---

## Rating Endpoints

### Create Rating (Buyer Only)
```http
POST /api/ratings
Authorization: Bearer <token>
Content-Type: application/json

{
  "productId": "product_id",
  "orderId": "order_id",
  "rating": 1-5,
  "review": "string (optional)"
}
```

### Get Product Ratings
```http
GET /api/ratings/product/:productId
```

**Response:**
```json
[
  {
    "_id": "rating_id",
    "productId": "product_id",
    "buyerId": {
      "_id": "user_id",
      "username": "string"
    },
    "rating": 5,
    "review": "string",
    "createdAt": "date"
  }
]
```

---

## Dispute Endpoints

### Create Dispute (Buyer Only)
```http
POST /api/disputes
Authorization: Bearer <token>
Content-Type: application/json

{
  "orderId": "order_id",
  "title": "string",
  "description": "string"
}
```

### Get Buyer's Disputes
```http
GET /api/disputes/buyer/my-disputes
Authorization: Bearer <token>
```

### Get Vendor's Disputes
```http
GET /api/disputes/vendor/my-disputes
Authorization: Bearer <token>
```

### Get All Disputes (Admin Only)
```http
GET /api/disputes/all
Authorization: Bearer <token>
```

### Vendor Reply to Dispute
```http
PUT /api/disputes/:id/reply
Authorization: Bearer <token>
Content-Type: application/json

{
  "reply": "string"
}
```

### Update Dispute Status (Admin Only)
```http
PUT /api/disputes/:id/status
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "Open | Under Review | Resolved",
  "adminNotes": "string (optional)"
}
```

---

## Admin Endpoints

### Get Dashboard Stats
```http
GET /api/admin/dashboard
Authorization: Bearer <token>
```

**Response:**
```json
{
  "totalUsers": 0,
  "totalVendors": 0,
  "totalProducts": 0,
  "totalOrders": 0,
  "totalCommission": 0,
  "totalRevenue": 0
}
```

### Get All Commissions
```http
GET /api/admin/commissions
Authorization: Bearer <token>
```

**Response:**
```json
{
  "commissions": [...],
  "totalCommission": 0,
  "totalOrders": 0
}
```

### Get Vendor Earnings
```http
GET /api/admin/vendor-earnings
Authorization: Bearer <token>
```

**Response:**
```json
[
  {
    "vendorId": "vendor_id",
    "shopName": "string",
    "totalEarnings": 0,
    "username": "string",
    "email": "string"
  }
]
```

---

## Error Responses

All endpoints may return error responses in the following format:

```json
{
  "message": "Error message",
  "errors": [
    {
      "msg": "Validation error",
      "param": "field_name"
    }
  ]
}
```

**Status Codes:**
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Server Error

---

## WebSocket Events

### Client → Server
- `connect` - Connect to server
- `disconnect` - Disconnect from server

### Server → Client
- `newOrder` - New order notification (for vendors)
- `orderUpdate` - Order status update (for buyers)
- `newDispute` - New dispute notification
- `disputeUpdate` - Dispute status update

**Example:**
```javascript
socket.on('newOrder', (data) => {
  console.log('New order:', data);
  // data: { orderId, vendorId, buyerId, totalAmount }
});
```

