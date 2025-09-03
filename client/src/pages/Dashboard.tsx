import React, { useState, useEffect } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Box,
  Container,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  SimpleGrid,
  Card,
  CardBody,
  CardHeader,
  CardFooter,
  Badge,
  Image,
  Flex,
  Spinner,
  Center,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  useToast,
  IconButton,
  Avatar,
} from '@chakra-ui/react'
import { AddIcon, EditIcon, DeleteIcon, BellIcon, SettingsIcon } from '@chakra-ui/icons'
import { useAuth } from '../contexts/AuthContext'
import { useProducts } from '../contexts/ProductContext'
import { Product, Order } from '../types'
import { api } from '../services/api'
import { getFirstImage } from '../utils/imageUtils'

const Dashboard: React.FC = () => {
  const { user } = useAuth()
  const { getUserProducts, deleteProduct } = useProducts()
  const [userProducts, setUserProducts] = useState<Product[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState(0)
  const toast = useToast()

  useEffect(() => {
    if (user) {
      fetchUserData()
    }
  }, [user])

  const fetchUserData = async () => {
    if (!user) return
    
    setLoading(true)
    try {
      // Fetch user products
      const productsResponse = await getUserProducts(user.id)
      setUserProducts(productsResponse.data)

      // Fetch user orders
      const ordersResponse = await api.get('/api/orders?type=bought')
      setOrders(ordersResponse.data.data.data)
    } catch (error) {
      console.error('Failed to fetch user data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteProduct = async (productId: number) => {
    if (window.confirm('Are you sure you want to delete this product?')) {
      try {
        await deleteProduct(productId)
        setUserProducts(prev => prev.filter(p => p.id !== productId))
        toast({
          title: 'Product deleted',
          description: 'Product has been successfully deleted',
          status: 'success',
          duration: 3000,
          isClosable: true,
        })
      } catch (error: any) {
        toast({
          title: 'Error',
          description: error.message || 'Failed to delete product',
          status: 'error',
          duration: 3000,
          isClosable: true,
        })
      }
    }
  }

  if (loading) {
    return (
      <Center h="50vh">
        <Spinner size="xl" color="brand.500" />
      </Center>
    )
  }

  return (
    <Container maxW="container.xl" py={8} bg="#FFFDF1" minH="100vh">
      <VStack spacing={8} align="stretch">
        {/* Header + Action in one row */}
        <Flex
          align="center"
          justify="space-between"
          rounded="lg"
          flexWrap="wrap"
        >
          <Box textAlign="left" mr={4}>
            <Heading size="md" color="brand.500" mb={2}>
              Welcome, {user?.name}!
            </Heading>
            <Text color="gray.600">
              Manage your products, orders, and profile
            </Text>
          </Box>

          <Box>
            <HStack spacing={3} align="center">
              <Button
                as={RouterLink}
                to="/add-product"
                leftIcon={<AddIcon />}
                colorScheme="brand"
                size="lg"
                bg="#FFFDF1"
                _hover={{ bg: '#f7f4ea' }}
              >
                Add New Product
              </Button>

              <IconButton
                aria-label="Notifications"
                icon={<BellIcon />}
                size="lg"
                bg="#FFFDF1"
                _hover={{ bg: '#f7f4ea' }}
              />

              <IconButton
                aria-label="Settings"
                icon={<SettingsIcon />}
                size="lg"
                bg="#FFFDF1"
                _hover={{ bg: '#f7f4ea' }}
              />

              <Avatar name={user?.name || 'User'} size="sm" bg="#FFFDF1" />
            </HStack>
          </Box>
        </Flex>

        {/* Stats */}
        <SimpleGrid columns={{ base: 1, md: 3 }} spacing={6}>
          <Card>
            <CardBody textAlign="center">
              <Stat>
                <StatLabel>Total Products</StatLabel>
                <StatNumber>{userProducts.length}</StatNumber>
                <StatHelpText>Your listings</StatHelpText>
              </Stat>
            </CardBody>
          </Card>
          
          <Card>
            <CardBody textAlign="center">
              <Stat>
                <StatLabel>Active Orders</StatLabel>
                <StatNumber>{orders.filter(o => o.status === 'pending').length}</StatNumber>
                <StatHelpText>Pending transactions</StatHelpText>
              </Stat>
            </CardBody>
          </Card>
          
          <Card>
            <CardBody textAlign="center">
              <Stat>
                <StatLabel>Premium Listings</StatLabel>
                <StatNumber>{userProducts.filter(p => p.premium).length}</StatNumber>
                <StatHelpText>Featured products</StatHelpText>
              </Stat>
            </CardBody>
          </Card>
        </SimpleGrid>

        {/* Quick Actions */}

        {/* Tabs */}
        <Box bg="white" rounded="lg" shadow="sm">
          <Tabs index={activeTab} onChange={setActiveTab}>
            <TabList>
              <Tab>My Products</Tab>
              <Tab>My Orders</Tab>
            </TabList>

            <TabPanels>
              {/* Products Tab */}
              <TabPanel>
                <VStack spacing={4} align="stretch">
                  <Heading size="md" mb={4}>
                    My Products ({userProducts.length})
                  </Heading>
                  
                  {userProducts.length === 0 ? (
                    <Box textAlign="center" py={8}>
                      <Text color="gray.500" mb={4}>
                        You haven't added any products yet.
                      </Text>
                      <Button
                        as={RouterLink}
                        to="/add-product"
                        colorScheme="brand"
                        leftIcon={<AddIcon />}
                      >
                        Add Your First Product
                      </Button>
                    </Box>
                  ) : (
                    <SimpleGrid columns={{ base: 1, md: 2, lg: 5 }} spacing={6}>
                      {userProducts.map((product) => (
                        <Card key={product.id}>
                          <Image
                            src={getFirstImage(product.image_urls)}
                            alt={product.title}
                            w="full"
                            h="auto"
                            loading="lazy"
                            fallbackSrc="https://via.placeholder.com/300x200?text=No+Image"
                          />
                          <CardHeader>
                            <Flex justify="space-between" align="start">
                              <Heading size="md" noOfLines={2}>
                                {product.title}
                              </Heading>
                              {product.premium && (
                                <Badge colorScheme="yellow">Premium</Badge>
                              )}
                            </Flex>
                            <Text color="gray.600" noOfLines={2}>
                              {product.description}
                            </Text>
                          </CardHeader>
                          <CardBody pt={0}>
                            <Text fontSize="2xl" fontWeight="bold" color="brand.500">
                              {product.allow_buying && !product.barter_only && product.price
                                ? `₱${product.price.toFixed(2)}`
                                : 'Barter Only'}
                            </Text>
                            <Badge
                              colorScheme={product.status === 'available' ? 'green' : 'red'}
                              mt={2}
                            >
                              {product.status}
                            </Badge>
                          </CardBody>
                          <CardFooter>
                            <HStack spacing={2} w="full">
                              <Button
                                as={RouterLink}
                                to={`/edit-product/${product.id}`}
                                leftIcon={<EditIcon />}
                                variant="outline"
                                colorScheme="brand"
                                size="sm"
                                flex={1}
                              >
                                Edit
                              </Button>
                              <Button
                                leftIcon={<DeleteIcon />}
                                variant="outline"
                                colorScheme="red"
                                size="sm"
                                flex={1}
                                onClick={() => handleDeleteProduct(product.id)}
                              >
                                Delete
                              </Button>
                            </HStack>
                          </CardFooter>
                        </Card>
                      ))}
                    </SimpleGrid>
                  )}
                </VStack>
              </TabPanel>

              {/* Orders Tab */}
              <TabPanel>
                <VStack spacing={4} align="stretch">
                  <Heading size="md" mb={4}>
                    My Orders ({orders.length})
                  </Heading>
                  
                  {orders.length === 0 ? (
                    <Box textAlign="center" py={8}>
                      <Text color="gray.500">
                        You haven't placed any orders yet.
                      </Text>
                    </Box>
                  ) : (
                    <VStack spacing={4} align="stretch">
                      {orders.map((order) => (
                        <Card key={order.id}>
                          <CardBody>
                            <Flex justify="space-between" align="center">
                              <VStack align="start" spacing={2}>
                                <Text fontWeight="bold">
                                  {order.product?.title}
                                </Text>
                                <Text color="gray.600">
                                  ₱{order.product?.price ? order.product.price.toFixed(2) : '0.00'}
                                </Text>
                                <Text fontSize="sm" color="gray.500">
                                  Ordered on {new Date(order.created_at).toLocaleDateString()}
                                </Text>
                              </VStack>
                              <Badge
                                colorScheme={
                                  order.status === 'completed' ? 'green' :
                                  order.status === 'cancelled' ? 'red' : 'yellow'
                                }
                                size="lg"
                              >
                                {order.status}
                              </Badge>
                            </Flex>
                          </CardBody>
                        </Card>
                      ))}
                    </VStack>
                  )}
                </VStack>
              </TabPanel>
            </TabPanels>
          </Tabs>
        </Box>
      </VStack>
    </Container>
  )
}

export default Dashboard
