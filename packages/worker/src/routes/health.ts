import { Hono } from 'hono'
import { computePipelineHealth, HEALTH_KV_KEY, type PipelineHealth } from '../services/pipeline-health'

const app = new Hono()

app.get('/', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'orquestra-api',
  })
})

app.get('/ping', (c) => {
  return c.text('pong')
})

/**
 * GET /health/pipeline
 * Public pipeline health summary: overall status + per-check pass/fail names.
 * Full detail (values, remediations) lives on /api/admin/sync/pipeline-health.
 */
app.get('/pipeline', async (c) => {
  const env = c.env as any
  if (!env?.DB) return c.json({ status: 'unknown', error: 'Database not available' }, 500)
  try {
    let health = (await env.CACHE.get(HEALTH_KV_KEY, 'json')) as PipelineHealth | null
    if (!health) health = await computePipelineHealth(env)
    return c.json({
      status: health.status,
      checkedAt: health.checkedAt,
      checks: health.checks.map((ch) => ({ name: ch.name, ok: ch.ok })),
    })
  } catch (err) {
    console.error('[health] pipeline error:', err)
    return c.json({ status: 'unknown' }, 500)
  }
})

export default app
