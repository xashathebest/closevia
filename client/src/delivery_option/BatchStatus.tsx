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
  Badge,
  Icon,
  Progress,
  Divider,
  Stepper,
  Step,
  StepIndicator,
  StepStatus,
  StepIcon,
  StepNumber,
  useToast,
} from '@chakra-ui/react'
import { CheckCircleIcon } from '@chakra-ui/icons'
import { FaCheckCircle, FaTruck, FaBox, FaMapMarkerAlt, FaClock } from 'react-icons/fa'

interface BatchJob {
  id: string
  itemType: string
  status: 'pending' | 'picked_up' | 'in_transit' | 'delivered'
  sender: string
  recipient: string
  pickupLocation: string
  dropoffLocation: string
  fee: number
  timestamp?: string
}

const BatchStatus: React.FC = () => {
  const { batchId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()

  const [batch] = useState({
    id: batchId,
    type: 'standard',
    totalJobs: 3,
    completedJobs: 1,
    totalEarnings: 90,
  })

  const [jobs, setJobs] = useState<BatchJob[]>([
    {
      id: 'job-001',
      itemType: 'Books',
      status: 'delivered',
      sender: 'Juan Dela Cruz',
      recipient: 'Maria Santos',
      pickupLocation: '123 Makati Ave',
      dropoffLocation: '456 Paseo de Roxas',
      fee: 30,
      timestamp: '10:45 AM',
    },
    {
      id: 'job-002',
      itemType: 'Clothing',
      status: 'in_transit',
      sender: 'Robert Wong',
      recipient: 'Ana Reyes',
      pickupLocation: '789 BGC',
      dropoffLocation: '321 Ortigas',
      fee: 30,
      timestamp: '',
    },
    {
      id: 'job-003',
      itemType: 'Electronics',
      status: 'pending',
      sender: 'Lisa Chen',
      recipient: 'Carlos Martinez',
      pickupLocation: '555 Makati Central',
      dropoffLocation: '888 BGC Tower',
      fee: 30,
      timestamp: '',
    },
  ])

  const statusSteps = ['Pending', 'Picked Up', 'In Transit', 'Delivered']
  const statusIndex = (status: string) => {
    switch (status) {
      case 'pending':
        return 0
      case 'picked_up':
        return 1
      case 'in_transit':
        return 2
      case 'delivered':
        return 3
      default:
        return 0
    }
  }

  const handleUpdateStatus = (jobId: string, newStatus: BatchJob['status']) => {
    setJobs(prevJobs =>
      prevJobs.map(job =>
        job.id === jobId
          ? {
              ...job,
              status: newStatus,
              timestamp: newStatus === 'delivered' ? new Date().toLocaleTimeString() : job.timestamp,
            }
          : job
      )
    )

    toast({
      title: `✓ ${jobId} updated`,
      status: 'success',
      duration: 2000,
    })
  }

  const completedCount = jobs.filter(j => j.status === 'delivered').length

  return (
    <Box minH="100vh" bg="#FFFDF1" py={6} px={4}>
      <VStack spacing={4} maxW="md" mx="auto">
        {/* Header */}
        <VStack spacing={1} w="full">
          <Heading size="md" color="brand.500">
            Batch {batchId?.slice(-4)}
          </Heading>
          <Text fontSize="sm" color="gray.600">
            {completedCount}/{batch.totalJobs} completed
          </Text>
        </VStack>

        {/* Progress */}
        <Card bg="white" w="full">
          <CardBody p={3}>
            <VStack spacing={2} align="stretch">
              <HStack justify="space-between">
                <Text fontSize="sm" fontWeight="bold">
                  Batch Progress
                </Text>
                <Text fontSize="sm" fontWeight="bold" color="brand.600">
                  {Math.round((completedCount / batch.totalJobs) * 100)}%
                </Text>
              </HStack>
              <Progress
                value={(completedCount / batch.totalJobs) * 100}
                colorScheme="green"
                borderRadius="full"
                h="8px"
              />
              <HStack justify="space-between" fontSize="xs" color="gray.600">
                <Text>Total Earnings: ₱{batch.totalEarnings}</Text>
                <Text>Status: {completedCount === batch.totalJobs ? '✓ Complete' : 'In Progress'}</Text>
              </HStack>
            </VStack>
          </CardBody>
        </Card>

        {/* Jobs List */}
        <VStack spacing={3} align="stretch" w="full">
          {jobs.map((job, idx) => (
            <Card key={job.id} bg={job.status === 'delivered' ? 'green.50' : 'white'} border="1px" borderColor="gray.200">
              <CardBody p={3}>
                <VStack spacing={2} align="stretch">
                  {/* Header */}
                  <HStack justify="space-between" align="start">
                    <VStack align="start" spacing={0}>
                      <Text fontWeight="bold" fontSize="sm">
                        Job {idx + 1}: {job.itemType}
                      </Text>
                      <Text fontSize="2xs" color="gray.600">
                        {job.sender} → {job.recipient}
                      </Text>
                    </VStack>
                    <Badge colorScheme={job.status === 'delivered' ? 'green' : 'gray'}>
                      ₱{job.fee}
                    </Badge>
                  </HStack>

                  <Divider />

                  {/* Status Stepper */}
                  <Stepper size="sm" index={statusIndex(job.status)} colorScheme="green">
                    {statusSteps.map((step, idx) => (
                      <Step key={idx}>
                        <StepIndicator h="6" w="6">
                          <StepStatus complete={<StepIcon />} incomplete={<StepNumber />} active={<StepNumber />} />
                        </StepIndicator>
                      </Step>
                    ))}
                  </Stepper>

                  {/* Quick Actions */}
                  {job.status !== 'delivered' && (
                    <HStack spacing={2}>
                      {job.status === 'pending' && (
                        <Button
                          size="xs"
                          colorScheme="brand"
                          flex={1}
                          onClick={() => handleUpdateStatus(job.id, 'picked_up')}
                        >
                          Picked Up
                        </Button>
                      )}
                      {job.status === 'picked_up' && (
                        <Button
                          size="xs"
                          colorScheme="blue"
                          flex={1}
                          onClick={() => handleUpdateStatus(job.id, 'in_transit')}
                        >
                          In Transit
                        </Button>
                      )}
                      {job.status === 'in_transit' && (
                        <Button
                          size="xs"
                          colorScheme="green"
                          flex={1}
                          onClick={() => handleUpdateStatus(job.id, 'delivered')}
                        >
                          Delivered
                        </Button>
                      )}
                    </HStack>
                  )}

                  {job.status === 'delivered' && (
                    <HStack spacing={1} p={2} bg="green.100" borderRadius="md">
                      <Icon as={FaCheckCircle} color="green.600" boxSize={4} />
                      <Text fontSize="xs" fontWeight="bold" color="green.700">
                        Delivered {job.timestamp}
                      </Text>
                    </HStack>
                  )}
                </VStack>
              </CardBody>
            </Card>
          ))}
        </VStack>

        {/* Complete Batch Button */}
        {completedCount === batch.totalJobs && (
          <Button w="full" colorScheme="green" size="lg" onClick={() => navigate('/rider/queue')}>
            ✓ Batch Complete — Claim New Job
          </Button>
        )}

        {/* Back Button */}
        <Button w="full" variant="outline" onClick={() => navigate('/rider/jobs')}>
          Back to Deliveries
        </Button>
      </VStack>
    </Box>
  )
}

export default BatchStatus
