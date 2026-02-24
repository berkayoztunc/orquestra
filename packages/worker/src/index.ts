import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { D1Database, KVNamespace } from '@cloudflare/workers-types'

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
app.use('/api/*', requestLogger)
app.use('/api/*', apiRateLimit)
app.use('/api/*', publicApiCache)
app.route('/api/idl', idlRoutes)
app.route('/api', apiRoutes)

// 404 handler
app.all('*', (c) => {
  return c.json({ error: 'Not Found' }, 404)
})

export default app
