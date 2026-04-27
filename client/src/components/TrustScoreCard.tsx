import React from 'react'
import {
  Box,
  Text,
  HStack,
  VStack,
  Icon,
  Tooltip,
  Badge,
  Progress,
  Divider,
} from '@chakra-ui/react'
import { FiCheckCircle, FiAlertTriangle, FiXCircle } from 'react-icons/fi'

interface TrustFactor {
  label: string
  status: 'pass' | 'warn' | 'fail'
  points: number
  max: number
}

interface ConductGrade {
  category: string
  avg: number
  count: number
}

interface ConductSummary {
  letter_grade: string
  overall_avg: number
  total_grades: number
  categories: ConductGrade[]
  cancellation_rate: number
  dispute_rate: number
}

interface TradeStats {
  successful: number
  cancelled: number
  pending: number
}

interface TrustScoreCardProps {
  score: number
  trustLevel?: 'trusted' | 'new' | 'risky'
  factors?: TrustFactor[]
  conductSummary?: ConductSummary
  compact?: boolean
  isVerified?: boolean
  listingCount?: number
  tradeCount?: number
  positivePercent?: number
  tradeStats?: TradeStats
  responseTime?: string
  hasActiveDispute?: boolean
  // New props for comprehensive profile card
  profileName?: string
  profileAvatar?: string
  memberSinceDate?: Date | string
  avgRating?: number
  reviewCount?: number
}

const statusConfig = {
  pass: { icon: FiCheckCircle, color: 'green.500', bg: 'green.50' },
  warn: { icon: FiAlertTriangle, color: 'orange.500', bg: 'orange.50' },
  fail: { icon: FiXCircle, color: 'red.500', bg: 'red.50' },
}

const getTrustLevel = (score: number) => {
  if (score >= 80) return 'trusted'
  if (score >= 60) return 'new'
  return 'risky'
}

const levelColor = (level: string) => {
  if (level === 'trusted') return 'green.500'
  if (level === 'new') return 'yellow.500'
  return 'red.500'
}

const levelTrackColor = (level: string) => {
  if (level === 'trusted') return 'green.100'
  if (level === 'new') return 'yellow.100'
  return 'red.100'
}

const levelLabelBadge = (level: string) => {
  if (level === 'trusted') return '🟢 Highly Trusted'
  if (level === 'new') return '🟡 Trusted'
  return '🔴 Needs Improvement'
}

const getImprovementHint = (label: string, points: number, max: number) => {
  if (points >= max) return "Excellent! You've secured maximum points for this category."
  if (label.includes("Verified")) return "Verify your account in settings to gain +15 pts."
  if (label.includes("Completed trades")) return "Successfully complete more trades to increase this score."
  if (label.includes("Positive ratings")) return "Gather more positive 5-star ratings from your trade partners."
  if (label.includes("Clean record") || label.includes("No reports")) return "Avoid cancellations and user reports by following through on accepted trades."
  if (label.includes("Response")) return "Reply to offers and messages on the same day to improve."
  if (label.includes("success")) return "Avoid cancelling trades you have already accepted."
  return "Improve this metric to boost your trust score."
}

const gradeColor = (grade: string) => {
  if (grade === 'A+' || grade === 'A') return 'green.500'
  if (grade === 'B+' || grade === 'B') return 'blue.500'
  if (grade === 'C') return 'orange.500'
  return 'red.500'
}

const gradeBg = (grade: string) => {
  if (grade === 'A+' || grade === 'A') return 'green.50'
  if (grade === 'B+' || grade === 'B') return 'blue.50'
  if (grade === 'C') return 'orange.50'
  return 'red.50'
}

const categoryBarColor = (avg: number) => {
  if (avg >= 4.0) return 'green'
  if (avg >= 3.0) return 'yellow'
  if (avg >= 2.0) return 'orange'
  return 'red'
}

const formatResponseTime = (raw?: string): { label: string; colorScheme: string } | null => {
  if (!raw || raw === 'N/A') return null
  const match = raw.match(/^(\d+)(m|h|d)$/)
  if (!match) return null
  const value = parseInt(match[1], 10)
  const unit = match[2]
  const totalMinutes = unit === 'm' ? value : unit === 'h' ? value * 60 : value * 1440
  if (totalMinutes < 1440) return { label: '⚡ Responds within hours', colorScheme: 'green' }
  if (totalMinutes < 4320) return { label: '⚡ Responds within a day', colorScheme: 'blue' }
  return { label: '🐢 Responds in a few days', colorScheme: 'orange' }
}

