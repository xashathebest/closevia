import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  Card,
  CardBody,
  Icon,
  Badge,
  Divider,
  Input,
  Textarea,
  useToast,
  Progress,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  SimpleGrid,
} from '@chakra-ui/react'
import { CheckCircleIcon, WarningIcon } from '@chakra-ui/icons'
import { FaMapMarkerAlt, FaQrcode, FaCamera, FaPhone, FaClock, FaDownload, FaSync } from 'react-icons/fa'

interface Task {
  id: string
  type: 'pickup' | 'delivery'
  status: 'pending' | 'in-progress' | 'completed'
  recipientName: string
  address: string
  contact: string
  itemCount: number
  notes: string
  timestamp?: string
}

const TaskStepper: React.FC = () => {
  const { batchId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  
  const [tasks, setTasks] = useState<Task[]>([
    {
      id: 'task-1',
      type: 'pickup',
      status: 'completed',
      recipientName: 'Juan Dela Cruz',
      address: '123 Makati Ave, Makati City',
      contact: '09171234567',
      itemCount: 2,
      notes: '2 boxes, fragile',
      timestamp: '10:15 AM',
    },
    {
      id: 'task-2',
      type: 'pickup',
      status: 'in-progress',
      recipientName: 'Maria Santos',
      address: '456 Paseo de Roxas, Makati City',
      contact: '09189876543',
      itemCount: 3,
      notes: '3 bags, perishable',
      timestamp: '',
    },
    {
      id: 'task-3',
      type: 'delivery',
      status: 'pending',
      recipientName: 'Robert Wong',
      address: '789 BGC Taguig City',
      contact: '09221234567',
      itemCount: 2,
      notes: 'Leave with security',
      timestamp: '',
    },
    {
      id: 'task-4',
      type: 'delivery',
      status: 'pending',
      recipientName: 'Ana Reyes',
      address: '321 Ortigas Avenue, Pasig City',
      contact: '09331234567',
      itemCount: 1,
      notes: 'Call upon arrival',
      timestamp: '',
    },
  ])

  const [currentTaskIndex, setCurrentTaskIndex] = useState(1) // Currently on pickup 2
  const [qrScanned, setQrScanned] = useState(false)
  const [photoCaptured, setPhotoCaptured] = useState(false)
  const [deliveryNotes, setDeliveryNotes] = useState('')
  const [isOffline, setIsOffline] = useState(false)

  const currentTask = tasks[currentTaskIndex]
  const completedCount = tasks.filter(t => t.status === 'completed').length
  const totalTasks = tasks.length

  const handleQrScan = () => {
    // Simulate QR scan
    setQrScanned(true)
    toast({
      title: 'QR Scanned ✓',
      description: 'Task verified at pickup location',
      status: 'success',
      duration: 2000,
    })
  }

  const handleCapturePhoto = () => {
    setPhotoCaptured(true)
    toast({
      title: 'Photo Saved',
      description: 'Proof of delivery captured',
      status: 'success',
      duration: 2000,
    })
  }

  const handleCompleteTask = () => {
    if (currentTask.type === 'delivery' && (!qrScanned && !deliveryNotes)) {
      toast({
        title: 'Missing Confirmation',
        description: 'Scan QR or add delivery notes',
        status: 'warning',
        duration: 2000,
      })
      return
    }

    const updatedTasks = [...tasks]
    updatedTasks[currentTaskIndex].status = 'completed'
    updatedTasks[currentTaskIndex].timestamp = new Date().toLocaleTimeString()
    setTasks(updatedTasks)

    if (currentTaskIndex < tasks.length - 1) {
      setCurrentTaskIndex(currentTaskIndex + 1)
      setQrScanned(false)
      setPhotoCaptured(false)
      setDeliveryNotes('')
      
      toast({
        title: 'Task Completed! ✓',
        description: 'Moving to next task...',
        status: 'success',
        duration: 2000,
      })
    } else {
      toast({
        title: 'Batch Complete! 🎉',
        description: 'All tasks delivered. Navigate to remittance.',
        status: 'success',
        duration: 2000,
      })
      navigate('/remittance-ledger')
    }
  }

  return (
    <Box minH="100vh" bg="#FFFDF1" py={6} px={4}>
      <VStack spacing={6} maxW="md" mx="auto">
        {/* Progress Bar */}
        <VStack spacing={2} w="full">
          <HStack justify="space-between" w="full">
            <Heading size="sm" color="gray.800">
              Progress
            </Heading>
            <Text fontSize="sm" fontWeight="bold" color="brand.600">
              {completedCount}/{totalTasks}
            </Text>
          </HStack>
          <Progress
            value={(completedCount / totalTasks) * 100}
            colorScheme="green"
            w="full"
            borderRadius="full"
            h="8px"
          />
        </VStack>

        {/* Task Stepper Timeline */}
        <Card bg="white" w="full" border="1px" borderColor="gray.200">
          <CardBody p={4}>
            <VStack spacing={0} align="stretch">
              {tasks.map((task, index) => (
                <VStack key={task.id} spacing={0} align="stretch" pb={index < tasks.length - 1 ? 4 : 0}>
                  {/* Task Item */}
                  <HStack
                    spacing={3}
                    p={2}
                    bg={index === currentTaskIndex ? 'brand.50' : 'transparent'}
                    borderRadius="md"
                    cursor={index <= currentTaskIndex ? 'pointer' : 'not-allowed'}
                    opacity={index <= currentTaskIndex ? 1 : 0.5}
                  >
                    {/* Status Icon */}
                    <Box
                      w="8"
                      h="8"
                      borderRadius="full"
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                      bg={
                        task.status === 'completed' ? 'green.100' :
                        task.status === 'in-progress' ? 'blue.100' :
                        'gray.100'
                      }
                      flexShrink={0}
                    >
                      <Icon
                        as={task.status === 'completed' ? CheckCircleIcon : WarningIcon}
                        color={
                          task.status === 'completed' ? 'green.600' :
                          task.status === 'in-progress' ? 'blue.600' :
                          'gray.400'
                        }
                        boxSize={5}
                      />
                    </Box>

                    {/* Task Details */}
                    <VStack align="start" spacing={0} flex={1}>
                      <Text fontWeight="bold" fontSize="sm" color="gray.800">
                        {task.type === 'pickup' ? '📍 Pickup' : '✓ Delivery'} {index + 1}
                      </Text>
                      <Text fontSize="xs" color="gray.600" noOfLines={1}>
                        {task.recipientName}
                      </Text>
                    </VStack>

                    {/* Time */}
                    {task.timestamp && (
                      <Badge colorScheme="green" fontSize="xs">
                        {task.timestamp}
                      </Badge>
                    )}
                  </HStack>

                  {/* Divider Line */}
                  {index < tasks.length - 1 && (
                    <Box h="20px" w="0.5" bg="gray.300" ml="4" my={2} />
                  )}
                </VStack>
              ))}
            </VStack>
          </CardBody>
        </Card>

        {/* Current Task Details */}
        <Card bg="white" w="full" border="2px" borderColor="blue.400">
          <CardBody>
            <VStack spacing={4} align="stretch">
              {/* Header */}
              <HStack justify="space-between">
                <VStack align="start" spacing={0}>
                  <Badge colorScheme="blue" fontSize="sm">
                    Current Task
                  </Badge>
                  <Text fontWeight="bold" fontSize="lg" color="gray.800">
                    {currentTask.type === 'pickup' ? '📍 Pickup' : '✓ Delivery'} {currentTaskIndex + 1}
                  </Text>
                </VStack>
                {isOffline && (
                  <Badge colorScheme="red">
                    🔴 Offline
                  </Badge>
                )}
              </HStack>

              <Divider />

              {/* Recipient Info */}
              <VStack spacing={2} align="stretch" bg="gray.50" p={3} borderRadius="md">
                <HStack justify="space-between">
                  <Text fontSize="sm" color="gray.600">Recipient:</Text>
                  <Text fontWeight="bold" fontSize="sm" color="gray.800">
                    {currentTask.recipientName}
                  </Text>
                </HStack>
                <HStack justify="space-between" align="start">
                  <Text fontSize="sm" color="gray.600">Address:</Text>
                  <Text fontWeight="bold" fontSize="sm" color="gray.800" textAlign="right">
                    {currentTask.address}
                  </Text>
                </HStack>
                <HStack justify="space-between">
                  <Text fontSize="sm" color="gray.600">Items:</Text>
                  <Badge colorScheme="purple">{currentTask.itemCount}</Badge>
                </HStack>
                <HStack justify="space-between">
                  <Text fontSize="sm" color="gray.600">Notes:</Text>
                  <Text fontSize="sm" color="gray.700" fontStyle="italic">
                    "{currentTask.notes}"
                  </Text>
                </HStack>
              </VStack>

              {/* Action Buttons */}
              <HStack spacing={2}>
                <Button
                  flex={1}
                  size="sm"
                  colorScheme="brand"
                  variant="outline"
                  leftIcon={<Icon as={FaPhone} />}
                >
                  Call
                </Button>
                <Button
                  flex={1}
                  size="sm"
                  colorScheme="brand"
                  variant="outline"
                  leftIcon={<Icon as={FaMapMarkerAlt} />}
                >
                  Map
                </Button>
              </HStack>

              <Divider />

              {/* Verification Tabs */}
              <Tabs variant="soft-rounded" colorScheme="brand" size="sm">
                <TabList>
                  <Tab>QR Scan</Tab>
                  <Tab>Photo</Tab>
                  <Tab>Confirm</Tab>
                </TabList>
                <TabPanels>
                  {/* QR Scan Tab */}
                  <TabPanel>
                    <VStack spacing={3} align="stretch">
                      <Button
                        colorScheme={qrScanned ? 'green' : 'brand'}
                        leftIcon={<Icon as={FaQrcode} />}
                        onClick={handleQrScan}
                        w="full"
                      >
                        {qrScanned ? '✓ QR Scanned' : 'Scan QR Code'}
                      </Button>
                      <Text fontSize="xs" color="gray.600" textAlign="center">
                        Point camera at task QR for verification
                      </Text>
                    </VStack>
                  </TabPanel>

                  {/* Photo Tab */}
                  <TabPanel>
                    <VStack spacing={3} align="stretch">
                      <Button
                        colorScheme={photoCaptured ? 'green' : 'brand'}
                        leftIcon={<Icon as={FaCamera} />}
                        onClick={handleCapturePhoto}
                        w="full"
                      >
                        {photoCaptured ? '✓ Photo Saved' : 'Capture Photo'}
                      </Button>
                      <Text fontSize="xs" color="gray.600" textAlign="center">
                        Take photo proof for records
                      </Text>
                    </VStack>
                  </TabPanel>

                  {/* Confirm Tab */}
                  <TabPanel>
                    <VStack spacing={3} align="stretch">
                      <Textarea
                        placeholder="Add delivery notes or recipient PIN..."
                        value={deliveryNotes}
                        onChange={(e) => setDeliveryNotes(e.target.value)}
                        size="sm"
                        rows={3}
                      />
                      <Text fontSize="xs" color="gray.600">
                        {qrScanned ? '✓ QR verified' : 'Or scan QR to auto-verify'}
                      </Text>
                    </VStack>
                  </TabPanel>
                </TabPanels>
              </Tabs>

              <Divider />

              {/* Complete Button */}
              <Button
                w="full"
                colorScheme="green"
                size="lg"
                onClick={handleCompleteTask}
                isDisabled={!qrScanned && !deliveryNotes}
              >
                ✓ Delivered — Recipient Confirmed
              </Button>

              {/* Offline Save */}
              {isOffline && (
                <Button
                  w="full"
                  variant="outline"
                  colorScheme="brand"
                  size="sm"
                  leftIcon={<Icon as={FaSync} />}
                >
                  Save & Sync When Online
                </Button>
              )}

              {/* Navigation Buttons */}
              <HStack spacing={2} w="full">
                <Button
                  flex={1}
                  size="sm"
                  variant="outline"
                  colorScheme="brand"
                  onClick={() => navigate('/rider')}
                >
                  Back to Jobs
                </Button>
                <Button
                  flex={1}
                  size="sm"
                  variant="outline"
                  colorScheme="brand"
                  onClick={() => navigate('/remittance-ledger')}
                >
                  Remittance
                </Button>
              </HStack>
            </VStack>
          </CardBody>
        </Card>
      </VStack>
    </Box>
  )
}

export default TaskStepper
