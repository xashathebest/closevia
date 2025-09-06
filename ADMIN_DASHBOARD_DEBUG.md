# Admin Dashboard Debug Guide

## Current Status:
✅ **Backend Server**: Running on http://localhost:4000
✅ **Admin API**: Working (/api/admin/stats returns data)
✅ **API Endpoint**: Fixed (was `/admin/stats`, now `/api/admin/stats`)
✅ **CORS**: Configured for port 5174

## White Screen Issue - Debug Steps:

### 1. **Check Browser Console (F12)**
Look for these errors:
- Network errors (404, 401, 500)
- JavaScript errors
- CORS errors

### 2. **Verify Authentication**
- Make sure you're logged in as admin
- Check if token exists in localStorage
- Verify token is not expired

### 3. **Test API Directly**
```bash
# Get fresh token
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@clovia.com","password":"admin123"}'

# Test admin stats
curl -X GET http://localhost:4000/api/admin/stats \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 4. **Frontend Debug Steps**
1. Open browser console (F12)
2. Go to Network tab
3. Click Admin icon
4. Look for failed requests to `/api/admin/stats`
5. Check if Authorization header is present

### 5. **Common Issues & Solutions**

#### Issue: "Error fetching admin statistics"
**Cause**: API endpoint wrong or authentication failed
**Solution**: 
- ✅ Fixed API endpoint from `/admin/stats` to `/api/admin/stats`
- Login with admin credentials: `admin@clovia.com` / `admin123`

#### Issue: White screen with no error
**Cause**: Component not rendering due to loading/error state
**Solution**: 
- Check browser console for errors
- Verify authentication state
- Check if user role is 'admin'

#### Issue: 401 Unauthorized
**Cause**: Token expired or invalid
**Solution**: 
- Login again to get fresh token
- Clear localStorage and login

#### Issue: 404 Not Found
**Cause**: Wrong API endpoint
**Solution**: 
- ✅ Fixed: Use `/api/admin/stats` not `/admin/stats`

### 6. **Expected Behavior**
After clicking Admin icon:
1. Shows loading spinner with "Loading admin dashboard..."
2. Fetches data from `/api/admin/stats`
3. Displays 6 statistics cards
4. Shows transaction chart
5. Shows recent activity table

### 7. **Manual Test**
1. Open http://localhost:5174
2. Login with admin@clovia.com / admin123
3. Click Admin icon (star) in sidebar
4. Should see loading → dashboard

### 8. **If Still White Screen**
1. Check browser console for errors
2. Verify backend is running on port 4000
3. Verify frontend is running on port 5174
4. Try refreshing the page
5. Clear browser cache and localStorage

## Debug Console Commands:
```javascript
// Check if user is admin
console.log('User:', JSON.parse(localStorage.getItem('clovia_user')));

// Check if token exists
console.log('Token:', localStorage.getItem('clovia_token'));

// Test API call manually
fetch('http://localhost:4000/api/admin/stats', {
  headers: {
    'Authorization': 'Bearer ' + localStorage.getItem('clovia_token')
  }
}).then(r => r.json()).then(console.log);
```

The admin dashboard should now work! 🎉
