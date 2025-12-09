# Clovia Admin Dashboard with Role-Based Authentication

A comprehensive admin dashboard system built with React + Chakra UI and Go backend, featuring role-based authentication and real-time statistics.

## 🚀 Features

### Authentication & Authorization
- **Role-based users**: `admin` and `user` roles
- **Protected routes**: Admin dashboard only accessible to admin users
- **JWT authentication**: Secure token-based authentication
- **Automatic redirects**: Non-admin users redirected to user dashboard

### Admin Dashboard Statistics
- **Total Products**: Count of all products in database
- **Active Orders**: Number of orders with status = "active"
- **Premium Listings**: Number of products with premium = true
- **Completed Transactions**: Count of completed trades
- **Total Revenue**: Sum of completed transaction amounts
- **Registered Users**: Total user count

### Dashboard Components
- **Statistics Cards**: Responsive grid layout with icons and growth indicators
- **Transaction Chart**: Line chart showing trends over 30 days (Recharts)
- **Recent Activity Table**: Last 5 orders with status badges
- **Loading States**: Spinner while fetching data
- **Error Handling**: Graceful error states with retry functionality
- **Refresh Button**: Manual data refresh capability

## 🛠 Technical Implementation

### Backend (Go + Fiber)

#### Database Schema
```sql
-- Users table with role column
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(10) NOT NULL DEFAULT 'user',
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

#### API Endpoints
- `POST /api/auth/login` - User authentication
- `POST /api/auth/register` - User registration
- `GET /api/admin/stats` - Admin dashboard statistics (protected)
- `GET /api/users/profile` - Get user profile

#### Middleware
- `AuthMiddleware()` - Verifies JWT token
- `AdminMiddleware()` - Ensures user has admin role

### Frontend (React + Chakra UI)

#### Components
- `AdminRoute` - Protected route component for admin-only access
- `AdminDashboard` - Main dashboard with statistics and charts
- `Sidebar` - Navigation with role-based admin link visibility

#### State Management
- `AuthContext` - User authentication and role management
- React Query for data fetching (can be easily integrated)

## 📦 Installation & Setup

### Prerequisites
- Go 1.19+
- Node.js 16+
- MySQL 8.0+
- npm or yarn

### Backend Setup
1. **Clone and navigate to project**
   ```bash
   cd Clovia
   ```

2. **Install Go dependencies**
   ```bash
   go mod tidy
   ```

3. **Set up database**
   - Create MySQL database named `closevia`
   - Update database credentials in `.env` file

4. **Run database migrations**
   ```bash
   go run main.go
   ```

5. **Create admin user**
   ```bash
   go run create_admin.go
   ```
   This creates an admin user with:
   - Email: `admin@clovia.com`
   - Password: `admin123`
   - Role: `admin`

6. **Start backend server**
   ```bash
   go run main.go
   ```
   Server runs on `http://localhost:4000`

### Frontend Setup
1. **Navigate to client directory**
   ```bash
   cd client
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start development server**
   ```bash
   npm run dev
   ```
   Frontend runs on `http://localhost:5173`

## 🔐 Authentication Flow

### Admin Login
1. Navigate to `/login`
2. Use admin credentials:
   - Email: `admin@clovia.com`
   - Password: `admin123`
3. Admin users see "Admin" link in sidebar
4. Click "Admin" to access dashboard

### Regular User Login
1. Register new user or login with existing user
2. Regular users don't see "Admin" link
3. Attempting to access `/admin` redirects to `/dashboard`

## 📊 Dashboard Features

### Statistics Cards
- **Responsive Design**: 1 column (mobile) → 4 columns (desktop)
- **Real-time Data**: Fetched from database via API
- **Visual Indicators**: Icons, colors, and growth percentages
- **Loading States**: Spinner while fetching data

### Transaction Chart
- **30-day Trends**: Shows transaction activity over time
- **Interactive**: Hover tooltips and responsive design
- **Empty State**: Graceful handling when no data available

### Recent Activity Table
- **Last 5 Orders**: Most recent order activity
- **Status Badges**: Color-coded status indicators
- **Responsive**: Horizontal scroll on mobile devices

## 🔧 Customization

### Adding New Statistics
1. **Backend**: Add new query in `admin_handler.go`
2. **Frontend**: Update `AdminStats` interface and add new card
3. **Database**: Ensure required data exists

### Modifying Access Control
1. **Role Management**: Update user roles in database
2. **Middleware**: Modify `AdminMiddleware` for custom logic
3. **Frontend**: Update `AdminRoute` component

### Styling
- **Theme**: Modify Chakra UI theme in `theme.ts`
- **Colors**: Update brand colors and card styling
- **Layout**: Adjust grid breakpoints and spacing

## 🚨 Security Considerations

### Current Implementation
- JWT-based authentication
- Role-based access control
- Protected admin routes
- Database-level role validation

### Recommended Enhancements
- Rate limiting for API endpoints
- Audit logging for admin actions
- Password complexity requirements
- Session management
- CSRF protection

## 🐛 Troubleshooting

### Common Issues

1. **"Error fetching admin statistics"**
   - Check if backend server is running
   - Verify database connection
   - Ensure admin user exists and has correct role

2. **Admin link not showing**
   - Verify user role is "admin" in database
   - Check authentication state
   - Clear browser cache and localStorage

3. **Access denied errors**
   - Ensure user is logged in
   - Verify user has admin role
   - Check JWT token validity

### Debug Steps
1. Check browser console for errors
2. Verify API responses in Network tab
3. Check backend logs for errors
4. Validate database user roles

## 📈 Future Enhancements

### Planned Features
- Real-time updates using WebSocket
- Advanced filtering and date range selection
- Export functionality for reports
- User management interface
- System health monitoring
- Performance metrics and analytics

### Technical Improvements
- React Query integration for better caching
- Advanced chart types (bar, pie, area)
- Real-time notifications
- Advanced search and filtering
- Bulk operations for admin actions

## 📝 API Documentation

### Admin Stats Endpoint
```http
GET /api/admin/stats
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "total_products": 150,
    "active_orders": 25,
    "premium_listings": 12,
    "completed_transactions": 89,
    "total_revenue": 1250.50,
    "total_users": 45,
    "chart_data": [
      {"date": "2025-08-20", "count": 3},
      {"date": "2025-08-22", "count": 1}
    ],
    "recent_activity": [
      {
        "id": 123,
        "status": "completed",
        "created_at": "2025-08-22T10:30:00Z",
        "product_name": "Vintage Watch",
        "buyer_name": "John Doe"
      }
    ]
  }
}
```

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Make changes with proper testing
4. Submit pull request with description

## 📄 License

This project is licensed under the MIT License.
