import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { D1Database, KVNamespace } from '@cloudflare/workers-types'

// MCP
import { handleMcpRequest } from './routes/mcp'

// Scheduled
import { runDailyIdlSync, runCandidatesBurst } from './services/idl-sync'

// Workflows
export { ProgramMetricsWorkflow } from './workflows/program-metrics-workflow'
export { AiAnalysisWorkflow } from './workflows/ai-analysis-workflow'
export { IdlSyncWorkflow } from './workflows/idl-sync-workflow'
export { IdlUpdateCacheWorkflow } from './workflows/idl-update-cache-workflow'
export { BulkRecategorizeWorkflow } from './workflows/bulk-recategorize-workflow'
export { VerifiedBuildsWorkflow } from './workflows/verified-builds-workflow'
export { VerifiedAnalysisWorkflow } from './workflows/verified-analysis-workflow'
export { OsecDiscoverWorkflow } from './workflows/osec-discover-workflow'

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
import listsRoutes from './routes/lists'

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
    SOLANA_FALLBACK_RPC_URLS?: string
    SOLANA_MAINNET_FALLBACK_RPC_URLS?: string
    SOLANA_DEVNET_RPC_URL?: string
    SOLANA_TESTNET_RPC_URL?: string
    FRONTEND_URL: string
    API_BASE_URL: string
    CORS_ORIGIN: string
    INGEST_API_KEY: string
    AI: Ai
    AI_ANALYSIS_MODEL?: string
    PROGRAM_METRICS_WORKFLOW: any
    AI_ANALYSIS_WORKFLOW: any
    IDL_SYNC_WORKFLOW: any
    IDL_UPDATE_CACHE_WORKFLOW: any
    BULK_RECATEGORIZE_WORKFLOW: any
    VERIFIED_BUILDS_WORKFLOW: any
    VERIFIED_ANALYSIS_WORKFLOW: any
    OSEC_DISCOVER_WORKFLOW: any
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
    allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Scope-Key'],
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
app.route('/api/lists', listsRoutes)
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

  async scheduled(_controller: ScheduledController, env: Env['Bindings'], ctx: ExecutionContext): Promise<void> {
    // 0 2 * * * and 15 * * * * → candidates burst (drain discovery queue)
    // 0 */6 * * *              → full sync: existing projects + light candidates phase
    // 0 3 * * *                → daily metrics import (handled by workflow schedule)
    if (_controller.cron === '0 2 * * *' || _controller.cron === '15 * * * *') {
      ctx.waitUntil(runCandidatesBurst(env as any))
    } else {
      ctx.waitUntil(runDailyIdlSync(env as any))
    }
  },
}
