import type { D1Database } from '@cloudflare/workers-types'

/**
 * Local registry of Workflow instances we create (scheduled handler, admin
 * triggers, workflow self-continuations). The pipeline health checker polls
 * instance statuses through workflow bindings using these IDs, so no
 * Cloudflare REST API credentials are needed at runtime.
 */

export interface WorkflowInstanceRecord {
  instanceId: string
  workflow: string
  trigger: 'cron' | 'schedule' | 'admin' | 'continuation' | 'remediation'
  params?: unknown
}

export async function recordWorkflowInstance(
  db: D1Database,
  record: WorkflowInstanceRecord,
): Promise<void> {
  try {
    await db
      .prepare(
        'INSERT OR REPLACE INTO workflow_instances (instance_id, workflow, trigger, params_json) VALUES (?, ?, ?, ?)',
      )
      .bind(
        record.instanceId,
        record.workflow,
        record.trigger,
        record.params === undefined ? null : JSON.stringify(record.params),
      )
      .run()
  } catch (err) {
    // Registry is observability-only — never fail the caller over it.
    console.error('[workflow-registry] failed to record instance:', err)
  }
}

/**
 * True when a recent instance of `workflow` is still running/queued.
 * Used by the scheduled handler to avoid stacking drain instances.
 */
export async function hasActiveInstance(
  db: D1Database,
  binding: { get(id: string): Promise<{ status(): Promise<{ status: string }> }> },
  workflow: string,
  withinHours = 6,
): Promise<boolean> {
  const { results } = await db
    .prepare(
      `SELECT instance_id FROM workflow_instances
       WHERE workflow = ? AND created_at > datetime('now', ?)
       ORDER BY created_at DESC LIMIT 10`,
    )
    .bind(workflow, `-${withinHours} hours`)
    .all<{ instance_id: string }>()

  for (const row of results ?? []) {
    try {
      const instance = await binding.get(row.instance_id)
      const { status } = await instance.status()
      await db
        .prepare('UPDATE workflow_instances SET last_status = ?, checked_at = CURRENT_TIMESTAMP WHERE instance_id = ?')
        .bind(status, row.instance_id)
        .run()
      if (status === 'running' || status === 'queued' || status === 'paused' || status === 'waiting') {
        return true
      }
    } catch {
      // Instance not found (e.g. redeploy wiped it) — treat as inactive.
    }
  }
  return false
}
