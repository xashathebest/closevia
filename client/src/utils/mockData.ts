// Mock data for admin dashboard when API is unavailable
export const mockAdminStats = {
  // KPI Metrics
  active_listings: 150,
  premium_listings: 12,
  transactions_30_days: 89,
  net_revenue_30_days: 1250.50,
  total_users: 45,
  admin_users: 3,
  regular_users: 42,

  // Operational Metrics
  reports_to_review: 5,
  pending_verifications: 8,
  listings_awaiting_approval: 3,
  disputes_pending: 2,
  payouts_pending: 7,

  // Growth Metrics
  dau: 25,
  wau: 120,
  mau: 450,

  // Conversion Funnel
  total_views: 1250,
  total_chats: 89,
  total_offers: 45,
  completed_transactions: 23,

  // Charts and Data
  top_categories: [
    { name: 'Electronics', count: 45, share: 30.0 },
    { name: 'Fashion', count: 38, share: 25.3 },
    { name: 'Home & Garden', count: 27, share: 18.0 },
    { name: 'Sports', count: 22, share: 14.7 },
    { name: 'Books', count: 18, share: 12.0 },
  ],
  trend_data: [
    { date: '2025-08-20', count: 3, gmv: 45.50, revenue: 45.50 },
    { date: '2025-08-21', count: 5, gmv: 78.25, revenue: 78.25 },
    { date: '2025-08-22', count: 1, gmv: 15.00, revenue: 15.00 },
    { date: '2025-08-23', count: 4, gmv: 62.75, revenue: 62.75 },
    { date: '2025-08-24', count: 2, gmv: 32.50, revenue: 32.50 },
    { date: '2025-08-25', count: 6, gmv: 95.00, revenue: 95.00 },
    { date: '2025-08-26', count: 3, gmv: 48.25, revenue: 48.25 },
    { date: '2025-08-27', count: 7, gmv: 112.75, revenue: 112.75 },
    { date: '2025-08-28', count: 4, gmv: 67.50, revenue: 67.50 },
    { date: '2025-08-29', count: 5, gmv: 89.25, revenue: 89.25 },
  ],
  recent_admin_activity: [
    {
      action_type: 'Report',
      id: 123,
      status: 'pending',
      created_at: '2025-08-29T10:30:00Z',
      description: 'Report #123',
      user_name: 'John Doe'
    },
    {
      action_type: 'Verification',
      id: 124,
      status: 'pending',
      created_at: '2025-08-29T09:15:00Z',
      description: 'Verification for Jane Smith',
      user_name: 'Jane Smith'
    },
    {
      action_type: 'Report',
      id: 125,
      status: 'reviewed',
      created_at: '2025-08-29T08:45:00Z',
      description: 'Report #125',
      user_name: 'Mike Johnson'
    },
    {
      action_type: 'Verification',
      id: 126,
      status: 'approved',
      created_at: '2025-08-29T07:20:00Z',
      description: 'Verification for Sarah Wilson',
      user_name: 'Sarah Wilson'
    },
    {
      action_type: 'Report',
      id: 127,
      status: 'pending',
      created_at: '2025-08-29T06:10:00Z',
      description: 'Report #127',
      user_name: 'David Brown'
    }
  ]
};

// Simulate API delay for realistic testing
export const simulateApiDelay = (ms: number = 1000): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// Check if we're in development mode
export const isDevelopment = process.env.NODE_ENV === 'development';

// Check if we should use mock data
export const shouldUseMockData = (): boolean => {
  return isDevelopment && !navigator.onLine;
};
