import axios from 'axios'
import { API_BASE_URL } from './api'

const logMeetupTestDebug = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.log(...args)
}

/**
 * MeetupSystemTester - Comprehensive testing utility for all meetup stage transitions
 * Tests all 6 primary methods of MeetupService to ensure correct behavior
 */

export interface TestResult {
  name: string
  passed: boolean
  duration: number
  error?: string
  details?: string
}

// Prefer the same normalized base URL as the main API client.
// If API_BASE_URL is '' in dev (proxy mode), use the direct backend address.
const API_BASE = API_BASE_URL || 'http://127.0.0.1:4000'

class MeetupSystemTester {
  private testTradeId: number = 0
  private results: TestResult[] = []

  /**
   * Initialize tester with a test trade ID
   */
  async initialize(tradeId: number): Promise<boolean> {
    try {
      this.testTradeId = tradeId
      const response = await axios.get(`${API_BASE}/api/trades/${tradeId}`)
      return response.data.success
    } catch (error) {
      console.error('Failed to initialize tester:', error)
      return false
    }
  }

  /**
   * Test 1: Propose Meetup Time (Negotiating → Scheduled if both match)
   */
  async testProposeMeetupTime(): Promise<TestResult> {
    const startTime = Date.now()
    const testName = 'ProposeMeetupTime'

    try {
      const futureTime = new Date()
      futureTime.setHours(futureTime.getHours() + 2)

      const response = await axios.post(
        `${API_BASE}/api/trades/${this.testTradeId}/meetup/propose`,
        {
          trade_id: this.testTradeId,
          proposed_time: futureTime.toISOString(),
          proposed_location: 'Test Location - Mall',
        }
      )

      const passed = response.data.success
      return {
        name: testName,
        passed,
        duration: Date.now() - startTime,
        details: passed
          ? 'Successfully proposed meetup time'
          : 'API returned false success',
      }
    } catch (error: any) {
      return {
        name: testName,
        passed: false,
        duration: Date.now() - startTime,
        error: error.response?.data?.error || error.message,
      }
    }
  }

  /**
   * Test 2: Confirm Meetup Schedule (Scheduled stage transition)
   */
  async testConfirmMeetupSchedule(): Promise<TestResult> {
    const startTime = Date.now()
    const testName = 'ConfirmMeetupSchedule'

    try {
      const response = await axios.post(
        `${API_BASE}/api/trades/${this.testTradeId}/meetup/confirm`,
        {
          trade_id: this.testTradeId,
        }
      )

      const passed = response.data.success && response.data.data?.stage === 'scheduled'
      return {
        name: testName,
        passed,
        duration: Date.now() - startTime,
        details: passed
          ? `Meetup confirmed and transitioned to scheduled stage`
          : 'Failed to confirm meetup schedule',
      }
    } catch (error: any) {
      return {
        name: testName,
        passed: false,
        duration: Date.now() - startTime,
        error: error.response?.data?.error || error.message,
      }
    }
  }

  /**
   * Test 3: Mark Heading Out (Scheduled → OnTheWay)
   */
  async testMarkHeadingOut(): Promise<TestResult> {
    const startTime = Date.now()
    const testName = 'MarkHeadingOut'

    try {
      const response = await axios.post(
        `${API_BASE}/api/trades/${this.testTradeId}/meetup/heading-out`,
        {
          trade_id: this.testTradeId,
        }
      )

      const passed = response.data.success && response.data.data?.stage === 'on_the_way'
      return {
        name: testName,
        passed,
        duration: Date.now() - startTime,
        details: passed
          ? 'Successfully marked user as heading out'
          : 'Failed to update heading out status',
      }
    } catch (error: any) {
      return {
        name: testName,
        passed: false,
        duration: Date.now() - startTime,
        error: error.response?.data?.error || error.message,
      }
    }
  }

  /**
   * Test 4: Mark Arrived (OnTheWay → Arrived)
   */
  async testMarkArrived(): Promise<TestResult> {
    const startTime = Date.now()
    const testName = 'MarkArrived'

    try {
      const response = await axios.post(
        `${API_BASE}/api/trades/${this.testTradeId}/meetup/arrived`,
        {
          trade_id: this.testTradeId,
        }
      )

      const passed = response.data.success && response.data.data?.stage === 'arrived'
      return {
        name: testName,
        passed,
        duration: Date.now() - startTime,
        details: passed
          ? 'Successfully marked user as arrived'
          : 'Failed to update arrival status',
      }
    } catch (error: any) {
      return {
        name: testName,
        passed: false,
        duration: Date.now() - startTime,
        error: error.response?.data?.error || error.message,
      }
    }
  }

  /**
   * Test 5: Confirm Completion (Arrived → Completed, requires both users)
   */
  async testConfirmCompletion(): Promise<TestResult> {
    const startTime = Date.now()
    const testName = 'ConfirmCompletion'

    try {
      const response = await axios.post(
        `${API_BASE}/api/trades/${this.testTradeId}/meetup/confirm-completion`,
        {
          trade_id: this.testTradeId,
        }
      )

      const passed =
        response.data.success &&
        (response.data.data?.stage === 'completed' || response.data.data?.state === 'completion_pending')
      return {
        name: testName,
        passed,
        duration: Date.now() - startTime,
        details: passed
          ? 'Successfully confirmed trade completion'
          : 'Trade completion confirmation pending other user',
      }
    } catch (error: any) {
      return {
        name: testName,
        passed: false,
        duration: Date.now() - startTime,
        error: error.response?.data?.error || error.message,
      }
    }
  }

