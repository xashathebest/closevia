import { api } from '../services/api';

// Retry configuration
interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

const defaultRetryConfig: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
};

// Calculate delay with exponential backoff
const calculateDelay = (attempt: number, config: RetryConfig): number => {
  const delay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt);
  return Math.min(delay, config.maxDelay);
};

// Check if error is retryable
const isRetryableError = (error: any): boolean => {
  // Retry on network errors, 5xx server errors, and 429 rate limit
  return (
    !error.response || // Network error
    error.response.status >= 500 || // Server error
    error.response.status === 429 // Rate limit
  );
};

// Enhanced API call with retry logic
export const apiCallWithRetry = async <T>(
  apiCall: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> => {
  const retryConfig = { ...defaultRetryConfig, ...config };
  let lastError: any;

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      return await apiCall();
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on last attempt
      if (attempt === retryConfig.maxRetries) {
        break;
      }

      // Don't retry if error is not retryable
      if (!isRetryableError(error)) {
        break;
      }

      // Wait before retrying
      const delay = calculateDelay(attempt, retryConfig);
      console.log(`API call failed, retrying in ${delay}ms (attempt ${attempt + 1}/${retryConfig.maxRetries + 1})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
};

// Check if user is authenticated
export const isAuthenticated = (): boolean => {
  const token = localStorage.getItem('clovia_token');
  return !!token;
};

// Validate token format (basic check)
export const isValidToken = (token: string): boolean => {
  // Basic JWT format validation
  const parts = token.split('.');
  return parts.length === 3;
};

// Get authentication headers
export const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('clovia_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// Check connection status
export const checkConnectionStatus = async (): Promise<{
  online: boolean;
  apiReachable: boolean;
  latency: number;
}> => {
  const startTime = Date.now();
  
  try {
    // Check if we're online
    if (!navigator.onLine) {
      return { online: false, apiReachable: false, latency: 0 };
    }

    // Test API connectivity
    const response = await fetch('http://localhost:4000/health', {
      method: 'GET',
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    const latency = Date.now() - startTime;
    
    return {
      online: true,
      apiReachable: response.ok,
      latency,
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    return {
      online: navigator.onLine,
      apiReachable: false,
      latency,
    };
  }
};

// Enhanced API wrapper with connection checking
export const enhancedApiCall = async <T>(
  endpoint: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    data?: any;
    retryConfig?: Partial<RetryConfig>;
    useMockData?: boolean;
  } = {}
): Promise<T> => {
  const { method = 'GET', data, retryConfig, useMockData = false } = options;

  // Check connection status first
  const connectionStatus = await checkConnectionStatus();
  
  if (!connectionStatus.online) {
    throw new Error('No internet connection');
  }

  if (!connectionStatus.apiReachable && useMockData) {
    // Return mock data if API is unreachable and mock data is enabled
    throw new Error('API_UNREACHABLE_MOCK_DATA_AVAILABLE');
  }

  const apiCall = async (): Promise<T> => {
    const config: any = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
    };

    if (data) {
      config.body = JSON.stringify(data);
    }

    const response = await api(endpoint, config);
    return response.data;
  };

  return apiCallWithRetry(apiCall, retryConfig);
};
