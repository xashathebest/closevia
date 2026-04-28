package middleware

import (
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
)

// userCounter tracks request counts within a sliding window for one identity.
type userCounter struct {
	mu          sync.Mutex
	count       int
	windowStart time.Time
}

// allowed returns true if this request fits within the rate limit.
func (c *userCounter) allowed(max int, window time.Duration) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	if now.Sub(c.windowStart) >= window {
		// New window — reset.
		c.count = 0
		c.windowStart = now
	}
	if c.count >= max {
		return false
	}
	c.count++
	return true
}

// userRateLimiter is a map of identity -> counter.
type userRateLimiter struct {
	mu       sync.RWMutex
	counters map[string]*userCounter
	window   time.Duration
	max      int
}

func newUserRateLimiter(max int, window time.Duration) *userRateLimiter {
	l := &userRateLimiter{
		counters: make(map[string]*userCounter),
		window:   window,
		max:      max,
	}
	// Periodically remove counters for identities we haven't seen in a while
	// so the map doesn't grow indefinitely.
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			l.evict()
		}
	}()
	return l
}

func (l *userRateLimiter) evict() {
	cutoff := time.Now().Add(-l.window * 2)
	l.mu.Lock()
	defer l.mu.Unlock()
	for k, c := range l.counters {
		c.mu.Lock()
		stale := c.windowStart.Before(cutoff)
		c.mu.Unlock()
		if stale {
			delete(l.counters, k)
		}
	}
}

func (l *userRateLimiter) getOrCreate(key string) *userCounter {
	l.mu.RLock()
	c, ok := l.counters[key]
	l.mu.RUnlock()
	if ok {
		return c
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if c, ok = l.counters[key]; ok {
		return c
	}
	c = &userCounter{windowStart: time.Now()}
	l.counters[key] = c
	return c
}

func (l *userRateLimiter) allow(key string) bool {
	return l.getOrCreate(key).allowed(l.max, l.window)
}

// PerUserLimiter returns a Fiber middleware that enforces per-user rate limits.
//
//	max    — maximum requests allowed per window for one identity
//	window — sliding window duration (e.g. time.Minute)
//	msg    — friendly message returned when the limit is exceeded
//
// Identity is resolved as:
//  1. JWT user_id extracted from context (authenticated users)
//  2. X-Forwarded-For or RemoteIP (unauthenticated / fallback)
func PerUserLimiter(max int, window time.Duration, msg string) fiber.Handler {
	if max < 1 {
		max = 1
	}
	if window <= 0 {
		window = time.Minute
	}
	limiter := newUserRateLimiter(max, window)

	return func(c *fiber.Ctx) error {
		key := identityKey(c)
		if !limiter.allow(key) {
			if msg == "" {
				msg = "Please wait a moment before trying again."
			}
			c.Set("Retry-After", strconv.Itoa(int(window.Seconds())))
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"success": false,
				"error":   msg,
			})
		}
		return c.Next()
	}
}

// identityKey picks the best available identifier for rate-limiting.
func identityKey(c *fiber.Ctx) string {
	// Prefer the authenticated user ID so per-user limits are accurate
	// regardless of which IP address the user connects from.
	userID, ok := GetUserIDFromContext(c)
	if ok && userID > 0 {
		return "u:" + itoa(userID)
	}

	// Fall back to IP address for unauthenticated requests.
	ip := c.Get("X-Forwarded-For")
	if ip == "" {
		ip = c.IP()
	}
	// Trim port if present (IPv4 behind a proxy).
	for i := 0; i < len(ip); i++ {
		if ip[i] == ',' {
			ip = ip[:i]
			break
		}
	}
	ip = strings.TrimSpace(ip)
	if ip == "" {
		ip = "unknown"
	}
	return "ip:" + ip
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	buf := [20]byte{}
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[pos:])
}
