import { Context, Next } from 'hono'

/**
 * Simple rate limiter using Cloudflare KV as a counter store.
 * Each key tracks request count within a TTL window.
 *
 * For production, consider Cloudflare Rate Limiting rules instead.
 */
interface RateLimitOptions {
  /** Max requests per window */
  limit: number
  /** Window duration in seconds */
  windowSec: number
  /** Key prefix for KV storage */
  prefix?: string
  /** Extract identifier from request (default: IP + path) */
  keyFn?: (c: Context) => string
}

interface RateLimitEntry {
  count: number
  resetAt: number
}

const defaultKeyFn = (c: Context): string => {
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
  return ip
}

export function rateLimiter(opts: RateLimitOptions) {
  const { limit, windowSec, prefix = 'rl', keyFn = defaultKeyFn } = opts

  return async (c: Context, next: Next) => {
    const cache = c.env?.CACHE as { get: (k: string) => Promise<string | null>; put: (k: string, v: string, o?: { expirationTtl?: number }) => Promise<void> } | undefined
    if (!cache) {
      // If no KV available, skip rate limiting
      await next()
      return
    }

    const identifier = keyFn(c)
    const key = `${prefix}:${identifier}`

    try {
      const raw = await cache.get(key)
      const now = Date.now()

      let entry: RateLimitEntry
      if (raw) {
        entry = JSON.parse(raw) as RateLimitEntry
        if (now > entry.resetAt) {
          // Window expired, reset
          entry = { count: 1, resetAt: now + windowSec * 1000 }
        } else {
          entry.count++
        }
      } else {
        entry = { count: 1, resetAt: now + windowSec * 1000 }
      }

      // Set rate limit headers
      const remaining = Math.max(0, limit - entry.count)
      c.header('X-RateLimit-Limit', String(limit))
      c.header('X-RateLimit-Remaining', String(remaining))
      c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))

      if (entry.count > limit) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
        c.header('Retry-After', String(retryAfter))
        return c.json(
          {
            error: 'Too Many Requests',
            message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
            retryAfter,
          },
          429,
        )
      }

      // Store updated count with TTL
      await cache.put(key, JSON.stringify(entry), { expirationTtl: windowSec + 10 })
    } catch {
      // On KV errors, allow the request through
    }

    await next()
  }
}

/** Preset: general API — 100 req/min */
export const apiRateLimit = rateLimiter({
  limit: 100,
  windowSec: 60,
  prefix: 'rl:api',
})

/** Preset: auth endpoints — 20 req/min */
export const authRateLimit = rateLimiter({
  limit: 20,
  windowSec: 60,
  prefix: 'rl:auth',
})

/** Preset: IDL upload — 10 req/min */
export const uploadRateLimit = rateLimiter({
  limit: 10,
  windowSec: 60,
  prefix: 'rl:upload',
})

/** Preset: transaction build — 30 req/min */
export const buildRateLimit = rateLimiter({
  limit: 30,
  windowSec: 60,
  prefix: 'rl:build',
})
