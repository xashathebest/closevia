# Admin Dashboard

A comprehensive admin dashboard built with React + Chakra UI that provides real-time statistics and insights for the Clovia platform.

## Features

### 📊 Statistics Cards
- **Total Products**: Count of all products in the database
- **Active Orders**: Number of orders with status = "active"
- **Premium Listings**: Number of listings with premium = true
- **Transactions**: Total number of completed transactions

### 📈 Transaction Chart
- Line chart showing transaction trends over the last 30 days
- Built with Recharts library
- Responsive design that adapts to different screen sizes

### 📋 Recent Activity Table
- Displays the last 5 orders with:
  - Order ID
  - Product name
  - Buyer name
  - Status (with color-coded badges)
  - Creation date

## Technical Implementation

### Backend API (`/api/admin/stats`)

The dashboard fetches data from a new admin endpoint that provides:

```json
{
  "success": true,
  "data": {
    "total_products": 150,
    "active_orders": 25,
    "premium_listings": 12,
    "completed_transactions": 89,
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

### Frontend Components

- **AdminDashboard.tsx**: Main dashboard component
- **Responsive Design**: Mobile (1 column) → Desktop (4 columns)
- **Loading States**: Spinner while fetching data
- **Error Handling**: Error alerts with retry functionality
- **Refresh Button**: Manual refresh capability

### Chakra UI Components Used

- `SimpleGrid`: Responsive grid layout
- `Stat`, `StatLabel`, `StatNumber`: Statistics display
- `Card`, `CardBody`, `CardHeader`: Card containers
- `Table`, `Thead`, `Tbody`: Data tables
- `Badge`: Status indicators
- `Spinner`: Loading states
- `Alert`: Error messages

## Installation & Setup

### Prerequisites
- Node.js and npm
- Go (for backend)
- MySQL database

### Backend Setup
1. The admin handler is automatically included in the main Go application
2. The `/api/admin/stats` endpoint is available at `http://localhost:4000/api/admin/stats`

### Frontend Setup
1. Install Recharts: `npm install recharts`
2. The AdminDashboard component is automatically included in the routing
3. Access the dashboard at `/admin` route

## Usage

1. Navigate to the admin dashboard by clicking the "Admin" icon in the sidebar
2. View real-time statistics in the cards at the top
3. Analyze transaction trends in the line chart
4. Monitor recent activity in the table
5. Use the refresh button to update data manually

## Customization

### Adding New Statistics
1. Add new fields to the `AdminStats` interface in `AdminDashboard.tsx`
2. Update the backend query in `admin_handler.go`
3. Add new Stat components to the dashboard

### Modifying the Chart
- Change the time period by modifying the SQL query
- Add multiple data series by extending the chart data structure
- Customize colors and styling in the LineChart component

### Styling
- Modify the Chakra UI theme colors in `theme.ts`
- Adjust responsive breakpoints in the SimpleGrid components
- Customize card styling and layout

## Security Considerations

- The admin endpoint currently has no authentication requirements
- Consider adding admin role verification middleware
- Implement rate limiting for the stats endpoint
- Add audit logging for admin dashboard access

## Future Enhancements

- Real-time updates using WebSocket connections
- Export functionality for reports
- Advanced filtering and date range selection
- User management interface
- System health monitoring
- Performance metrics and analytics
