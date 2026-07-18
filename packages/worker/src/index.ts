import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { D1Database, KVNamespace } from '@cloudflare/workers-types'

// MCP
import { handleMcpRequest } from './routes/mcp'

// Scheduled
import { startCandidatesImport, runPipelineHealthCheck } from './services/pipeline-health'

// Workflows
export { ProgramMetricsWorkflow } from './workflows/program-metrics-workflow'
export { CandidatesImportWorkflow } from './workflows/candidates-import-workflow'
export { AiAnalysisWorkflow } from './workflows/ai-analysis-workflow'
export { IdlSyncWorkflow } from './workflows/idl-sync-workflow'
export { IdlUpdateCacheWorkflow } from './workflows/idl-update-cache-workflow'
export { BulkRecategorizeWorkflow } from './workflows/bulk-recategorize-workflow'
export { VerifiedBuildsWorkflow } from './workflows/verified-builds-workflow'
export { VerifiedAnalysisWorkflow } from './workflows/verified-analysis-workflow'
export { OsecDiscoverWorkflow } from './workflows/osec-discover-workflow'
export { VerifiedMatchWorkflow } from './workflows/verified-match-workflow'
export { VerifiedIdlImportWorkflow } from './workflows/verified-idl-import-workflow'

// Middleware
import { errorHandler } from './middleware/error-handler'
import { apiRateLimit } from './middleware/rate-limit'
import { requestLogger } from './middleware/request-logger'
import { statsCache, projectListCache, idlReadCache } from './middleware/cache'
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
    RESPONSE_CACHE_DISABLED?: string
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
    VERIFIED_MATCH_WORKFLOW: any
    VERIFIED_IDL_IMPORT_WORKFLOW: any
    CANDIDATES_IMPORT_WORKFLOW: any
  }
}

const app = new Hono<Env>()

// Middleware
app.use('*', performanceMonitor)
app.use('*', compressionHeaders)
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
app.use('/project/:projectId/llms.txt', idlReadCache)
app.route('/', llmsRoutes)
app.route('/', discoveryRoutes)
app.use('/api/*', requestLogger)
app.use('/api/*', apiRateLimit)
// Response caching — route-scoped, anonymous GETs only (auth-header requests bypass).
// Kill switch: set RESPONSE_CACHE_DISABLED=1 to bypass without a redeploy.
app.use('/api/stats', statsCache)
app.use('/api/projects', projectListCache)
app.use('/api/:projectId/idl', idlReadCache)
app.use('/api/:projectId/instructions', idlReadCache)
app.use('/api/:projectId/instructions/:name', idlReadCache)
app.use('/api/:projectId/accounts', idlReadCache)
app.use('/api/:projectId/errors', idlReadCache)
app.use('/api/:projectId/events', idlReadCache)
app.use('/api/:projectId/types', idlReadCache)
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

  async scheduled(controller: ScheduledController, env: Env['Bindings'], ctx: ExecutionContext): Promise<void> {
    // 15 * * * * / 0 2 * * * → CandidatesImportWorkflow (process discovery queue)
    // 0 5 * * 6              → CandidatesImportWorkflow full sweep (recheck ALL candidates)
    // 45 * * * *             → pipeline health check + auto-remediation
    // Workflow-native schedules (registered via wrangler.toml `schedules`):
    //   0 */6 * * * IdlSyncWorkflow · 0 3 * * * ProgramMetricsWorkflow
    //   0 1 * * *   OsecDiscoverWorkflow · 0 4 * * 1 VerifiedMatchWorkflow
    switch (controller.cron) {
      case '15 * * * *':
      case '0 2 * * *':
        ctx.waitUntil(startCandidatesImport(env as any, 'cron', 'import'))
        break
      case '0 5 * * 6':
        ctx.waitUntil(startCandidatesImport(env as any, 'cron', 'full-sweep'))
        break
      case '45 * * * *':
        ctx.waitUntil(runPipelineHealthCheck(env as any))
        break
    }
  },
}
