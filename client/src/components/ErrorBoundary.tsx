import React, { Component, ErrorInfo, ReactNode } from 'react';
import {
  Box,
  Container,
  Heading,
  Text,
  Button,
  VStack,
  Alert,
  AlertIcon,
  useColorModeValue,
} from '@chakra-ui/react';
import { FiRefreshCw, FiHome } from 'react-icons/fi';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return <ErrorFallback 
        error={this.state.error} 
        onRetry={this.handleRetry}
        onGoHome={this.handleGoHome}
      />;
    }

    return this.props.children;
  }
}

interface ErrorFallbackProps {
  error?: Error;
  onRetry: () => void;
  onGoHome: () => void;
}

const ErrorFallback: React.FC<ErrorFallbackProps> = ({ error, onRetry, onGoHome }) => {
  const bgColor = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');

  return (
    <Container maxW="container.md" py={8}>
      <Box
        bg={bgColor}
        border="1px"
        borderColor={borderColor}
        borderRadius="lg"
        p={8}
        textAlign="center"
      >
        <VStack spacing={6}>
          <Alert status="error" borderRadius="md">
            <AlertIcon />
            <Text fontWeight="medium">
              Something went wrong
            </Text>
          </Alert>

          <Heading size="lg" color="red.600">
            Oops! An error occurred
          </Heading>

          <Text color="gray.600" maxW="md">
            We're sorry, but something unexpected happened. This might be due to a 
            network issue, server problem, or a temporary glitch.
          </Text>

          {error && (
            <Box
              bg="gray.50"
              p={4}
              borderRadius="md"
              textAlign="left"
              maxW="full"
              overflowX="auto"
            >
              <Text fontSize="sm" fontFamily="mono" color="gray.700">
                {error.message}
              </Text>
            </Box>
          )}

          <VStack spacing={3}>
            <Button
              leftIcon={<FiRefreshCw />}
              onClick={onRetry}
              colorScheme="blue"
              size="lg"
            >
              Try Again
            </Button>

            <Button
              leftIcon={<FiHome />}
              onClick={onGoHome}
              variant="outline"
              size="lg"
            >
              Go to Home
            </Button>
          </VStack>

          <Text fontSize="sm" color="gray.500">
            If the problem persists, please try refreshing the page or contact support.
          </Text>
        </VStack>
      </Box>
    </Container>
  );
};

export default ErrorBoundary;
