import { createMiddleware } from 'hono/factory'
import type { D1Database, KVNamespace } from '@cloudflare/workers-types'
import { incrementEvent, EVENT_TYPE } from '../services/analytics'

type Env = {
  Variables: Record<string, unknown>
  Bindings: {
    DB: D1Database
    IDLS: KVNamespace
    CACHE: KVNamespace
    GITHUB_OAUTH_ID: string
    GITHUB_OAUTH_SECRET: string
    JWT_SECRET: string
    SOLANA_RPC_URL: string
    FRONTEND_URL: string
    API_BASE_URL: string
    CORS_ORIGIN: string
  }
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '****' + key.slice(-4)
}

/**
 * Request/response logging middleware.
 * Emits structured JSON via console.log so entries are queryable
 * in Cloudflare's logging dashboard and Logpush.
 */
export const requestLogger = createMiddleware<Env>(async (c, next) => {
  const start = Date.now()
  const method = c.req.method
  const path = c.req.path
  const timestamp = new Date().toISOString()

  // Capture request body size (Content-Length header, if present)
  const requestBodySize = parseInt(c.req.header('content-length') || '0', 10)

  // IP address from Cloudflare headers
  const ip =
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for') ||
    'unknown'

  // API key (masked) if present
  const rawApiKey = c.req.header('x-api-key')
  const apiKey = rawApiKey ? maskApiKey(rawApiKey) : undefined

  await next()

  // After response
  const duration = Date.now() - start
  const status = c.res.status

  // User ID set by auth middleware (may be undefined for unauthenticated routes)
  const userId = c.get('userId') as string | undefined

  // Response body size — use Content-Length if the handler set it,
  // otherwise leave as undefined to avoid consuming the body stream.
  const resContentLength = c.res.headers.get('content-length')
  const responseBodySize = resContentLength
    ? parseInt(resContentLength, 10)
    : undefined

  const logEntry = {
    level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
    timestamp,
    method,
    path,
    status,
    duration_ms: duration,
    request_body_size: requestBodySize,
    response_body_size: responseBodySize,
    ip,
    ...(userId && { user_id: userId }),
    ...(apiKey && { api_key: apiKey }),
  }

  console.log(JSON.stringify(logEntry))

  // Extract project_id from paths like /api/:projectId/instructions
  // Skip known non-project prefixes so we don't store route names as IDs.
  const projectIdMatch = path.match(
    /^\/api\/(?!projects|admin|ingest|idl|stats|ai)([^/]+)/,
  )
  const projectId = projectIdMatch ? projectIdMatch[1] : ''

  incrementEvent(c.env.DB, c.executionCtx, {
    eventType: EVENT_TYPE.api,
    projectId,
  })
})
