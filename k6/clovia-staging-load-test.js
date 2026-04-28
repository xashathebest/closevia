import http from 'k6/http'
import { check, fail, sleep } from 'k6'
import encoding from 'k6/encoding'
import { Counter, Gauge, Rate, Trend } from 'k6/metrics'

const ROOT_URL = (__ENV.ROOT_URL || 'http://localhost:4000').replace(/\/$/, '')
const API_URL = (__ENV.API_URL || `${ROOT_URL}/api`).replace(/\/$/, '')
const ENVIRONMENT = __ENV.ENVIRONMENT || ''
const CONFIRM = __ENV.STAGING_CONFIRM || ''
const PASSWORD = __ENV.LOAD_TEST_PASSWORD || 'password'

const responseTime = new Trend('clovia_response_time_ms')
const apiErrors = new Rate('clovia_api_error_rate')
const duplicateOfferRejections = new Counter('clovia_duplicate_offer_rejections')
const duplicateTradeRisk = new Counter('clovia_duplicate_trade_risk')
const stuckPendingTrades = new Gauge('clovia_stuck_pending_trades')
const sseDroppedEvents = new Gauge('clovia_sse_dropped_events')
const workerQueueDepth = new Gauge('clovia_worker_queue_depth')
const workerDroppedJobs = new Gauge('clovia_worker_dropped_jobs')
const missedNotificationRisk = new Counter('clovia_missed_notification_risk')
const tinyPng = encoding.b64decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'std'
)

export const options = {
  scenarios: {
    homepage_browsing: {
      executor: 'constant-vus',
      vus: Number(__ENV.HOMEPAGE_VUS || 50),
      duration: __ENV.HOMEPAGE_DURATION || '1m',
      exec: 'homepageBrowsing',
    },
    product_detail_fetch: {
      executor: 'constant-vus',
      vus: Number(__ENV.PRODUCT_DETAIL_VUS || 20),
      duration: __ENV.PRODUCT_DETAIL_DURATION || '1m',
      exec: 'productDetailFetch',
      startTime: '5s',
    },
    product_pagination: {
      executor: 'constant-vus',
      vus: Number(__ENV.PAGINATION_VUS || 10),
      duration: __ENV.PAGINATION_DURATION || '1m',
      exec: 'productPagination',
      startTime: '10s',
    },
    offer_creation_race: {
      executor: 'shared-iterations',
      vus: Number(__ENV.OFFER_RACE_VUS || 12),
      iterations: Number(__ENV.OFFER_RACE_ITERATIONS || 48),
      exec: 'offerCreationRace',
      startTime: '20s',
    },
    simultaneous_trade_acceptance: {
      executor: 'shared-iterations',
      vus: Number(__ENV.ACCEPT_RACE_VUS || 8),
      iterations: Number(__ENV.ACCEPT_RACE_ITERATIONS || 24),
      exec: 'simultaneousTradeAcceptance',
      startTime: '30s',
    },
    rapid_chat_messages: {
      executor: 'constant-vus',
      vus: Number(__ENV.CHAT_VUS || 10),
      duration: __ENV.CHAT_DURATION || '45s',
      exec: 'rapidChatMessages',
      startTime: '40s',
    },
    upload_bursts: {
      executor: 'constant-vus',
      vus: Number(__ENV.UPLOAD_VUS || 8),
      duration: __ENV.UPLOAD_DURATION || '45s',
      exec: 'uploadBursts',
      startTime: '50s',
    },
    sse_notification_fanout: {
      executor: 'constant-vus',
      vus: Number(__ENV.SSE_VUS || 10),
      duration: __ENV.SSE_DURATION || '45s',
      exec: 'sseNotificationFanout',
      startTime: '55s',
    },
    health_metrics_probe: {
      executor: 'constant-vus',
      vus: 1,
      duration: __ENV.METRICS_DURATION || '2m',
      exec: 'healthMetricsProbe',
    },
  },
  thresholds: {
    clovia_api_error_rate: ['rate<0.05'],
    http_req_duration: ['p(95)<1000', 'p(99)<2500'],
    clovia_duplicate_trade_risk: ['count==0'],
  },
}

