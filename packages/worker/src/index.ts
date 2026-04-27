import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { D1Database, KVNamespace } from '@cloudflare/workers-types'

// MCP
import { handleMcpRequest } from './routes/mcp'

// Middleware
import { errorHandler } from './middleware/error-handler'
import { apiRateLimit } from './middleware/rate-limit'
import { requestLogger } from './middleware/request-logger'
import { publicApiCache } from './middleware/cache'
import { performanceMonitor, compressionHeaders } from './middleware/performance'

// Routes
import healthRoutes from './routes/health'
import idlRoutes from './routes/idl'
import apiRoutes from './routes/api'
import authRoutes from './routes/auth'
import llmsRoutes from './routes/llms'
import ingestRoutes from './routes/ingest'
import aiRoutes from './routes/ai'
import adminRoutes from './routes/admin'
import discoveryRoutes from './routes/discovery'

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
    SOLANA_MAINNET_RPC_URL?: string
    SOLANA_DEVNET_RPC_URL?: string
    SOLANA_TESTNET_RPC_URL?: string
    FRONTEND_URL: string
    API_BASE_URL: string
    CORS_ORIGIN: string
    INGEST_API_KEY: string
  }
}

const app = new Hono<Env>()

// Middleware
app.use('*', performanceMonitor)
app.use('*', compressionHeaders)
app.use('*', logger())
app.use('*', errorHandler)
app.use(
  '*',
  cors({
    origin: (origin: string) => {
      const corsOrigins = [
        'https://orquestra.dev',
        'http://localhost:3000',
        'http://localhost:5173',
      ]
      return corsOrigins.includes(origin) ? origin : corsOrigins[0]
    },
    allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  }),
)

// Routes
app.route('/health', healthRoutes)
app.route('/auth', authRoutes)
app.route('/', llmsRoutes)
app.route('/', discoveryRoutes)
app.use('/api/*', requestLogger)
app.use('/api/*', apiRateLimit)
// app.use('/api/*', publicApiCache)
app.route('/api/idl', idlRoutes)
app.route('/api/ingest', ingestRoutes)
app.route('/api/admin', adminRoutes)
app.route('/api', aiRoutes)
app.route('/api', apiRoutes)

// 404 handler
app.all('*', (c) => {
  return c.json({ error: 'Not Found' }, 404)
})

// Export a custom fetch handler so /mcp bypasses Hono's CORS middleware
// and is handled directly by the Cloudflare Agents SDK transport.
export default {
  fetch(request: Request, env: Env['Bindings'], ctx: ExecutionContext): Response | Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      return handleMcpRequest(request, env as any, ctx)
    }
    return app.fetch(request, env, ctx)
  },
}
