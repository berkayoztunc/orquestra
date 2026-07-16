import { createMiddleware } from 'hono/factory'
import type { D1Database, KVNamespace } from '@cloudflare/workers-types'

type Env = {
  Variables: Record<string, unknown>
  Bindings: {
    DB: D1Database
    IDLS: KVNamespace
    CACHE: KVNamespace
    /** Kill switch: set to "1" to bypass response caching without a redeploy */
    RESPONSE_CACHE_DISABLED?: string
  }
}

interface CachedEntry {
  body: string
  contentType: string
  status: number
}

/** Cache API keys must be URLs; the host is synthetic and never fetched. */
function edgeCacheKey(cacheKey: string): Request {
  return new Request(`https://response-cache.internal/${encodeURIComponent(cacheKey)}`)
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
  /**
   * Client-visible Cache-Control header (e.g. 'public, max-age=0, s-maxage=60').
   * Omit to send no caching header to clients.
   */
  cacheControl?: string
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

    if (c.env?.RESPONSE_CACHE_DISABLED === '1') {
      await next()
      return
    }

    const cache = c.env?.CACHE as KVNamespace | undefined
    if (!cache) {
      await next()
      return
    }

    // Build cache key. url.search is the raw already-encoded query string
    // (c.req.query() returns an object — stringifying it collapses all queries to one key).
    const path = c.req.path
    const query = includeQuery ? new URL(c.req.url).search : ''
    const cacheKey = opts.keyFn ? opts.keyFn(path, query) : `${prefix}:${path}${query}`

    const serveHit = (entry: CachedEntry, source: 'EDGE' | 'KV') => {
      c.header('X-Cache', `HIT-${source}`)
      c.header('X-Cache-Key', cacheKey)
      c.header('Content-Type', entry.contentType)
      if (opts.cacheControl) c.header('Cache-Control', opts.cacheControl)
      return c.body(entry.body, entry.status as 200)
    }

    // Tier 1: Cache API — colo-local, sub-ms. Only populated on zone-routed traffic.
    let edge: Cache | undefined
    try {
      edge = (caches as unknown as { default: Cache }).default
      if (edge) {
        const hit = await edge.match(edgeCacheKey(cacheKey))
        if (hit) {
          const entry = (await hit.json()) as CachedEntry
          return serveHit(entry, 'EDGE')
        }
      }
    } catch {
      // Cache API unavailable (e.g. local dev) — fall through to KV
    }

    // Tier 2: KV — global, slower, works everywhere
    try {
      const cached = await cache.get(cacheKey)
      if (cached) {
        const entry = JSON.parse(cached) as CachedEntry
        // Promote to the colo-local tier for subsequent requests
        if (edge) {
          c.executionCtx?.waitUntil(
            edge
              .put(
                edgeCacheKey(cacheKey),
                new Response(cached, {
                  headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': `s-maxage=${ttl}`,
                  },
                }),
              )
              .catch(() => {}),
          )
        }
        return serveHit(entry, 'KV')
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
        c.executionCtx?.waitUntil(cache.put(cacheKey, entry, { expirationTtl: ttl }))
        if (edge) {
          c.executionCtx?.waitUntil(
            edge
              .put(
                edgeCacheKey(cacheKey),
                new Response(entry, {
                  headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': `s-maxage=${ttl}`,
                  },
                }),
              )
              .catch(() => {}),
          )
        }

        c.header('X-Cache', 'MISS')
        c.header('X-Cache-Key', cacheKey)
        if (opts.cacheControl) c.header('Cache-Control', opts.cacheControl)
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

/** Preset: Project listing — 30s cache (anonymous only; auth-header requests skip) */
export const projectListCache = responseCache({
  ttl: 30,
  prefix: 'api',
})

/** Preset: stats/aggregate endpoints — 60s cache. max-age=0 keeps clients revalidating. */
export const statsCache = responseCache({
  ttl: 60,
  prefix: 'api',
  cacheControl: 'public, max-age=0, s-maxage=60',
})

/** Preset: IDL-derived read endpoints (idl/instructions/accounts/errors/events/types, llms.txt) — 60s cache */
export const idlReadCache = responseCache({
  ttl: 60,
  prefix: 'api',
  cacheControl: 'public, max-age=0, s-maxage=60',
})
