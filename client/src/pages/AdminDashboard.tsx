import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Container,
  Heading,
  SimpleGrid,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  StatArrow,
  useColorModeValue,
  Text,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  Spinner,
  Alert,
  AlertIcon,
  Card,
  CardBody,
  CardHeader,
  Flex,
  Icon,
  Button,
  HStack,
  VStack,
  Progress,
  useToast,
  Collapse,
  AlertTitle,
  AlertDescription,
  Grid,
  GridItem,
  Select,
  Progress as ChakraProgress,
} from '@chakra-ui/react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer
} from 'recharts';
import { 
  FiShoppingBag, 
  FiStar, 
  FiTrendingUp, 
  FiRefreshCw, 
  FiServer, 
  FiAlertTriangle,
  FiDollarSign,
  FiUsers,
  FiEye,
  FiMessageCircle,
  FiGift,
  FiShoppingCart,
  FiFileText,
  FiShield,
  FiHome,
  FiCreditCard,
} from 'react-icons/fi';
import { api } from '../services/api';
import { mockAdminStats, simulateApiDelay } from '../utils/mockData';
import { enhancedApiCall, checkConnectionStatus } from '../utils/apiUtils';
import ConnectionStatus from '../components/ConnectionStatus';
import ErrorBoundary from '../components/ErrorBoundary';

interface AdminStats {
  // KPI Metrics
  active_listings: number;
  premium_listings: number;
  transactions_30_days: number;
  net_revenue_30_days: number;
  total_users: number;
  admin_users: number;
  regular_users: number;

  // Operational Metrics
  reports_to_review: number;
  pending_verifications: number;
  listings_awaiting_approval: number;
  disputes_pending: number;
  payouts_pending: number;

  // Growth Metrics
  dau: number;
  wau: number;
  mau: number;

  // Conversion Funnel
  total_views: number;
  total_chats: number;
  total_offers: number;
  completed_transactions: number;

  // Charts and Data
  top_categories: Array<{
    name: string;
    count: number;
    share: number;
  }>;
  trend_data: Array<{
    date: string;
    count: number;
    gmv: number;
    revenue: number;
  }>;
  recent_admin_activity: Array<{
    action_type: string;
    id: number;
    status: string;
    created_at: string;
    description: string;
    user_name: string;
  }>;
}

