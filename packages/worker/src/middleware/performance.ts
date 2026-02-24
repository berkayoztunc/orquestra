import { createMiddleware } from 'hono/factory'

/**
 * Tracks Worker cold starts and adds performance timing headers.
 *
 * Headers added:
 * - X-Cold-Start: "true" | "false"
 * - X-Response-Time: duration in ms
 * - Server-Timing: W3C Server-Timing header for DevTools waterfall
 */

let isWarm = false

export const performanceMonitor = createMiddleware(async (c, next) => {
  const start = performance.now()
  const wasColdStart = !isWarm
  isWarm = true

  await next()

  const duration = (performance.now() - start).toFixed(2)

  c.header('X-Cold-Start', wasColdStart ? 'true' : 'false')
  c.header('X-Response-Time', `${duration}ms`)
  c.header(
    'Server-Timing',
    `total;dur=${duration}${wasColdStart ? ', cold-start;desc="Cold Start"' : ''}`
  )

  // Structured log for cold starts (queryable in Cloudflare dashboard / Logpush)
  if (wasColdStart) {
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'cold_start',
        timestamp: new Date().toISOString(),
        method: c.req.method,
        path: c.req.path,
        duration_ms: parseFloat(duration),
      })
    )
  }
})

/**
 * Compression middleware for JSON responses.
 *
 * Cloudflare Workers automatically apply gzip/brotli to responses
 * when the client sends an Accept-Encoding header. This middleware
 * ensures responses have proper Content-Type for compression and
 * adds a Vary header so edge caches store compressed/uncompressed
 * variants separately.
 */
export const compressionHeaders = createMiddleware(async (c, next) => {
  await next()

  // Tell edge/CDN to vary cache by encoding
  c.header('Vary', 'Accept-Encoding')

  // Cloudflare Workers runtime handles gzip/brotli automatically
  // for responses with compressible content types. We just need to
  // ensure the correct Content-Type is set (Hono does this) and
  // that Cache-Control allows edge compression.
})
