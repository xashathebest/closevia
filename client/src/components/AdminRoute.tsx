import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Spinner, Center, Text, VStack } from '@chakra-ui/react';

interface AdminRouteProps {
  children: React.ReactNode;
}

const AdminRoute: React.FC<AdminRouteProps> = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading && !user) {
    return (
      <Center minH="100vh" bg="gray.50">
        <VStack spacing={4} bg="white" borderWidth="1px" borderColor="gray.100" borderRadius="xl" px={8} py={7} boxShadow="sm">
          <Spinner size="lg" color="brand.500" />
          <Text color="gray.600" fontWeight="600">Checking admin access...</Text>
        </VStack>
      </Center>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

export default AdminRoute;
