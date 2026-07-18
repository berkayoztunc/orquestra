import type { SyncEnv } from './idl-sync'
import { recordWorkflowInstance, hasActiveInstance } from './workflow-registry'
import type { CandidatesDrainParams } from '../workflows/candidates-drain-workflow'

/**
 * Pipeline health checker + auto-remediation ("smooth checker").
 *
 * Runs from the 45 * * * * cron. Detects a stalled import pipeline
 * (stuck sync runs, stale discovery, drained-but-idle queue, errored
 * workflow instances, growing dead-letter) and auto-heals what it can:
 * marks stuck runs failed, re-triggers discovery, restarts the drain.
 *
 * Result cached 5 minutes in CACHE KV under 'health:pipeline' and served
 * by GET /health/pipeline (public, names only) and
 * GET /api/admin/sync/pipeline-health (full detail).
 */

const TAG = '[pipeline-health]'

export const HEALTH_KV_KEY = 'health:pipeline'
export const LAST_DISCOVERY_KV_KEY = 'health:last-discovery'

const STUCK_RUN_HOURS = 2
const DISCOVERY_STALE_HOURS = 48
const DRAIN_STALL_HOURS = 3
const ERRORED_LOOKBACK_HOURS = 72
const DEAD_LETTER_THRESHOLD = 1000

export type HealthEnv = SyncEnv & {
  CANDIDATES_DRAIN_WORKFLOW: any
  OSEC_DISCOVER_WORKFLOW: any
}

export interface HealthCheck {
  name: string
  ok: boolean
  severity: 'warn' | 'critical'
  detail: string
  value?: number
}

export interface PipelineHealth {
  status: 'ok' | 'degraded' | 'critical'
  checkedAt: string
  checks: HealthCheck[]
  remediations: string[]
}

// ── Drain starter (shared by cron, health remediation, and admin trigger) ────

export async function startCandidatesDrain(
  env: HealthEnv,
  trigger: 'cron' | 'admin' | 'remediation',
  mode: 'drain' | 'full-sweep',
): Promise<{ started: boolean; instanceId?: string; reason?: string }> {
  // Never stack instances — a running drain already self-continues.
  const active = await hasActiveInstance(env.DB, env.CANDIDATES_DRAIN_WORKFLOW, 'candidates-drain')
  if (active) {
    console.log(`${TAG} drain already active — skipping ${mode} start`)
    return { started: false, reason: 'already-running' }
  }

  const params: CandidatesDrainParams = { trigger, mode, round: 0 }
  const instance = await env.CANDIDATES_DRAIN_WORKFLOW.create({ params })
  await recordWorkflowInstance(env.DB, {
    instanceId: instance.id,
    workflow: 'candidates-drain',
    trigger: trigger === 'cron' ? 'cron' : trigger,
    params,
  })
  console.log(`${TAG} started candidates-drain (mode=${mode}, instance=${instance.id})`)
  return { started: true, instanceId: instance.id }
}

// ── Health computation ────────────────────────────────────────────────────────

