# 🚀 Clovia Backend - Node.js + Express + MariaDB

A robust backend API for the Clovia application with user authentication, product management, and advanced search functionality.

## 🛠️ Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MariaDB/MySQL
- **Authentication**: JWT + bcrypt
- **Validation**: express-validator
- **Security**: Helmet, CORS
- **Environment**: dotenv

## 📋 Prerequisites

- Node.js (v16 or higher)
- MariaDB/MySQL server
- npm or yarn package manager

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Database Setup

Create a MariaDB/MySQL database named `clovia`:

```sql
CREATE DATABASE clovia;
```

### 3. Environment Configuration

Copy the environment file and update it with your database credentials:

```bash
cp env.backend .env
```

Edit `.env` with your database settings:

```env
# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password_here
DB_NAME=clovia

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=24h

# Server Configuration
PORT=4000
NODE_ENV=development
```

### 4. Start the Server

**Development mode (with auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

The server will automatically:
- Test database connection
- Create necessary tables
- Insert sample data
- Start the Express server

## 📊 API Endpoints

### Authentication

#### POST `/api/auth/register`
Register a new user account.

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "user": {
      "id": 1,
      "name": "John Doe",
      "email": "john@example.com",
      "created_at": "2024-01-15T10:30:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

#### POST `/api/auth/login`
Authenticate user and get JWT token.

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": 1,
      "name": "John Doe",
      "email": "john@example.com",
      "created_at": "2024-01-15T10:30:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

#### GET `/api/auth/verify`
Verify JWT token and get user data.

**Headers:**
```
Authorization: Bearer <your-jwt-token>
```

### Products

#### GET `/api/products/search`
Search products with advanced filters.

**Query Parameters:**
- `keyword` - Search in product names
- `min_price` - Minimum price filter
- `max_price` - Maximum price filter
- `premium` - Filter by premium status (true/false)
- `status` - Filter by availability (Available/Sold/Pending)
- `page` - Page number for pagination
- `limit` - Products per page

**Example:**
```
GET /api/products/search?keyword=uniform&min_price=50&max_price=200&premium=false&status=Available
```

**Response:**
```json
{
  "success": true,
  "data": {
    "products": [
      {
        "id": 1,
        "name": "Uniform",
        "price": 75.00,
        "category": "Clothing",
        "status": "Available",
        "is_premium": false,
        "description": "Professional work uniform",
        "seller_name": "Test User"
      }
    ],
    "pagination": {
      "current_page": 1,
      "total_pages": 1,
      "total_products": 1,
      "products_per_page": 12
    }
  }
}
```

#### GET `/api/products`
Get all products.

#### GET `/api/products/:id`
Get a specific product by ID.

#### POST `/api/products`
Create a new product.

#### PUT `/api/products/:id`
Update an existing product.

#### DELETE `/api/products/:id`
Delete a product.

### Users

#### GET `/api/users/profile`
Get current user profile.

#### GET `/api/users`
Get all users (admin only).

#### GET `/api/users/:id`
Get user by ID.

#### PUT `/api/users/:id`
Update user profile.

## 🔍 Search Functionality

The product search endpoint supports:

- **Text Search**: Case-insensitive search in product names
- **Price Range**: Filter by minimum and maximum price
- **Premium Filter**: Show only standard or premium products
- **Status Filter**: Filter by availability status
- **Pagination**: Configurable page size and navigation

### Search Examples

**Find standard uniforms under $100:**
```
GET /api/products/search?keyword=uniform&max_price=100&premium=false&status=Available
```

**Find premium products:**
```
GET /api/products/search?premium=true&status=Available
```

**Find products in specific price range:**
```
GET /api/products/search?min_price=50&max_price=200&status=Available
```

## 🗄️ Database Schema

### Users Table
```sql
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### Products Table
```sql
CREATE TABLE products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  category VARCHAR(100),
  status ENUM('Available', 'Sold', 'Pending') DEFAULT 'Available',
  is_premium BOOLEAN DEFAULT FALSE,
  seller_id INT,
  description TEXT,
  image_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE SET NULL
);
```

## 🔐 Security Features

- **Password Hashing**: bcrypt with 12 salt rounds
- **JWT Authentication**: Secure token-based authentication
- **Input Validation**: Comprehensive request validation
- **SQL Injection Protection**: Parameterized queries
- **CORS Protection**: Configurable cross-origin requests
- **Helmet Security**: HTTP security headers

## 🧪 Testing the API

### 1. Health Check
```bash
curl http://localhost:4000/api/health
```

### 2. Register a User
```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "password123"
  }'
```

### 3. Login
```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

### 4. Search Products
```bash
curl "http://localhost:4000/api/products/search?keyword=uniform&premium=false&status=Available"
```

## 🐛 Troubleshooting

### Database Connection Issues
- Verify MariaDB/MySQL is running
- Check database credentials in `.env`
- Ensure database `clovia` exists
- Check firewall settings

### JWT Issues
- Verify `JWT_SECRET` is set in `.env`
- Check token expiration settings
- Ensure proper Authorization header format

### Search Not Working
- Verify database has sample data
- Check query parameters format
- Review server logs for errors

## 📝 Sample Data

The backend automatically creates sample data:

**Sample User:**
- Email: `test@example.com`
- Password: `password123`

**Sample Products:**
- Uniform (Clothing, $75, Standard)
- Premium Jacket (Clothing, $150, Premium)
- Standard Shirt (Clothing, $45, Standard)
- Work Boots (Footwear, $120, Standard)
- Designer Bag (Accessories, $200, Premium)

## 🚀 Deployment

### Production Considerations
- Change `JWT_SECRET` to a strong, unique value
- Set `NODE_ENV=production`
- Use environment-specific database credentials
- Enable HTTPS
- Set up proper logging
- Configure reverse proxy (nginx/Apache)

### Environment Variables
```env
NODE_ENV=production
JWT_SECRET=your-production-secret-key
DB_HOST=your-production-db-host
DB_PASSWORD=your-production-db-password
```

## 📚 Additional Resources

- [Express.js Documentation](https://expressjs.com/)
- [MariaDB Documentation](https://mariadb.org/docs/)
- [JWT.io](https://jwt.io/)
- [bcrypt Documentation](https://github.com/dcodeIO/bcrypt.js/)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.