function assertSafeTarget() {
  const lower = `${ROOT_URL} ${API_URL}`.toLowerCase()
  const looksProduction = /cloviaph\.site|clovia-backend\.onrender\.com|production|prod/.test(lower)
  const looksStaging = /localhost|127\.0\.0\.1|staging|test|dev/.test(lower)
  if (ENVIRONMENT !== 'staging') {
    fail('Set ENVIRONMENT=staging to run this load test.')
  }
  if (CONFIRM !== 'I_UNDERSTAND_THIS_IS_DISPOSABLE_STAGING') {
    fail('Set STAGING_CONFIRM=I_UNDERSTAND_THIS_IS_DISPOSABLE_STAGING.')
  }
  if (looksProduction || !looksStaging) {
    fail(`Refusing unsafe target. ROOT_URL=${ROOT_URL} API_URL=${API_URL}`)
  }
}

function record(res) {
  if (!res) {
    apiErrors.add(1)
    return null
  }
  responseTime.add(res.timings.duration)
  apiErrors.add(res.status >= 400 ? 1 : 0)
  return res
}

function get(path, token = null, root = false, params = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  return record(http.get(`${root ? ROOT_URL : API_URL}${path}`, { headers, timeout: '30s', ...params }))
}

function post(path, body, token = null, params = {}) {
  const headers = token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
  return record(http.post(`${API_URL}${path}`, JSON.stringify(body), { headers, timeout: '30s', ...params }))
}

function put(path, body, token = null) {
  const headers = token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
  return record(http.put(`${API_URL}${path}`, JSON.stringify(body), { headers, timeout: '30s' }))
}

function parseJSON(res, fallback = null) {
  try {
    return res && res.body ? JSON.parse(res.body) : fallback
  } catch {
    return fallback
  }
}

function unwrapData(body) {
  if (Array.isArray(body)) return body
  if (Array.isArray(body?.data)) return body.data
  if (Array.isArray(body?.data?.products)) return body.data.products
  if (Array.isArray(body?.products)) return body.products
  return []
}

function login(index) {
  const userNo = ((index - 1) % 60) + 1
  const res = post('/auth/login', {
    email: `clovia_loadtest_user_${userNo}@example.test`,
    password: PASSWORD,
  })
  const body = parseJSON(res, {})
  const token = body?.data?.token || body?.token
  const userId = Number(body?.data?.user?.id || body?.user?.id || 0)
  check(res, { 'login ok': r => r && r.status === 200 && !!token })
  return { token, userNo, userId }
}

function seededProducts(limit = 100) {
  const res = get(`/products?limit=${limit}&page=1`)
  check(res, { 'products list ok': r => r && r.status === 200 })
  return unwrapData(parseJSON(res, {})).filter(p => String(p.title || '').startsWith('clovia_loadtest_product_'))
}

function seededTrades(token) {
  const res = get('/trades?include=products&limit=100', token)
  check(res, { 'trades list ok': r => r && r.status === 200 })
  return unwrapData(parseJSON(res, {})).filter(t => String(t.message || '').startsWith('clovia_loadtest_offer_'))
}

export function setup() {
  assertSafeTarget()

  const health = get('/health', null, true)
  const version = get('/api/version', null, true)
  const ready = get('/readyz', null, true)

  check(health, { 'root health ok': r => r && r.status === 200 })
  check(version, { 'api version ok': r => r && r.status === 200 })
  check(ready, { 'readyz reachable': r => r && [200, 503].includes(r.status) })

  const users = []
  for (let i = 1; i <= 12; i += 1) {
    const auth = login(i)
    if (auth.token) users.push(auth)
  }
  if (users.length < 4) fail('Need at least 4 seeded staging users. Run scripts/staging_seed.sql.')

  const products = seededProducts(120)
  if (products.length < 20) fail('Need seeded staging products. Run scripts/staging_seed.sql.')

  const raceBuyer = login(1)
  const raceSellerProduct = products.find(p => Number(p.seller_id) !== Number(raceBuyer.userId)) || products[0]
  const buyerProduct = products.find(p => Number(p.seller_id) === Number(raceBuyer.userId)) || products[1]
  const raceSeller = users.find(u => Number(u.userId) === Number(raceSellerProduct.seller_id)) || null

  return { users, products, raceBuyer, raceSeller, raceSellerProduct, buyerProduct }
}

export function homepageBrowsing(data) {
  get('/products?limit=24&page=1')
  get('/products?limit=24&page=2')
  sleep(Math.random() * 0.8)
}

