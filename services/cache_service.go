package services

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Cache key prefixes — use these constants so invalidation is consistent.
const (
	CacheKeyProducts    = "products:"   // e.g. "products:home:page1"
	CacheKeyCategories  = "categories:" // e.g. "categories:all"
	CacheKeyUserProfile = "user:"       // e.g. "user:42:profile"
	CacheKeyTrustScore  = "trust:"      // e.g. "trust:42"
	CacheKeyTraderCount = "trader:"     // e.g. "trader:42:count"
)

type cacheEntry struct {
	value     interface{}
	expiresAt time.Time
}

// AppCache is a simple in-memory TTL cache backed by sync.Map.
// It is safe for concurrent use and never returns stale data: every Get checks
// the expiry time and treats expired entries as cache misses.
type AppCache struct {
	m sync.Map
}

type CacheStats struct {
	Entries int  `json:"entries"`
	Running bool `json:"running"`
}

var GlobalCache = &AppCache{}
var cacheEvictionStarted atomic.Bool

// Set stores a value under key for ttl duration.
func (c *AppCache) Set(key string, value interface{}, ttl time.Duration) {
	if ttl <= 0 {
		c.Delete(key)
		return
	}
	c.m.Store(key, cacheEntry{
		value:     value,
		expiresAt: time.Now().Add(ttl),
	})
}

// Get returns the cached value and true, or nil and false on a miss/expiry.
func (c *AppCache) Get(key string) (interface{}, bool) {
	raw, ok := c.m.Load(key)
	if !ok {
		return nil, false
	}
	entry := raw.(cacheEntry)
	if time.Now().After(entry.expiresAt) {
		c.m.Delete(key)
		return nil, false
	}
	return entry.value, true
}

// Delete removes a single key from the cache.
func (c *AppCache) Delete(key string) {
	c.m.Delete(key)
}

// InvalidatePrefix deletes all keys that start with prefix. This is the primary
// invalidation mechanism: e.g. InvalidatePrefix("products:") clears all product
// cache entries when a new product is created or updated.
func (c *AppCache) InvalidatePrefix(prefix string) {
	c.m.Range(func(k, _ interface{}) bool {
		if key, ok := k.(string); ok {
			if strings.HasPrefix(key, prefix) {
				c.m.Delete(k)
			}
		}
		return true
	})
}

// InvalidateUser removes all cache entries for a specific user ID.
func (c *AppCache) InvalidateUser(userID int) {
	// Convert userID to string prefix once.
	uidStr := itoa(userID)
	c.InvalidatePrefix(CacheKeyUserProfile + uidStr)
	c.InvalidatePrefix(CacheKeyTrustScore + uidStr)
	c.InvalidatePrefix(CacheKeyTraderCount + uidStr)
}

// Flush clears the entire cache. Useful during testing or after bulk imports.
func (c *AppCache) Flush() {
	c.m.Range(func(k, _ interface{}) bool {
		c.m.Delete(k)
		return true
	})
}

func (c *AppCache) Stats() CacheStats {
	stats := CacheStats{Running: cacheEvictionStarted.Load()}
	c.m.Range(func(_, _ interface{}) bool {
		stats.Entries++
		return true
	})
	return stats
}

// StartCacheEviction runs a background goroutine that sweeps expired entries
// every 5 minutes, preventing unbounded memory growth in long-running servers.
func StartCacheEviction() {
	StartCacheEvictionContext(context.Background())
}

func StartCacheEvictionContext(ctx context.Context) {
	if !cacheEvictionStarted.CompareAndSwap(false, true) {
		return
	}
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				evictExpired(GlobalCache)
			}
		}
	}()
}

func evictExpired(c *AppCache) {
	now := time.Now()
	c.m.Range(func(k, v interface{}) bool {
		if entry, ok := v.(cacheEntry); ok {
			if now.After(entry.expiresAt) {
				c.m.Delete(k)
			}
		}
		return true
	})
}

// itoa converts an int to its decimal string representation without importing
// strconv to keep this file dependency-free.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	buf := [20]byte{}
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}