export async function computePipelineHealth(env: HealthEnv): Promise<PipelineHealth> {
  const checks: HealthCheck[] = []

  // 1. Sync runs stuck at 'running'
  const stuck = await env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM sync_runs
       WHERE status = 'running' AND started_at < datetime('now', '-${STUCK_RUN_HOURS} hours')`,
    )
    .first<{ n: number }>()
  checks.push({
    name: 'stuck_sync_runs',
    ok: (stuck?.n ?? 0) === 0,
    severity: 'warn',
    detail: `${stuck?.n ?? 0} run(s) stuck 'running' > ${STUCK_RUN_HOURS}h`,
    value: stuck?.n ?? 0,
  })

  // 2. Discovery freshness (OsecDiscoverWorkflow stamps KV on completion)
  let discoveryAgeHours: number | null = null
  try {
    const stamp = await env.CACHE.get(LAST_DISCOVERY_KV_KEY)
    if (stamp) discoveryAgeHours = (Date.now() - new Date(stamp).getTime()) / 3_600_000
  } catch { /* KV miss is handled below */ }
  checks.push({
    name: 'discovery_freshness',
    ok: discoveryAgeHours !== null && discoveryAgeHours < DISCOVERY_STALE_HOURS,
    severity: 'critical',
    detail:
      discoveryAgeHours === null
        ? 'no discovery run recorded yet'
        : `last OSEC discovery ${discoveryAgeHours.toFixed(1)}h ago`,
    value: discoveryAgeHours === null ? -1 : Math.round(discoveryAgeHours * 10) / 10,
  })

  // 3. Drain throughput: pending work but no recent drain completion
  const pendingRow = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM program_candidates WHERE status = 'pending'`)
    .first<{ n: number }>()
  const pending = pendingRow?.n ?? 0
  const recentDrain = await env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM sync_runs
       WHERE trigger IN ('drain', 'full-sweep')
         AND started_at > datetime('now', '-${DRAIN_STALL_HOURS} hours')`,
    )
    .first<{ n: number }>()
  const drainStalled = pending > 0 && (recentDrain?.n ?? 0) === 0
  checks.push({
    name: 'drain_throughput',
    ok: !drainStalled,
    severity: 'critical',
    detail: drainStalled
      ? `${pending} pending candidate(s) but no drain run in ${DRAIN_STALL_HOURS}h`
      : `${pending} pending candidate(s)`,
    value: pending,
  })

  // 4. Errored workflow instances (poll unchecked registry rows)
  const { results: toPoll } = await env.DB
    .prepare(
      `SELECT instance_id, workflow FROM workflow_instances
       WHERE created_at > datetime('now', '-${ERRORED_LOOKBACK_HOURS} hours')
         AND (last_status IS NULL OR last_status IN ('running', 'queued', 'paused', 'waiting'))
       ORDER BY created_at DESC LIMIT 25`,
    )
    .all<{ instance_id: string; workflow: string }>()
  const bindingFor = (workflow: string): any =>
    workflow === 'candidates-drain'
      ? env.CANDIDATES_DRAIN_WORKFLOW
      : workflow === 'osec-discover'
        ? env.OSEC_DISCOVER_WORKFLOW
        : null
  for (const row of toPoll ?? []) {
    const binding = bindingFor(row.workflow)
    if (!binding) continue
    try {
      const instance = await binding.get(row.instance_id)
      const { status } = await instance.status()
      await env.DB
        .prepare('UPDATE workflow_instances SET last_status = ?, checked_at = CURRENT_TIMESTAMP WHERE instance_id = ?')
        .bind(status, row.instance_id)
        .run()
    } catch { /* instance gone after redeploy — leave as-is */ }
  }
  const errored = await env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM workflow_instances
       WHERE last_status = 'errored' AND created_at > datetime('now', '-${ERRORED_LOOKBACK_HOURS} hours')`,
    )
    .first<{ n: number }>()
  checks.push({
    name: 'errored_instances',
    ok: (errored?.n ?? 0) === 0,
    severity: 'warn',
    detail: `${errored?.n ?? 0} errored workflow instance(s) in ${ERRORED_LOOKBACK_HOURS}h`,
    value: errored?.n ?? 0,
  })

  // 5. Dead-letter queue size
  const failed = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM program_candidates WHERE status = 'failed'`)
    .first<{ n: number }>()
  checks.push({
    name: 'dead_letter_size',
    ok: (failed?.n ?? 0) < DEAD_LETTER_THRESHOLD,
    severity: 'warn',
    detail: `${failed?.n ?? 0} dead-lettered candidate(s)`,
    value: failed?.n ?? 0,
  })

  const failing = checks.filter((c) => !c.ok)
  const status: PipelineHealth['status'] = failing.some((c) => c.severity === 'critical')
    ? 'critical'
    : failing.length > 0
      ? 'degraded'
      : 'ok'

  return { status, checkedAt: new Date().toISOString(), checks, remediations: [] }
}

// ── Auto-remediation ─────────────────────────────────────────────────────────

export async function remediatePipeline(env: HealthEnv, health: PipelineHealth): Promise<string[]> {
  const actions: string[] = []
  const failing = new Map(health.checks.filter((c) => !c.ok).map((c) => [c.name, c]))

  if (failing.has('stuck_sync_runs')) {
    const res = await env.DB
      .prepare(
        `UPDATE sync_runs SET status = 'failed', completed_at = CURRENT_TIMESTAMP
         WHERE status = 'running' AND started_at < datetime('now', '-${STUCK_RUN_HOURS} hours')`,
      )
      .run()
    actions.push(`marked ${res.meta?.changes ?? '?'} stuck sync run(s) failed`)
  }

  if (failing.has('discovery_freshness')) {
    try {
      const instance = await env.OSEC_DISCOVER_WORKFLOW.create({ params: { trigger: 'remediation' } })
      await recordWorkflowInstance(env.DB, {
        instanceId: instance.id,
        workflow: 'osec-discover',
        trigger: 'remediation',
      })
      actions.push(`re-triggered OSEC discovery (instance ${instance.id})`)
    } catch (err) {
      actions.push(`failed to re-trigger discovery: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (failing.has('drain_throughput')) {
    const res = await startCandidatesDrain(env, 'remediation', 'drain')
    actions.push(res.started ? `restarted candidates drain (instance ${res.instanceId})` : `drain restart skipped (${res.reason})`)
  }

  if (actions.length) console.log(`${TAG} remediation:`, actions)
  return actions
}

// ── Cron entry point ─────────────────────────────────────────────────────────

export async function runPipelineHealthCheck(env: HealthEnv): Promise<PipelineHealth> {
  const health = await computePipelineHealth(env)
  health.remediations = await remediatePipeline(env, health)
  try {
    await env.CACHE.put(HEALTH_KV_KEY, JSON.stringify(health), { expirationTtl: 300 })
  } catch { /* cache write is best-effort */ }
  console.log(`${TAG} status=${health.status}, failing=${health.checks.filter((c) => !c.ok).map((c) => c.name).join(',') || 'none'}`)
  return health
}
