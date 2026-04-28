import React, { useState, useEffect } from 'react';
import {
  Box,
  HStack,
  Text,
  Icon,
  Badge,
  Tooltip,
  useColorModeValue,
} from '@chakra-ui/react';
import { FiWifi, FiWifiOff, FiServer, FiClock } from 'react-icons/fi';
import { checkConnectionStatus } from '../utils/apiUtils';

interface ConnectionStatusProps {
  showDetails?: boolean;
}

const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ showDetails = false }) => {
  const [status, setStatus] = useState<{
    online: boolean;
    apiReachable: boolean;
    latency: number;
  }>({
    online: navigator.onLine,
    apiReachable: true,
    latency: 0,
  });

  const [isChecking, setIsChecking] = useState(false);

  const bgColor = useColorModeValue('white', 'gray.700');
  const borderColor = useColorModeValue('gray.200', 'gray.600');

  const checkStatus = async () => {
    setIsChecking(true);
    try {
      const connectionStatus = await checkConnectionStatus();
      setStatus(connectionStatus);
    } catch (error) {
      console.error('Failed to check connection status:', error);
      setStatus({
        online: navigator.onLine,
        apiReachable: false,
        latency: 0,
      });
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    checkStatus();

    // Check status every 2 minutes
    const interval = setInterval(checkStatus, 120000);

    // Listen for online/offline events
    const handleOnline = () => {
      setStatus(prev => ({ ...prev, online: true }));
      checkStatus();
    };

    const handleOffline = () => {
      setStatus(prev => ({ ...prev, online: false, apiReachable: false }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const getStatusColor = () => {
    if (!status.online) return 'red';
    if (!status.apiReachable) return 'orange';
    if (status.latency > 2000) return 'yellow';
    return 'green';
  };

  const getStatusIcon = () => {
    if (!status.online) return FiWifiOff;
    if (!status.apiReachable) return FiServer;
    return FiWifi;
  };

  const getStatusText = () => {
    if (!status.online) return 'Offline';
    if (!status.apiReachable) return 'API Unreachable';
    if (status.latency > 2000) return 'Slow Connection';
    return 'Connected';
  };

  const getLatencyText = () => {
  if (status.latency === 0) return 'Unknown';
    return `${status.latency}ms`;
  };

  const isHealthy = status.online && status.apiReachable && status.latency <= 2000;
  if (!showDetails && isHealthy) return null;

  return (
    <Box
      position="fixed"
      top={{ base: 3, md: 4 }}
      right={{ base: 3, md: 4 }}
      zIndex={1000}
      bg={bgColor}
      border="1px"
      borderColor={borderColor}
      borderRadius="full"
      px={{ base: 3, md: 3 }}
      py={{ base: 1, md: 2 }}
      boxShadow="lg"
      maxW={{ base: 'auto', md: 'unset' }}
      fontSize={{ base: 'xs', md: 'sm' }}
    >
      <HStack spacing={2}>
        <Icon
          as={isChecking ? FiClock : getStatusIcon()}
          color={`${getStatusColor()}.500`}
          boxSize={4}
          animation={isChecking ? 'spin 1s linear infinite' : undefined}
        />
        
        {showDetails ? (
          <HStack spacing={2}>
            <Text fontSize="sm" fontWeight="medium">
              {!status.online ? "You're offline" : getStatusText()}
            </Text>
            <Badge
              colorScheme={getStatusColor()}
              variant="subtle"
              fontSize="xs"
            >
              {getLatencyText()}
            </Badge>
          </HStack>
        ) : (
          <Tooltip
            label={!status.online ? "You're offline. We'll use cached pages where possible." : `${getStatusText()} - Latency: ${getLatencyText()}`}
            placement="left"
          >
            <Badge
              colorScheme={getStatusColor()}
              variant="subtle"
              fontSize="xs"
              cursor="pointer"
            >
              {!status.online ? "You're offline" : getStatusText()}
            </Badge>
          </Tooltip>
        )}
      </HStack>
    </Box>
  );
};

export default ConnectionStatus;
