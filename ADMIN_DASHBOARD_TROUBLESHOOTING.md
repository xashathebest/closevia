# Admin Dashboard Test Script

## Current Status:
✅ **Backend Server**: Running on http://localhost:4000
✅ **Frontend Server**: Running on http://localhost:5174
✅ **CORS Configuration**: Updated to allow port 5174
✅ **Admin User**: Created (admin@clovia.com / admin123)
✅ **Admin API**: Working (/api/admin/stats)

## How to Access Admin Dashboard:

1. **Open your browser** and go to: `http://localhost:5174`

2. **Login as Admin**:
   - Click "Login" or go to `/login`
   - Email: `admin@clovia.com`
   - Password: `admin123`

3. **Access Admin Dashboard**:
   - After login, you should see a "Admin" (star icon) in the sidebar
   - Click the Admin icon to access the dashboard

## If you still see "Error fetching admin statistics":

1. **Check Browser Console** (F12):
   - Look for any error messages
   - Check Network tab for failed requests

2. **Verify Authentication**:
   - Make sure you're logged in as admin
   - Check if the token is being sent in requests

3. **Test API Directly**:
   ```bash
   # Login to get token
   curl -X POST http://localhost:4000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@clovia.com","password":"admin123"}'
   
   # Use token to access admin stats
   curl -X GET http://localhost:4000/api/admin/stats \
     -H "Authorization: Bearer YOUR_TOKEN_HERE"
   ```

## Common Issues & Solutions:

1. **"Error fetching admin statistics"**:
   - Backend server not running → Start with `go run main.go`
   - CORS issues → Already fixed
   - Not logged in as admin → Login with admin credentials

2. **Admin link not showing**:
   - User role not admin → Login with admin@clovia.com
   - Authentication failed → Check browser console

3. **Access denied**:
   - User not admin → Use admin credentials
   - Token expired → Login again

## Expected Dashboard Features:
- 6 Statistics Cards (Total Products, Active Orders, Premium Listings, Transactions, Revenue, Users)
- Transaction Chart (30-day trends)
- Recent Activity Table
- Refresh Button
- Responsive Design

The admin dashboard should now work properly! 🎉