  /**
   * Test 6: Report No-Show (Any stage → NoShow)
   */
  async testReportNoShow(): Promise<TestResult> {
    const startTime = Date.now()
    const testName = 'ReportNoShow'

    try {
      const response = await axios.post(
        `${API_BASE}/api/trades/${this.testTradeId}/meetup/report-no-show`,
        {
          trade_id: this.testTradeId,
          reason: 'seller_not_appeared',
          details: 'Test: Seller did not appear at the agreed meetup location',
        }
      )

      const passed = response.data.success && response.data.data?.stage === 'no_show'
      return {
        name: testName,
        passed,
        duration: Date.now() - startTime,
        details: passed
          ? 'Successfully reported no-show and notified support'
          : 'Failed to report no-show',
      }
    } catch (error: any) {
      return {
        name: testName,
        passed: false,
        duration: Date.now() - startTime,
        error: error.response?.data?.error || error.message,
      }
    }
  }

  /**
   * Test 7: Verify System Messages Created
   */
  async testSystemMessagesCreated(): Promise<TestResult> {
    const startTime = Date.now()
    const testName = 'VerifySystemMessages'

    try {
      const response = await axios.get(
        `${API_BASE}/api/trades/${this.testTradeId}/meetup/messages`
      )

      const messages = response.data.data || []
      const passed = Array.isArray(messages) && messages.length > 0
      return {
        name: testName,
        passed,
        duration: Date.now() - startTime,
        details: passed
          ? `Found ${messages.length} system messages in chat`
          : 'No system messages found',
      }
    } catch (error: any) {
      return {
        name: testName,
        passed: false,
        duration: Date.now() - startTime,
        error: error.response?.data?.error || error.message,
      }
    }
  }

  /**
   * Test 8: Verify Meetup Status Endpoint
   */
  async testGetMeetupStatus(): Promise<TestResult> {
    const startTime = Date.now()
    const testName = 'GetMeetupStatus'

    try {
      const response = await axios.get(
        `${API_BASE}/api/trades/${this.testTradeId}/meetup/status`
      )

      const status = response.data.data
      const passed =
        response.data.success &&
        status &&
        ['negotiating', 'scheduled', 'on_the_way', 'arrived', 'completed', 'no_show'].includes(
          status.stage
        )

      return {
        name: testName,
        passed,
        duration: Date.now() - startTime,
        details: passed ? `Current stage: ${status.stage}` : 'Invalid meetup status response',
      }
    } catch (error: any) {
      return {
        name: testName,
        passed: false,
        duration: Date.now() - startTime,
        error: error.response?.data?.error || error.message,
      }
    }
  }

  /**
   * Run all tests in sequence
   */
  async runAllTests(): Promise<TestResult[]> {
    this.results = []

    logMeetupTestDebug('🧪 Starting Meetup System Tests...')
    logMeetupTestDebug(`📋 Trade ID: ${this.testTradeId}`)

    // Run tests in sequence
    this.results.push(await this.testProposeMeetupTime())
    this.results.push(await this.testConfirmMeetupSchedule())
    this.results.push(await this.testMarkHeadingOut())
    this.results.push(await this.testMarkArrived())
    this.results.push(await this.testConfirmCompletion())
    this.results.push(await this.testReportNoShow())
    this.results.push(await this.testSystemMessagesCreated())
    this.results.push(await this.testGetMeetupStatus())

    return this.results
  }

  /**
   * Get test results summary
   */
  getResultsSummary(): {
    total: number
    passed: number
    failed: number
    averageDuration: number
    successRate: number
  } {
    const total = this.results.length
    const passed = this.results.filter(r => r.passed).length
    const failed = total - passed
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0)
    const averageDuration = totalDuration / total

    return {
      total,
      passed,
      failed,
      averageDuration: Math.round(averageDuration),
      successRate: Math.round((passed / total) * 100),
    }
  }

  /**
   * Print results to console in a formatted way
   */
  printResults(): void {
    logMeetupTestDebug('\n' + '='.repeat(60))
    logMeetupTestDebug('📊 MEETUP SYSTEM TEST RESULTS')
    logMeetupTestDebug('='.repeat(60))

    this.results.forEach((result, idx) => {
      const icon = result.passed ? '✅' : '❌'
      const status = result.passed ? 'PASS' : 'FAIL'
      logMeetupTestDebug(`\n${idx + 1}. ${icon} ${result.name} - ${status}`)
      logMeetupTestDebug(`   Duration: ${result.duration}ms`)
      if (result.details) logMeetupTestDebug(`   Details: ${result.details}`)
      if (result.error) logMeetupTestDebug(`   Error: ${result.error}`)
    })

    const summary = this.getResultsSummary()
    logMeetupTestDebug('\n' + '='.repeat(60))
    logMeetupTestDebug('📈 SUMMARY')
    logMeetupTestDebug('='.repeat(60))
    logMeetupTestDebug(`Total Tests: ${summary.total}`)
    logMeetupTestDebug(`Passed: ${summary.passed} ✅`)
    logMeetupTestDebug(`Failed: ${summary.failed} ❌`)
    logMeetupTestDebug(`Success Rate: ${summary.successRate}%`)
    logMeetupTestDebug(`Average Duration: ${summary.averageDuration}ms`)
    logMeetupTestDebug('='.repeat(60) + '\n')
  }

  /**
   * Export results as JSON
   */
  exportResultsJSON(): string {
    return JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        tradeId: this.testTradeId,
        results: this.results,
        summary: this.getResultsSummary(),
      },
      null,
      2
    )
  }
}

export default MeetupSystemTester