const TrustScoreCard: React.FC<TrustScoreCardProps> = ({ score, trustLevel, factors, conductSummary, compact, isVerified, listingCount, tradeCount, positivePercent, tradeStats, responseTime, hasActiveDispute, profileName, profileAvatar, memberSinceDate, avgRating, reviewCount }) => {
  const activeLevel = getTrustLevel(score)
  const responseInfo = formatResponseTime(responseTime)
  
  if (compact) {
    const tooltipContent = factors && factors.length > 0
      ? factors.map(f =>
          `${f.status === 'pass' ? '✔' : f.status === 'warn' ? '⚠' : '✘'} ${f.label} (${f.points}/${f.max})`
        ).join('\n')
      : `Trust Score: ${score}/100`
    const conductLine =
      conductSummary && conductSummary.total_grades > 0
        ? `\nConduct: ${conductSummary.letter_grade} (${conductSummary.overall_avg.toFixed(1)}/5)`
        : ''

    const levelLabel =
      activeLevel === 'trusted' ? 'Trusted trader' :
      activeLevel === 'new' ? 'Moderate trust' :
      'Needs improvement'

    const levelColorScheme =
      activeLevel === 'trusted' ? 'green' :
      activeLevel === 'new' ? 'yellow' : 'red'

    return (
      <Box w="100%">
        <HStack justify="space-between" mb={1}>
          <Text fontSize="sm" fontWeight="bold" color="gray.700">Trust Score</Text>
          <HStack spacing={2}>
            <Text fontSize="sm" fontWeight="bold" color="gray.800">{score}/100</Text>
            {hasActiveDispute && (
              <Tooltip label="User has an unresolved trade dispute." hasArrow>
                <Box as="span">
                  <Icon as={FiAlertTriangle} color="orange.500" boxSize={3.5} />
                </Box>
              </Tooltip>
            )}
          </HStack>
        </HStack>
        <Tooltip label={tooltipContent + conductLine} whiteSpace="pre-line" placement="top" hasArrow>
          <Progress
            value={score}
            size="sm"
            colorScheme={levelColorScheme}
            borderRadius="full"
            mb={2}
            cursor="default"
          />
        </Tooltip>
        <HStack spacing={2} align="center">
          <Badge colorScheme={levelColorScheme} fontSize="xs">
            {levelLabel}
          </Badge>
          {conductSummary && conductSummary.total_grades > 0 && (
            <Badge
              colorScheme={
                conductSummary.letter_grade.startsWith('A') ? 'green' :
                conductSummary.letter_grade.startsWith('B') ? 'blue' :
                conductSummary.letter_grade === 'C' ? 'orange' : 'red'
              }
              fontSize="xs"
            >
              Conduct: {conductSummary.letter_grade}
            </Badge>
          )}
        </HStack>
        <Text fontSize="xs" color="gray.400" mt={1.5}>
          Based on verification, completed trades, ratings, response speed, and trade success.
        </Text>
      </Box>
    )
  }

  // === NEW REDESIGNED LAYOUT ===
  // Single card, top to bottom. Clean, data-forward, no redundancy.
  
  return (
    <Box
      bg="white"
      border="1px"
      borderColor="gray.200"
      borderRadius="xl"
      p={6}
      shadow="sm"
      w="100%"
    >
      {/* HEADER ROW: Removed duplicate name/avatar display - shown in main profile header */}

      {/* FOUR STAT PILLS: Rating · Positive % · Trades · Avg Response */}
      <HStack spacing={2} mb={4} justify={{ base: 'start', sm: 'space-around' }} flexWrap="wrap">
        {typeof avgRating === 'number' && avgRating > 0 && (
          <VStack spacing={0.5} align="center" flex={{ base: '0 1 auto', sm: 1 }} minW="60px">
            <Text fontSize={{ base: 'md', sm: 'md' }} fontWeight="bold" color="gray.800">
              {avgRating.toFixed(1)}
            </Text>
            <Text fontSize={{ base: '10px', sm: 'xs' }} color="gray.600" textAlign="center">Rating</Text>
          </VStack>
        )}
        {typeof positivePercent === 'number' && (positivePercent > 0 || (reviewCount ?? 0) > 0) && (
          <VStack spacing={0.5} align="center" flex={{ base: '0 1 auto', sm: 1 }} minW="60px">
            <Text fontSize={{ base: 'md', sm: 'md' }} fontWeight="bold" color="gray.800">
              {Math.round(positivePercent)}%
            </Text>
            <Text fontSize={{ base: '10px', sm: 'xs' }} color="gray.600" textAlign="center">Positive</Text>
          </VStack>
        )}
        {typeof tradeCount === 'number' && (
          <VStack spacing={0.5} align="center" flex={{ base: '0 1 auto', sm: 1 }} minW="60px">
            <Text fontSize={{ base: 'md', sm: 'md' }} fontWeight="bold" color="gray.800">
              {tradeCount === 0 ? 'New' : tradeCount}
            </Text>
            <Text fontSize={{ base: '10px', sm: 'xs' }} color="gray.600" textAlign="center">{tradeCount === 0 ? 'Trader' : 'Trades'}</Text>
          </VStack>
        )}
        {responseTime && responseTime !== 'N/A' && (
          <VStack spacing={0.5} align="center" flex={{ base: '0 1 auto', sm: 1 }} minW="60px">
            <Text fontSize={{ base: 'md', sm: 'md' }} fontWeight="bold" color="gray.800">
              {responseTime}
            </Text>
            <Text fontSize={{ base: '10px', sm: 'xs' }} color="gray.600" textAlign="center">Response</Text>
          </VStack>
        )}
      </HStack>

      <Divider my={4} />

      {/* TRUST SCORE BREAKDOWN: Title with score, then six category bars */}
      <VStack align="stretch" spacing={4} mb={6}>
        <HStack justify="space-between" align="baseline">
          <Text fontSize="md" fontWeight="bold" color="gray.800">
            Trust score
          </Text>
          <Text fontSize="xl" fontWeight="bold" color="gray.900">
            {score}/100
          </Text>
        </HStack>

        {/* Six category bars with color-coded status */}
        {factors && factors.length > 0 ? (
          <VStack align="stretch" spacing={3}>
            {factors.map((f, i) => {
              const cfg = statusConfig[f.status]
              const colorScheme = f.status === 'pass' ? 'green' : f.status === 'warn' ? 'orange' : 'red'
              return (
                <Box key={i}>
                  <HStack justify="space-between" mb={1}>
                    <Text fontSize="sm" color="gray.700">
                      {f.label}
                    </Text>
                    <Text fontSize="xs" color="gray.500" fontWeight="medium">
                      {f.points}/{f.max}
                    </Text>
                  </HStack>
                  <Progress
                    value={(f.points / f.max) * 100}
                    size="sm"
                    colorScheme={colorScheme}
                    borderRadius="full"
                  />
                </Box>
              )
            })}
          </VStack>
        ) : (
          <Text fontSize="sm" color="gray.400">No data available</Text>
        )}
      </VStack>

      <Divider my={4} />

      {/* TRADE STATISTICS: Three numbers in one row, success rate below */}
      {tradeStats && (tradeStats.successful > 0 || tradeStats.cancelled > 0 || tradeStats.pending > 0) && (
        <VStack align="stretch" spacing={4}>
          <HStack spacing={4} justify="space-around">
            <VStack spacing={1} align="center" flex={1}>
              <Text fontSize="lg" fontWeight="bold" color="gray.800">
                {tradeStats.successful}
              </Text>
              <Text fontSize="xs" color="gray.600">Successful</Text>
            </VStack>
            <VStack spacing={1} align="center" flex={1}>
              <Text fontSize="lg" fontWeight="bold" color="gray.800">
                {tradeStats.cancelled}
              </Text>
              <Text fontSize="xs" color="gray.600">Cancelled</Text>
            </VStack>
            <VStack spacing={1} align="center" flex={1}>
              <Text fontSize="lg" fontWeight="bold" color="gray.800">
                {tradeStats.pending}
              </Text>
              <Text fontSize="xs" color="gray.600">Pending</Text>
            </VStack>
          </HStack>
        </VStack>
      )}
    </Box>
  )
}

export default TrustScoreCard