export function productDetailFetch(data) {
  const product = data.products[(__VU + __ITER) % data.products.length]
  get(`/products/${product.id}`)
  sleep(Math.random() * 0.6)
}

export function productPagination() {
  const page = ((__ITER % 5) + 1)
  get(`/products?limit=24&page=${page}`)
  sleep(0.25)
}

export function offerCreationRace(data) {
  const buyer = data.raceBuyer
  if (!buyer?.token) return
  const payload = {
    target_product_id: Number(data.raceSellerProduct.id),
    offered_product_ids: [Number(data.buyerProduct.id)],
    message: `clovia_loadtest_race_offer_${__ITER}`,
    trade_option: 'meetup',
    meeting_type: 'meetup',
    meetup_location: 'Clovia staging race meetup',
    meetup_date: '2030-01-01',
    meetup_time: '10:00',
  }
  const res = post('/trades', payload, buyer.token)
  if (res && res.status === 409) duplicateOfferRejections.add(1)
  if (res && ![201, 400, 403, 409].includes(res.status)) duplicateTradeRisk.add(1)
  if (res && res.status === 201 && data.raceSeller?.token) {
    const notifications = get('/notifications?limit=10', data.raceSeller.token)
    const rows = unwrapData(parseJSON(notifications, {}))
    const sawOfferNotification = rows.some(n => String(n.type || '') === 'trade_offer')
    if (!sawOfferNotification) missedNotificationRisk.add(1)
  }
}

export function simultaneousTradeAcceptance(data) {
  const auth = login((__VU % 12) + 1)
  if (!auth.token) return
  const trades = seededTrades(auth.token).filter(t => ['pending', 'accepted_by_one', 'accepted'].includes(String(t.status || '').toLowerCase()))
  if (trades.length === 0) return
  const trade = trades[__ITER % trades.length]
  const res = put(`/trades/${trade.id}`, { action: 'accept', message: 'clovia_loadtest_accept_race' }, auth.token)
  check(res, { 'accept status expected': r => r && [200, 400, 403, 404, 409].includes(r.status) })
}

export function rapidChatMessages(data) {
  const auth = login((__VU % 12) + 1)
  if (!auth.token) return
  const trades = seededTrades(auth.token)
  if (trades.length === 0) return
  const trade = trades[__ITER % trades.length]
  const msg = post(`/trades/${trade.id}/messages`, { content: `clovia_loadtest_chat_${__VU}_${__ITER}` }, auth.token)
  check(msg, { 'trade chat message accepted': r => r && [200, 201, 400, 403, 404].includes(r.status) })
}

export function uploadBursts(data) {
  const auth = login((__VU % 12) + 1)
  if (!auth.token) return
  const form = {
    image: http.file(tinyPng, `clovia-loadtest-${__VU}-${__ITER}.png`, 'image/png'),
    type: 'loadtest',
  }
  const res = record(http.post(`${API_URL}/upload`, form, {
    headers: { Authorization: `Bearer ${auth.token}` },
    timeout: '45s',
  }))
  check(res, { 'upload expected': r => r && [200, 201, 400, 413, 415, 503].includes(r.status) })
}

export function sseNotificationFanout(data) {
  const auth = login((__VU % 12) + 1)
  if (!auth.token) return
  const res = get('/chat/stream', auth.token, false, { timeout: '15s', responseType: 'text' })
  check(res, { 'sse connected or timed out after stream': r => r && [200, 408, 499, 504].includes(r.status) })
}

export function healthMetricsProbe() {
  const ready = get('/readyz', null, true)
  const body = parseJSON(ready, {})
  const sse = body?.sse || {}
  const workers = body?.components?.workers?.detail || body?.components?.workers || {}
  sseDroppedEvents.add(Number(sse.dropped_events || 0))
  workerQueueDepth.add(Number(workers.queue_depth || 0))
  workerDroppedJobs.add(Number(workers.total_dropped || 0))

  const stuck = get('/api/trades/count', null, true)
  if (stuck && stuck.status >= 500) stuckPendingTrades.add(1)
  sleep(5)
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify(data.metrics, null, 2),
    'tmp/clovia-staging-load-summary.json': JSON.stringify(data, null, 2),
  }
}
