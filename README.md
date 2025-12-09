# Clovia - Buy & Trade App

A full-stack buy and trade application built with Go (backend), React + Chakra UI (frontend), and MySQL (database).

## Features

### Backend (Go)
- **RESTful API** with Fiber framework
- **JWT Authentication** with secure password hashing
- **MySQL Database** with proper relationships and indexes
- **CRUD Operations** for users, products, and orders
- **Search & Filtering** with pagination
- **Authorization Middleware** for protected routes
- **Transaction Management** for orders
- **Premium Listings** support

### Frontend (React + Chakra UI)
- **Responsive Design** with mobile-first approach
- **User Authentication** (login/register)
- **Product Management** (add, edit, delete)
- **Product Discovery** with search and filters
- **User Dashboard** with stats and management
- **Order Management** for buyers and sellers
- **Modern UI** with Chakra UI components

### Database Schema
- **Users**: Authentication and profile management
- **Products**: Product listings with seller information
- **Orders**: Purchase orders with status tracking
- **Transactions**: Payment records
- **Premium Listings**: Featured product management

## Tech Stack

- **Backend**: Go 1.24+, Fiber v2, MySQL
- **Frontend**: React 18, TypeScript, Chakra UI v2
- **Database**: MySQL 8.0+
- **Authentication**: JWT with bcrypt
- **API**: RESTful with JSON responses

## Prerequisites

- Go 1.24 or higher
- Node.js 18+ and npm
- MySQL 8.0 or higher
- Git

## Installation & Setup

### 1. Clone the Repository

```bash
git clone <repository-url>
cd clovia
```

### 2. Backend Setup

#### Install Go Dependencies
```bash
go mod tidy
```

#### Database Setup
1. Create a MySQL database:
```sql
CREATE DATABASE clovia;
```

2. Update environment variables (create `.env` file):
```bash
# Copy the example file
cp env.example .env

# Edit .env with your database credentials
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=closevia
PORT=4000
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
```

#### Run the Backend
```bash
# Development mode with hot reload
go run main.go

# Or build and run
go build -o clovia main.go
./clovia
```

The backend will be available at `http://localhost:4000`

### 3. Frontend Setup

#### Install Dependencies
```bash
cd client
npm install
```

#### Start Development Server
```bash
npm run dev
```

The frontend will be available at `http://localhost:5173`

### 4. Database Initialization

The application will automatically create all necessary tables on first run. You can also manually run the SQL script:

```bash
mysql -u root -p clovia < migrations/001_initial_schema.sql
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login

### Users
- `GET /api/users/profile` - Get current user profile (auth required)
- `PUT /api/users/profile` - Update current user profile (auth required)
- `GET /api/users/:id` - Get public user information
- `GET /api/users` - Get all users (admin)

### Products
- `GET /api/products` - Get all products with search/filtering
- `GET /api/products/:id` - Get specific product
- `POST /api/products` - Create new product (auth required)
- `PUT /api/products/:id` - Update product (owner only)
- `DELETE /api/products/:id` - Delete product (owner only)
- `GET /api/products/user/:id` - Get products by specific user

### Orders
- `POST /api/orders` - Create new order (auth required)
- `GET /api/orders` - Get user orders (auth required)
- `GET /api/orders/:id` - Get specific order (auth required)
- `PUT /api/orders/:id/status` - Update order status (seller only)

## Usage

### 1. User Registration & Login
- Visit `/register` to create a new account
- Use `/login` to access your account
- JWT tokens are automatically managed

### 2. Product Management
- **Add Products**: Navigate to `/add-product` (authenticated users only)
- **Edit Products**: Use the edit button on your product cards
- **Delete Products**: Use the delete button (only if no orders exist)

### 3. Shopping
- **Browse Products**: Use the home page with search and filters
- **Product Details**: Click on any product to view full information
- **Purchase**: Click "Buy Now" on available products

### 4. Dashboard
- **My Products**: View and manage your listings
- **My Orders**: Track purchases and sales
- **Profile**: View account information

## Development

### Project Structure
```
clovia/
├── main.go                 # Main application entry point
├── go.mod                  # Go module dependencies
├── env.example            # Environment variables template
├── database/              # Database connection and utilities
├── models/                # Data models and structs
├── handlers/              # HTTP request handlers
├── middleware/            # Authentication and authorization
├── utils/                 # Utility functions
├── migrations/            # Database schema files
├── client/                # React frontend
│   ├── src/
│   │   ├── components/    # Reusable UI components
│   │   ├── pages/         # Page components
│   │   ├── contexts/      # React contexts
│   │   ├── services/      # API services
│   │   ├── types/         # TypeScript type definitions
│   │   └── theme.ts       # Chakra UI theme
│   ├── package.json       # Frontend dependencies
│   └── vite.config.ts     # Vite configuration
└── README.md              # This file
```

### Adding New Features

#### Backend
1. Add new models in `models/`
2. Create handlers in `handlers/`
3. Add routes in `main.go`
4. Update database schema if needed

#### Frontend
1. Create new components in `client/src/components/`
2. Add new pages in `client/src/pages/`
3. Update routing in `App.tsx`
4. Add new types in `client/src/types/`

### Testing
```bash
# Backend tests
go test ./...

# Frontend tests
cd client
npm test
```

## Deployment

### Backend Deployment
1. Build the binary: `go build -o clovia main.go`
2. Set production environment variables
3. Use a process manager like PM2 or systemd
4. Configure reverse proxy (nginx/Apache)

### Frontend Deployment
1. Build the production bundle: `npm run build`
2. Deploy the `dist/` folder to your web server
3. Configure your web server to serve the React app

### Database Deployment
1. Use a managed MySQL service or self-hosted instance
2. Configure proper backups and monitoring
3. Set up connection pooling for production

## Security Features

- **Password Hashing**: bcrypt with salt rounds
- **JWT Authentication**: Secure token-based auth
- **CORS Protection**: Configured for specific origins
- **Input Validation**: Server-side validation for all inputs
- **SQL Injection Protection**: Parameterized queries
- **Authorization**: Route-level access control

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes
4. Add tests if applicable
5. Commit your changes: `git commit -m 'Add feature'`
6. Push to the branch: `git push origin feature-name`
7. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions:
- Create an issue in the repository
- Check the documentation
- Review the code examples

## Roadmap

- [ ] Real-time notifications
- [ ] Payment gateway integration
- [ ] Advanced search with Elasticsearch
- [ ] Mobile app (React Native)
- [ ] Admin dashboard
- [ ] Analytics and reporting
- [ ] Multi-language support
- [ ] Image upload service
- [ ] Email notifications
- [ ] Social login integration

go build -o clovia main.go