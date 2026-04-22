/**
 * Cache Service - Provides intelligent caching for API responses with TTL support
 * Reduces redundant API calls and improves page load performance
 */

interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number // Time to live in milliseconds
}

interface CacheConfig {
  ttl?: number // Default: 5 minutes (300,000ms)
  maxSize?: number // Default: 50 entries
}

const DEBUG_CACHE = import.meta.env.DEV && localStorage.getItem('debug_cache') === 'true'

class CacheService {
  private cache: Map<string, CacheEntry<any>> = new Map()
  private pendingRequests: Map<string, Promise<any>> = new Map()
  private config: Required<CacheConfig>

  constructor(config: CacheConfig = {}) {
    this.config = {
      ttl: config.ttl || 5 * 60 * 1000, // 5 minutes default
      maxSize: config.maxSize || 50,
    }
  }

  /**
   * Generate a cache key from a URL and optional parameters
   */
  private generateKey(url: string, params?: Record<string, any>): string {
    if (!params || Object.keys(params).length === 0) {
      return `api:${url}`
    }
    const queryString = Object.entries(params)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join('&')
    return `api:${url}?${queryString}`
  }

  /**
   * Check if cache entry is still valid
   */
  private isValid<T>(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.timestamp < entry.ttl
  }

  /**
   * Cleanup old cache entries if size limit is exceeded
   */
  private cleanup(): void {
    if (this.cache.size > this.config.maxSize) {
      let entriesToRemove = this.cache.size - Math.floor(this.config.maxSize * 0.8)
      const sortedEntries = Array.from(this.cache.entries())
        .sort(([, a], [, b]) => a.timestamp - b.timestamp)

      for (let i = 0; i < entriesToRemove && i < sortedEntries.length; i++) {
        this.cache.delete(sortedEntries[i][0])
      }
    }
  }

  /**
   * Get cached data if valid, otherwise return null
   */
  get<T>(url: string, params?: Record<string, any>): T | null {
    const key = this.generateKey(url, params)
    const entry = this.cache.get(key)

    if (entry && this.isValid(entry)) {
      if (DEBUG_CACHE) console.debug(`[Cache] HIT: ${key}`)
      return entry.data as T
    }

    if (entry) {
      if (DEBUG_CACHE) console.debug(`[Cache] EXPIRED: ${key}`)
      this.cache.delete(key)
    }

    return null
  }

  /**
   * Set cache entry with custom TTL
   */
  set<T>(url: string, data: T, ttl?: number, params?: Record<string, any>): void {
    const key = this.generateKey(url, params)
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.config.ttl,
    }

    this.cache.set(key, entry)
    if (DEBUG_CACHE) console.debug(`[Cache] SET: ${key} (TTL: ${entry.ttl}ms)`)
    this.cleanup()
  }

  /**
   * Get with async fallback - returns cached value or waits for promise
   * Implements request deduplication
   */
  async getOrFetch<T>(
    url: string,
    fetcher: () => Promise<T>,
    ttl?: number,
    params?: Record<string, any>
  ): Promise<T> {
    // Check cache first
    const cached = this.get<T>(url, params)
    if (cached !== null) {
      return cached
    }

    const key = this.generateKey(url, params)

    // If request is already pending, return that promise
    if (this.pendingRequests.has(key)) {
      if (DEBUG_CACHE) console.debug(`[Cache] DEDUP: Reusing pending request for ${key}`)
      return this.pendingRequests.get(key)!
    }

    // Make the request and cache result
    const promise = fetcher()
      .then((data) => {
        this.set(url, data, ttl, params)
        return data
      })
      .finally(() => {
        this.pendingRequests.delete(key)
      })

    this.pendingRequests.set(key, promise)
    return promise
  }

  /**
   * Clear all cache
   */
  clear(): void {
    if (DEBUG_CACHE) console.debug(`[Cache] CLEAR: Cleared ${this.cache.size} entries`)
    this.cache.clear()
    this.pendingRequests.clear()
  }

  /**
   * Clear specific cache key
   */
  delete(url: string, params?: Record<string, any>): void {
    const key = this.generateKey(url, params)
    this.cache.delete(key)
    if (DEBUG_CACHE) console.debug(`[Cache] DELETE: ${key}`)
  }

  /**
   * Clear cache keys matching a pattern
   */
  clearPattern(pattern: string): void {
    const regex = new RegExp(pattern)
    let count = 0

    for (const key of Array.from(this.cache.keys())) {
      if (regex.test(key)) {
        this.cache.delete(key)
        count++
      }
    }

    if (DEBUG_CACHE) console.debug(`[Cache] CLEAR PATTERN: Cleared ${count} entries matching ${pattern}`)
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      ttl: this.config.ttl,
      entries: Array.from(this.cache.entries()).map(([key, val]) => ({
        key,
        age: Date.now() - val.timestamp,
        ttl: val.ttl,
        valid: this.isValid(val),
      })),
    }
  }
}

// Export singleton instance
export const cacheService = new CacheService({
  ttl: 5 * 60 * 1000, // 5 minutes for most data
  maxSize: 100, // Cache up to 100 API responses
})

// Specific cache instance for seller stats (longer TTL)
export const sellerStatsCache = new CacheService({
  ttl: 15 * 60 * 1000, // 15 minutes - seller stats change less frequently
  maxSize: 50,
})

// Specific cache instance for reviews (moderate TTL)
export const reviewsCache = new CacheService({
  ttl: 10 * 60 * 1000, // 10 minutes
  maxSize: 50,
})

export default cacheService
