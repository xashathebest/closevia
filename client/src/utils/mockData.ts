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

  // Product Analytics
  price_ranges: [
    { range: '₱0 - ₱500', count: 45, percentage: 30.0 },
    { range: '₱501 - ₱1,000', count: 38, percentage: 25.3 },
    { range: '₱1,001 - ₱2,500', count: 27, percentage: 18.0 },
    { range: '₱2,501 - ₱5,000', count: 22, percentage: 14.7 },
    { range: '₱5,001+', count: 18, percentage: 12.0 },
  ],
  condition_distribution: [
    { condition: 'New', count: 35, percentage: 23.3 },
    { condition: 'Like-New', count: 42, percentage: 28.0 },
    { condition: 'Used', count: 58, percentage: 38.7 },
    { condition: 'Fair', count: 15, percentage: 10.0 },
  ],
  location_analytics: [
    {
      city: 'Manila',
      count: 45,
      meetup_spots: ['SM Mall of Asia', 'Greenbelt Mall', 'Robinsons Place', 'Ayala Center']
    },
    {
      city: 'Quezon City',
      count: 32,
      meetup_spots: ['SM North EDSA', 'Trinoma Mall', 'Eastwood City', 'UP Diliman']
    },
    {
      city: 'Makati',
      count: 28,
      meetup_spots: ['Glorietta', 'Power Plant Mall', 'Greenbelt', 'Ayala Avenue']
    },
    {
      city: 'Taguig',
      count: 25,
      meetup_spots: ['BGC High Street', 'Market Market', 'SM Aura', 'Venice Grand Canal']
    },
    {
      city: 'Pasig',
      count: 20,
      meetup_spots: ['Ortigas Center', 'Tiendesitas', 'Robinsons Galleria', 'Eastwood']
    }
  ],
  category_analytics: [
    { category: 'Electronics', count: 45, percentage: 30.0, color: 'blue' },
    { category: 'Fashion', count: 38, percentage: 25.3, color: 'pink' },
    { category: 'Home & Garden', count: 27, percentage: 18.0, color: 'green' },
    { category: 'Sports', count: 22, percentage: 14.7, color: 'orange' },
    { category: 'Books', count: 18, percentage: 12.0, color: 'purple' },
  ],
  recent_listings: [
    {
      id: 1001,
      title: 'iPhone 13 Pro Max 256GB',
      price: 45000,
      condition: 'Like-New',
      location: 'Manila',
      category: 'Electronics',
      created_at: '2025-01-15T14:30:00Z',
      seller_name: 'John Doe',
      status: 'available'
    },
    {
      id: 1002,
      title: 'Nike Air Jordan 1',
      price: 8500,
      condition: 'New',
      location: 'Quezon City',
      category: 'Fashion',
      created_at: '2025-01-15T12:15:00Z',
      seller_name: 'Jane Smith',
      status: 'available'
    },
    {
      id: 1003,
      title: 'MacBook Pro M2 13-inch',
      price: 75000,
      condition: 'Used',
      location: 'Makati',
      category: 'Electronics',
      created_at: '2025-01-15T10:45:00Z',
      seller_name: 'Mike Johnson',
      status: 'available'
    },
    {
      id: 1004,
      title: 'Vintage Leather Sofa',
      price: 0,
      condition: 'Fair',
      location: 'Taguig',
      category: 'Home & Garden',
      created_at: '2025-01-15T09:20:00Z',
      seller_name: 'Sarah Wilson',
      status: 'available'
    },
    {
      id: 1005,
      title: 'Canon EOS R5 Camera',
      price: 120000,
      condition: 'Like-New',
      location: 'Pasig',
      category: 'Electronics',
      created_at: '2025-01-15T08:10:00Z',
      seller_name: 'David Brown',
      status: 'available'
    },
    {
      id: 1006,
      title: 'Designer Handbag Collection',
      price: 25000,
      condition: 'New',
      location: 'Manila',
      category: 'Fashion',
      created_at: '2025-01-15T07:30:00Z',
      seller_name: 'Lisa Garcia',
      status: 'available'
    },
    {
      id: 1007,
      title: 'Gaming PC Setup',
      price: 0,
      condition: 'Used',
      location: 'Quezon City',
      category: 'Electronics',
      created_at: '2025-01-15T06:45:00Z',
      seller_name: 'Alex Rodriguez',
      status: 'available'
    },
    {
      id: 1008,
      title: 'Yoga Mat & Accessories',
      price: 1200,
      condition: 'Like-New',
      location: 'Makati',
      category: 'Sports',
      created_at: '2025-01-15T05:15:00Z',
      seller_name: 'Maria Santos',
      status: 'available'
    }
  ],

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
// Vite exposes environment via import.meta.env
// import.meta.env.DEV is true in development mode
export const isDevelopment = typeof import.meta !== 'undefined' && (import.meta as any).env && ((import.meta as any).env.DEV === true || (import.meta as any).env.MODE === 'development')

// Check if we should use mock data
export const shouldUseMockData = (): boolean => {
  return isDevelopment && !navigator.onLine;
};
