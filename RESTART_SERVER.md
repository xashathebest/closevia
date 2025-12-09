# How to Fix 404 Error for /api/deliveries

## Issue
The server is returning 404 for `/api/deliveries` because the new routes haven't been loaded.

## Solution

### Step 1: Stop the Current Server
If the server is running, stop it by pressing `Ctrl+C` in the terminal where it's running.

### Step 2: Rebuild and Restart
Navigate to the project root and run:

```bash
# On Windows (PowerShell)
cd c:\xampp\htdocs\Clovia
go run main.go

# Or if you have a build script:
go build -o clovia.exe
./clovia.exe
```

### Step 3: Verify Routes
Once the server is running, you should see the routes being registered. The delivery routes should appear in the server logs.

### Step 4: Test the Endpoint
You can test if the route is working by making a request:
- Open browser console
- Check Network tab when making a delivery request
- The endpoint should be: `http://localhost:4000/api/deliveries`

## Alternative: Check Server Logs
If the server is already running, check the logs to see if there are any errors during startup. The delivery routes should be registered when the server starts.

## Common Issues:
1. **Server not restarted** - Most common cause. Always restart after adding new routes.
2. **Port conflict** - Make sure port 4000 is available
3. **Compilation errors** - Check if there are any Go compilation errors

