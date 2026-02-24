import { createMiddleware } from 'hono/factory'
import type { D1Database, KVNamespace } from '@cloudflare/workers-types'

type Env = {
  Variables: Record<string, unknown>
  Bindings: {
    DB: D1Database
    IDLS: KVNamespace
    CACHE: KVNamespace
  }
}

interface CacheOptions {
  /** TTL in seconds (default: 300 = 5 min) */
  ttl?: number
  /** Key prefix for KV storage */
  prefix?: string
  /** Whether to include query params in cache key (default: true) */
  includeQuery?: boolean
  /** Custom key function — overrides default key generation */
  keyFn?: (path: string, query: string) => string
}

/**
 * Response caching middleware using Cloudflare KV.
 *
 * Caches GET responses in the CACHE KV namespace with configurable TTL.
 * Automatically skips caching for authenticated (user-specific) requests.
 *
 * Cache keys follow the pattern: `resp:<prefix>:<path>[?query]`
 */
export function responseCache(opts: CacheOptions = {}) {
  const { ttl = 300, prefix = 'resp', includeQuery = true } = opts

  return createMiddleware<Env>(async (c, next) => {
    // Only cache GET requests
    if (c.req.method !== 'GET') {
      await next()
      return
    }

    // Skip cache for authenticated requests (user-specific data)
    const authHeader = c.req.header('Authorization')
    const apiKeyHeader = c.req.header('X-API-Key')
    if (authHeader || apiKeyHeader) {
      await next()
      return
    }

    const cache = c.env?.CACHE as KVNamespace | undefined
    if (!cache) {
      await next()
      return
    }

    // Build cache key
    const path = c.req.path
    const query = includeQuery ? c.req.query().toString() : ''
    const cacheKey = opts.keyFn
      ? opts.keyFn(path, query)
      : `${prefix}:${path}${query ? `?${new URLSearchParams(query).toString()}` : ''}`

    try {
      // Check cache
      const cached = await cache.get(cacheKey)
      if (cached) {
        const parsed = JSON.parse(cached) as {
          body: string
          contentType: string
          status: number
        }
        c.header('X-Cache', 'HIT')
        c.header('X-Cache-Key', cacheKey)
        c.header('Content-Type', parsed.contentType)
        return c.body(parsed.body, parsed.status as 200)
      }
    } catch {
      // Cache read error — proceed without cache
    }

    await next()

    // Only cache successful responses
    if (c.res.status >= 200 && c.res.status < 300) {
      try {
        const cloned = c.res.clone()
        const body = await cloned.text()
        const contentType = cloned.headers.get('Content-Type') || 'application/json'

        const entry = JSON.stringify({
          body,
          contentType,
          status: cloned.status,
        })

        // Store async — don't block response
        c.executionCtx?.waitUntil(
          cache.put(cacheKey, entry, { expirationTtl: ttl })
        )

        c.header('X-Cache', 'MISS')
        c.header('X-Cache-Key', cacheKey)
      } catch {
        // Cache write error — ignore
      }
    }
  })
}

/**
 * Invalidate cache entries by prefix pattern.
 * Useful when data changes (e.g., project update, IDL upload).
 */
export async function invalidateCache(
  cache: KVNamespace | undefined,
  patterns: string[]
): Promise<void> {
  if (!cache) return

  for (const pattern of patterns) {
    try {
      const list = await cache.list({ prefix: pattern })
      await Promise.all(list.keys.map((key) => cache.delete(key.name)))
    } catch {
      // Ignore cache invalidation errors
    }
  }
}

/** Preset: Public API endpoints — 5 min cache */
export const publicApiCache = responseCache({
  ttl: 300,
  prefix: 'api',
})

/** Preset: Documentation — 1 hour cache */
export const docsCache = responseCache({
  ttl: 3600,
  prefix: 'docs',
})

/** Preset: Project listing — 2 min cache */
export const projectListCache = responseCache({
  ttl: 120,
  prefix: 'projects',
})