const AdminDashboard: React.FC = () => {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<{
    online: boolean;
    apiReachable: boolean;
  }>({
    online: navigator.onLine,
    apiReachable: true,
  });
  const [isUsingMockData, setIsUsingMockData] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [showConnectionAlert, setShowConnectionAlert] = useState(false);
  const [chartMetric, setChartMetric] = useState<'count' | 'gmv' | 'revenue'>('count');

  const toast = useToast();
  const bgColor = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');
  const cardBg = useColorModeValue('white', 'gray.700');

  // Check connection status
  const checkConnection = useCallback(async () => {
    try {
      const status = await checkConnectionStatus();
      setConnectionStatus({
        online: !!status.online,
        apiReachable: !!status.apiReachable,
      });
      setShowConnectionAlert(!status.online || !status.apiReachable);
    } catch (error) {
      console.error('Failed to check connection:', error);
    }
  }, []);

  // Fetch admin stats with fallback to mock data
  const fetchAdminStats = useCallback(async (useMockDataFallback = false) => {
    try {
      setLoading(true);
      setError(null);
      setIsUsingMockData(false);

      console.log('Fetching admin stats...');

      if (useMockDataFallback) {
        // Use mock data
        await simulateApiDelay(500); // Simulate API delay
        setStats(mockAdminStats);
        setIsUsingMockData(true);
        toast({
          title: 'Using Demo Data',
          description: 'Showing mock data while API is unavailable',
          status: 'info',
          duration: 5000,
          isClosable: true,
        });
        return;
      }

      // Try to fetch real data
      const response = await enhancedApiCall<{success: boolean; data: AdminStats; error?: string}>('/api/admin/stats', {
        retryConfig: { maxRetries: 2 },
        useMockData: true,
      });

      console.log('Admin stats response:', response);
      
      if (response.success) {
        // If API returned success but no payload, fall back to demo data
        if (!response.data) {
          console.warn('Admin stats success but no data present, falling back to mock data');
          await simulateApiDelay(300);
          setStats(mockAdminStats);
          setIsUsingMockData(true);
          toast({
            title: 'Using Demo Data',
            description: 'Showing mock data due to missing API payload',
            status: 'info',
            duration: 5000,
            isClosable: true,
          });
        } else {
          // Backfill any missing fields by merging API data over mock defaults.
          // This prevents undefined values (e.g. total_revenue) causing runtime errors.
          setStats({
            ...mockAdminStats,
            ...response.data,
          });
          setIsUsingMockData(false);
        }
      } else {
        throw new Error(response.error || 'Failed to fetch admin statistics');
      }
    } catch (err: any) {
      console.error('Error fetching admin stats:', err);
      
      if (err.message === 'API_UNREACHABLE_MOCK_DATA_AVAILABLE') {
        // API is unreachable, use mock data
        await fetchAdminStats(true);
        return;
      }

      setError(err.message || 'Error fetching admin statistics');
      setRetryCount(prev => prev + 1);
      
      toast({
        title: 'Error',
        description: err.message || 'Failed to load dashboard data',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Handle retry with exponential backoff
  const handleRetry = useCallback(async () => {
    const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
    await new Promise(resolve => setTimeout(resolve, delay));
    await fetchAdminStats();
  }, [fetchAdminStats, retryCount]);

  // Handle manual refresh
  const handleRefresh = useCallback(async () => {
    setRetryCount(0);
    await fetchAdminStats();
  }, [fetchAdminStats]);

  useEffect(() => {
    checkConnection();
    fetchAdminStats();

    // Check connection every 30 seconds
    const connectionInterval = setInterval(checkConnection, 30000);

    return () => clearInterval(connectionInterval);
  }, [checkConnection, fetchAdminStats]);

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'approved':
      case 'resolved':
        return 'green';
      case 'active':
      case 'pending':
        return 'yellow';
      case 'cancelled':
      case 'rejected':
        return 'red';
      default:
        return 'gray';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-PH', { 
      style: 'currency', 
      currency: 'PHP' 
    }).format(amount);
  };

  const getChartData = () => {
    if (!stats?.trend_data) return [];
    
    return stats.trend_data.map(item => ({
      date: item.date,
      value: item[chartMetric],
      label: chartMetric === 'count' ? 'Transactions' : 
             chartMetric === 'gmv' ? 'GMV' : 'Revenue'
    }));
  };

  const getChartYAxisLabel = () => {
    switch (chartMetric) {
      case 'count': return 'Count';
      case 'gmv': return 'GMV (₱)';
      case 'revenue': return 'Revenue (₱)';
      default: return 'Value';
    }
  };

  const getChartColor = () => {
    switch (chartMetric) {
      case 'count': return '#3182CE';
      case 'gmv': return '#38A169';
      case 'revenue': return '#D69E2E';
      default: return '#3182CE';
    }
  };

  // Loading state
  if (loading) {
    return (
      <Container maxW="container.xl" py={8}>
        <VStack spacing={6} minH="400px" justify="center">
          <Spinner size="xl" color="blue.500" />
          <Text fontSize="lg" color="gray.600">
            Loading admin dashboard...
          </Text>
          <Progress size="sm" isIndeterminate colorScheme="blue" w="200px" />
          <Text fontSize="sm" color="gray.500">
            This may take a few moments
          </Text>
        </VStack>
      </Container>
    );
  }

  // Error state
  if (error) {
    return (
      <Container maxW="container.xl" py={8}>
        <VStack spacing={6}>
          <Alert status="error" borderRadius="lg">
            <AlertIcon />
            <Box>
              <AlertTitle>Error loading dashboard</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Box>
          </Alert>
          
          <VStack spacing={4}>
            <Button 
              leftIcon={<FiRefreshCw />} 
              onClick={handleRetry} 
              colorScheme="blue"
              size="lg"
            >
              Retry ({retryCount + 1}/3)
            </Button>
            
            <Button 
              leftIcon={<FiServer />} 
              onClick={() => fetchAdminStats(true)} 
              variant="outline"
              size="lg"
            >
              Use Demo Data
            </Button>
          </VStack>
        </VStack>
      </Container>
    );
  }

  // No data state
  if (!stats) {
    return (
      <Container maxW="container.xl" py={8}>
        <Alert status="warning" borderRadius="lg">
          <AlertIcon />
          <Box>
            <AlertTitle>No data available</AlertTitle>
            <AlertDescription>
              Unable to load dashboard statistics. Please try refreshing the page.
            </AlertDescription>
          </Box>
        </Alert>
      </Container>
    );
  }

  return (
    <ErrorBoundary>
      <Container maxW="container.xl" py={8}>
        {/* Connection Status */}
        <ConnectionStatus showDetails={false} />
        
        {/* Connection Alert */}
        <Collapse in={showConnectionAlert}>
          <Alert status="warning" mb={6} borderRadius="lg">
            <AlertIcon />
            <Box>
              <AlertTitle>Connection Issues</AlertTitle>
              <AlertDescription>
                {!connectionStatus.online 
                  ? 'You are currently offline. Some features may be limited.'
                  : 'API server is unreachable. Using demo data.'
                }
              </AlertDescription>
            </Box>
          </Alert>
        </Collapse>

        {/* Header */}
        <Flex justify="space-between" align="center" mb={8}>
          <VStack align="start" spacing={2}>
            <Heading color="blue.600">
              Admin Dashboard
            </Heading>
            {isUsingMockData && (
              <Badge colorScheme="orange" variant="subtle">
                Demo Mode - Using Mock Data
              </Badge>
            )}
          </VStack>
          
          <HStack spacing={3}>
            <Button 
              leftIcon={<FiRefreshCw />} 
              onClick={handleRefresh} 
              colorScheme="blue" 
              variant="outline"
              isLoading={loading}
            >
              Refresh
            </Button>
            
            {!connectionStatus.apiReachable && (
              <Button 
                leftIcon={<FiServer />} 
                onClick={() => fetchAdminStats(true)} 
                variant="ghost"
                colorScheme="orange"
              >
                Use Demo Data
              </Button>
            )}
          </HStack>
        </Flex>

        {/* Row 1: KPI Metrics */}
        <SimpleGrid columns={{ base: 1, md: 2, lg: 5 }} spacing={6} mb={8}>
          <Card bg={cardBg} border="1px" borderColor={borderColor}>
            <CardBody>
              <Stat>
                <Flex align="center" mb={2}>
                  <Icon as={FiShoppingBag} color="blue.500" mr={2} />
                  <StatLabel color="gray.600">Active Listings</StatLabel>
                </Flex>
                <StatNumber color="blue.600" fontSize="2xl">
                  {stats.active_listings.toLocaleString()}
                </StatNumber>
                <StatHelpText>
                  <StatArrow type="increase" />
                  12.5%
                </StatHelpText>
              </Stat>
            </CardBody>
          </Card>

          <Card bg={cardBg} border="1px" borderColor={borderColor}>
            <CardBody>
              <Stat>
                <Flex align="center" mb={2}>
                  <Icon as={FiStar} color="yellow.500" mr={2} />
                  <StatLabel color="gray.600">Premium Listings</StatLabel>
                </Flex>
                <StatNumber color="yellow.600" fontSize="2xl">
                  {stats.premium_listings.toLocaleString()}
                </StatNumber>
                <StatHelpText>
                  <StatArrow type="increase" />
                  8.2%
                </StatHelpText>
              </Stat>
            </CardBody>
          </Card>

          <Card bg={cardBg} border="1px" borderColor={borderColor}>
            <CardBody>
              <Stat>
                <Flex align="center" mb={2}>
                  <Icon as={FiTrendingUp} color="green.500" mr={2} />
                  <StatLabel color="gray.600">Transactions (30d)</StatLabel>
                </Flex>
                <StatNumber color="green.600" fontSize="2xl">
                  {stats.transactions_30_days.toLocaleString()}
                </StatNumber>
                <StatHelpText>
                  <StatArrow type="increase" />
                  15.3%
                </StatHelpText>
              </Stat>
            </CardBody>
          </Card>

          <Card bg={cardBg} border="1px" borderColor={borderColor}>
            <CardBody>
              <Stat>
                <Flex align="center" mb={2}>
                  <Icon as={FiDollarSign} color="purple.500" mr={2} />
                  <StatLabel color="gray.600">Net Revenue (30d)</StatLabel>
                </Flex>
                <StatNumber color="purple.600" fontSize="2xl">
                  {formatCurrency(stats.net_revenue_30_days)}
                </StatNumber>
                <StatHelpText>
                  <StatArrow type="increase" />
                  18.7%
                </StatHelpText>
              </Stat>
            </CardBody>
          </Card>

          <Card bg={cardBg} border="1px" borderColor={borderColor}>
            <CardBody>
              <Stat>
                <Flex align="center" mb={2}>
                  <Icon as={FiUsers} color="teal.500" mr={2} />
                  <StatLabel color="gray.600">Total Users</StatLabel>
                </Flex>
                <StatNumber color="teal.600" fontSize="2xl">
                  {stats.total_users.toLocaleString()}
                </StatNumber>
                <StatHelpText>
                  <StatArrow type="increase" />
                  5.2%
                </StatHelpText>
              </Stat>
            </CardBody>
          </Card>
        </SimpleGrid>

        {/* Row 2: Operational Metrics */}
        <SimpleGrid columns={{ base: 1, md: 2, lg: 5 }} spacing={6} mb={8}>
          <Card bg={cardBg} border="1px" borderColor={borderColor}>
            <CardBody>
              <Stat>
                <Flex align="center" mb={2}>
                  <Icon as={FiFileText} color="orange.500" mr={2} />
                  <StatLabel color="gray.600">Reports to Review</StatLabel>
                </Flex>
                <StatNumber color="orange.600" fontSize="2xl">
                  {stats.reports_to_review.toLocaleString()}
                </StatNumber>
                <StatHelpText>
                  <StatArrow type="decrease" />
                  -2.1%
                </StatHelpText>
              </Stat>
            </CardBody>
          </Card>

          <Card bg={cardBg} border="1px" borderColor={borderColor}>
            <CardBody>
              <Stat>
                <Flex align="center" mb={2}>
                  <Icon as={FiShield} color="red.500" mr={2} />
                  <StatLabel color="gray.600">Pending Verifications</StatLabel>
                </Flex>
                <StatNumber color="red.600" fontSize="2xl">
                  {stats.pending_verifications.toLocaleString()}
                </StatNumber>
                <StatHelpText>
                  <StatArrow type="increase" />
                  3.4%
                </StatHelpText>
              </Stat>
            </CardBody>
          </Card>

          <Card bg={cardBg} border="1px" borderColor={borderColor}>
            <CardBody>
              <Stat>
                <Flex align="center" mb={2}>
                  <Icon as={FiHome} color="blue.500" mr={2} />
                  <StatLabel color="gray.600">Awaiting Approval</StatLabel>
                </Flex>
                <StatNumber color="blue.600" fontSize="2xl">
                  {stats.listings_awaiting_approval.toLocaleString()}
                </StatNumber>
                <StatHelpText>
                  <StatArrow type="decrease" />
                  -1.8%
                </StatHelpText>
              </Stat>
            </CardBody>
          </Card>

          <Card bg={cardBg} border="1px" borderColor={borderColor}>
            <CardBody>
              <Stat>
                <Flex align="center" mb={2}>
                  <Icon as={FiAlertTriangle} color="yellow.500" mr={2} />
                  <StatLabel color="gray.600">Disputes Pending</StatLabel>
                </Flex>
                <StatNumber color="yellow.600" fontSize="2xl">
                  {stats.disputes_pending.toLocaleString()}
                </StatNumber>
                <StatHelpText>
                  <StatArrow type="decrease" />
                  -5.2%
                </StatHelpText>
              </Stat>
            </CardBody>
          </Card>

          <Card bg={cardBg} border="1px" borderColor={borderColor}>
            <CardBody>
              <Stat>
                <Flex align="center" mb={2}>
                  <Icon as={FiCreditCard} color="green.500" mr={2} />
                  <StatLabel color="gray.600">Payouts Pending</StatLabel>
                </Flex>
                <StatNumber color="green.600" fontSize="2xl">
                  {stats.payouts_pending.toLocaleString()}
                </StatNumber>
                <StatHelpText>
                  <StatArrow type="increase" />
                  2.7%
                </StatHelpText>
              </Stat>
            </CardBody>
          </Card>
        </SimpleGrid>

        {/* Row 3: Charts and Growth Metrics */}
        <Grid templateColumns={{ base: "1fr", lg: "2fr 1fr" }} gap={8} mb={8}>
          {/* Transaction Trends Chart */}
          <GridItem>
            <Card bg={cardBg} border="1px" borderColor={borderColor}>
              <CardHeader>
                <Flex justify="space-between" align="center">
                  <Heading size="md" color="blue.600">
                    Transaction Trends (Last 30 Days)
                  </Heading>
                  <Select 
                    value={chartMetric} 
                    onChange={(e) => setChartMetric(e.target.value as 'count' | 'gmv' | 'revenue')}
                    size="sm"
                    w="150px"
                  >
                    <option value="count">Count</option>
                    <option value="gmv">GMV</option>
                    <option value="revenue">Revenue</option>
                  </Select>
                </Flex>
              </CardHeader>
              <CardBody>
                <Box h="300px">
                  {stats.trend_data && stats.trend_data.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={getChartData()}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis 
                          dataKey="date" 
                          tick={{ fontSize: 12 }}
                          angle={-45}
                          textAnchor="end"
                          height={80}
                        />
                        <YAxis 
                          tick={{ fontSize: 12 }} 
                          label={{ value: getChartYAxisLabel(), angle: -90, position: 'insideLeft' }}
                        />
                        <Tooltip 
                          formatter={(value: any) => [
                            chartMetric === 'count' ? value : formatCurrency(value),
                            chartMetric === 'count' ? 'Transactions' : 
                            chartMetric === 'gmv' ? 'GMV' : 'Revenue'
                          ]}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="value" 
                          stroke={getChartColor()} 
                          strokeWidth={2}
                          dot={{ fill: getChartColor(), strokeWidth: 2, r: 4 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <Flex justify="center" align="center" h="100%">
                      <Text color="gray.500">No transaction data available</Text>
                    </Flex>
                  )}
                </Box>
              </CardBody>
            </Card>
          </GridItem>

          {/* Growth Metrics */}
          <GridItem>
            <VStack spacing={6}>
              {/* DAU/WAU/MAU */}
              <Card bg={cardBg} border="1px" borderColor={borderColor} w="100%">
                <CardHeader>
                  <Heading size="md" color="blue.600">
                    Active Users
                  </Heading>
                </CardHeader>
                <CardBody>
                  <VStack spacing={4}>
                    <HStack justify="space-between" w="100%">
                      <Text>Daily (DAU)</Text>
                      <Text fontWeight="bold" color="green.500">{stats.dau.toLocaleString()}</Text>
                    </HStack>
                    <HStack justify="space-between" w="100%">
                      <Text>Weekly (WAU)</Text>
                      <Text fontWeight="bold" color="blue.500">{stats.wau.toLocaleString()}</Text>
                    </HStack>
                    <HStack justify="space-between" w="100%">
                      <Text>Monthly (MAU)</Text>
                      <Text fontWeight="bold" color="purple.500">{stats.mau.toLocaleString()}</Text>
                    </HStack>
                  </VStack>
                </CardBody>
              </Card>

              {/* Conversion Funnel */}
              <Card bg={cardBg} border="1px" borderColor={borderColor} w="100%">
                <CardHeader>
                  <Heading size="md" color="blue.600">
                    Conversion Funnel
                  </Heading>
                </CardHeader>
                <CardBody>
                  <VStack spacing={4}>
                    <HStack justify="space-between" w="100%">
                      <HStack>
                        <Icon as={FiEye} color="blue.500" />
                        <Text>Views</Text>
                      </HStack>
                      <Text fontWeight="bold">{stats.total_views.toLocaleString()}</Text>
                    </HStack>
                    <HStack justify="space-between" w="100%">
                      <HStack>
                        <Icon as={FiMessageCircle} color="green.500" />
                        <Text>Chats</Text>
                      </HStack>
                      <Text fontWeight="bold">{stats.total_chats.toLocaleString()}</Text>
                    </HStack>
                    <HStack justify="space-between" w="100%">
                      <HStack>
                        <Icon as={FiGift} color="yellow.500" />
                        <Text>Offers</Text>
                      </HStack>
                      <Text fontWeight="bold">{stats.total_offers.toLocaleString()}</Text>
                    </HStack>
                    <HStack justify="space-between" w="100%">
                      <HStack>
                        <Icon as={FiShoppingCart} color="purple.500" />
                        <Text>Completed</Text>
                      </HStack>
                      <Text fontWeight="bold">{stats.completed_transactions.toLocaleString()}</Text>
                    </HStack>
                  </VStack>
                </CardBody>
              </Card>
            </VStack>
          </GridItem>
        </Grid>

        {/* Row 4: Top Categories and Recent Activity */}
        <Grid templateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap={8}>
          {/* Top Categories */}
          <GridItem>
            <Card bg={cardBg} border="1px" borderColor={borderColor}>
              <CardHeader>
                <Heading size="md" color="blue.600">
                  Top Categories
                </Heading>
              </CardHeader>
              <CardBody>
                <VStack spacing={4} align="stretch">
                  {stats.top_categories && stats.top_categories.length > 0 ? (
                    stats.top_categories.map((category, index) => (
                      <Box key={index}>
                        <Flex justify="space-between" align="center" mb={2}>
                          <Text fontWeight="medium">{category.name}</Text>
                          <Text color="gray.600">{category.count} listings</Text>
                        </Flex>
                        <Flex align="center" gap={2}>
                          <ChakraProgress 
                            value={category.share} 
                            colorScheme="blue" 
                            size="sm" 
                            flex={1}
                          />
                          <Text fontSize="sm" color="gray.500" minW="50px">
                            {category.share.toFixed(1)}%
                          </Text>
                        </Flex>
                      </Box>
                    ))
                  ) : (
                    <Text color="gray.500" textAlign="center">No category data available</Text>
                  )}
                </VStack>
              </CardBody>
            </Card>
          </GridItem>

          {/* Recent Admin Activity */}
          <GridItem>
            <Card bg={cardBg} border="1px" borderColor={borderColor}>
              <CardHeader>
                <Heading size="md" color="blue.600">
                  Recent Admin Activity
                </Heading>
              </CardHeader>
              <CardBody>
                <Box overflowX="auto">
                  {stats.recent_admin_activity && stats.recent_admin_activity.length > 0 ? (
                    <Table variant="simple" size="sm">
                      <Thead>
                        <Tr>
                          <Th>Action</Th>
                          <Th>Status</Th>
                          <Th>User</Th>
                          <Th>Date</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {stats.recent_admin_activity.map((activity) => (
                          <Tr key={activity.id}>
                            <Td>
                              <Text fontSize="sm" fontWeight="medium">
                                {activity.action_type}
                              </Text>
                            </Td>
                            <Td>
                              <Badge colorScheme={getStatusColor(activity.status)}>
                                {activity.status}
                              </Badge>
                            </Td>
                            <Td>
                              <Text fontSize="sm" noOfLines={1}>
                                {activity.user_name}
                              </Text>
                            </Td>
                            <Td fontSize="sm">{formatDate(activity.created_at)}</Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  ) : (
                    <Flex justify="center" align="center" h="200px">
                      <Text color="gray.500">No recent admin activity</Text>
                    </Flex>
                  )}
                </Box>
              </CardBody>
            </Card>
          </GridItem>
        </Grid>
      </Container>
    </ErrorBoundary>
  );
};

export default AdminDashboard;
