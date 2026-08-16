/**
 * Analytics service — zero-latency daily rollup counters.
 *
 * All writes happen inside ctx.waitUntil() so the response is returned
 * to the client BEFORE the DB write occurs. Analytics errors are silently
 * swallowed and never affect the API or MCP paths.
 *
 * Storage model: one row per (date, event_type, project_id, tool_id) group.
 * Each request UPSERTs count + 1 — no row explosion, minimal storage.
 */

/** event_type values */
export const EVENT_TYPE = {
  api: 0,
  mcp: 1,
} as const

/**
 * MCP tool_id enum. IDs 0-10 are registered in routes/mcp.ts (the main
 * Orquestra MCP server, /mcp); IDs 11-17 are registered in routes/flow-mcp.ts
 * (the separate Flow Engine MCP server, /flow/mcp). Shared here since both
 * servers write to the same `analytics` table.
 */
export const MCP_TOOL = {
  search_programs: 0,
  list_instructions: 1,
  build_instruction: 2,
  list_pda_accounts: 3,
  derive_pda: 4,
  read_llms_txt: 5,
  get_ai_analysis: 6,
  fetch_pda_data: 7,
  simulate_instruction: 8,
  get_program_data: 9,
  simulate_transaction: 10,
  get_flow_schema: 11,
  validate_flow: 12,
  simulate_flow: 13,
  publish_flow: 14,
  list_flows: 15,
  get_flow_metadata: 16,
  estimate_flow: 17,
} as const

/** Convert current UTC date to YYYYMMDD integer (e.g. 20260427) */
function todayInt(): number {
  const d = new Date()
  return (
    d.getUTCFullYear() * 10000 +
    (d.getUTCMonth() + 1) * 100 +
    d.getUTCDate()
  )
}

/**
 * Minimal execution context interface — compatible with both old and new
 * @cloudflare/workers-types ExecutionContext shapes.
 */
interface ExecutionCtx {
  waitUntil(promise: Promise<unknown>): void
}

interface EventParams {
  /** 0 = HTTP API, 1 = MCP */
  eventType: 0 | 1
  /** Orquestra project ID — empty string when not applicable */
  projectId?: string
  /** MCP tool enum value; -1 for HTTP API requests */
  toolId?: number
}

/**
 * Increment the daily analytics counter for the given event.
 * Fire-and-forget via ctx.waitUntil — caller is never blocked.
 */
export function incrementEvent(
  db: any,
  ctx: ExecutionCtx,
  { eventType, projectId = '', toolId = -1 }: EventParams,
): void {
  const date = todayInt()
  ctx.waitUntil(
    (async () => {
      try {
        await db
          .prepare(
            `INSERT INTO analytics (date, event_type, project_id, tool_id, count)
             VALUES (?, ?, ?, ?, 1)
             ON CONFLICT(date, event_type, project_id, tool_id)
             DO UPDATE SET count = count + 1`,
          )
          .bind(date, eventType, projectId, toolId)
          .run()
      } catch {
        // Silently ignore — analytics failure must never affect the API.
      }
    })(),
  )
}

// ── Summary reads ────────────────────────────────────────────────────────────
// Extracted from routes/admin.ts's GET /analytics handler so both the HTTP
// route and the Telegram /analytics command read from one query set.

export interface AnalyticsSummary {
  daily_api: Array<{ date: number; total: number }>
  daily_mcp: Array<{ date: number; tool_id: number; total: number }>
  top_programs: Array<{ project_id: string; name: string; total: number }>
  totals_alltime: { api: number; mcp: number }
  platform: {
    total_programs: number
    programs_with_idl: number
    verified_programs: number
    programs_with_idl_and_verified: number
    workflow_runs_total: number
    idl_versions_total: number
  }
}

/**
 * Last-30-day daily breakdowns for API and MCP traffic, all-time traffic
 * totals, the top 6 most-accessed programs, and platform stats (IDL
 * coverage across the full program_candidates sync universe, verified rate,
 * IDL+verified overlap, total workflow runs, total IDL versions).
 */
export async function getAnalyticsSummary(db: any): Promise<AnalyticsSummary> {
  const [dailyApi, dailyMcp, topPrograms, allTimeTotals, verifiedStats, workflowRuns, idlVersionsTotal] = await Promise.all([
    // Daily HTTP API totals (last 30 days)
    db
      .prepare(
        `SELECT date, SUM(count) AS total
         FROM analytics
         WHERE event_type = 0
           AND date >= CAST(strftime('%Y%m%d', 'now', '-30 days') AS INTEGER)
         GROUP BY date
         ORDER BY date ASC`,
      )
      .all(),

    // Daily MCP totals per tool (last 30 days)
    db
      .prepare(
        `SELECT date, tool_id, SUM(count) AS total
         FROM analytics
         WHERE event_type = 1
           AND date >= CAST(strftime('%Y%m%d', 'now', '-30 days') AS INTEGER)
         GROUP BY date, tool_id
         ORDER BY date ASC`,
      )
      .all(),

    // Top 6 programs by combined API + MCP request count (all time)
    db
      .prepare(
        `SELECT a.project_id, p.name, SUM(a.count) AS total
         FROM analytics a
         INNER JOIN projects p ON p.id = a.project_id
         GROUP BY a.project_id
         ORDER BY total DESC
         LIMIT 6`,
      )
      .all(),

    // All-time API vs MCP request totals
    db
      .prepare(
        `SELECT
           SUM(CASE WHEN event_type = 0 THEN count ELSE 0 END) AS api_total,
           SUM(CASE WHEN event_type = 1 THEN count ELSE 0 END) AS mcp_total
         FROM analytics`,
      )
      .first(),

    // IDL-presence + verified-build coverage across the FULL sync universe
    // (`program_candidates` — every program_id the discovery pipeline has
    // ever queued/scanned, PK-deduped, ~60K+ rows), not just the small
    // imported `projects` catalog. status='has_idl' means the sync pipeline
    // confirmed an on-chain IDL (see idl-sync.ts). is_verified is tracked
    // only on imported `projects` rows and set per program_id (see
    // verified-match-workflow.ts), so dedupe verified via DISTINCT program_id.
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM program_candidates) AS total,
           (SELECT COUNT(*) FROM program_candidates WHERE status = 'has_idl') AS with_idl,
           (SELECT COUNT(DISTINCT program_id) FROM projects WHERE is_verified = 1) AS verified,
           (SELECT COUNT(DISTINCT pc.program_id)
              FROM program_candidates pc
              INNER JOIN projects p ON p.program_id = pc.program_id
              WHERE pc.status = 'has_idl' AND p.is_verified = 1) AS with_idl_and_verified`,
      )
      .first(),

    // Total Workflow instances ever created (chain-discovery, idl-sync,
    // osec-discover, candidates-import, verified-match/-analysis, ...)
    db
      .prepare(`SELECT COUNT(*) AS total FROM workflow_instances`)
      .first(),

    // Total IDL versions ever uploaded across public projects (all
    // versions, not just latest — depth/maturity signal)
    db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM idl_versions v
         INNER JOIN projects p ON p.id = v.project_id
         WHERE p.is_public = 1`,
      )
      .first(),
  ])

  // D1 may return BigInt for COUNT/SUM — coerce explicitly
  return {
    daily_api: (dailyApi.results ?? []) as AnalyticsSummary['daily_api'],
    daily_mcp: (dailyMcp.results ?? []) as AnalyticsSummary['daily_mcp'],
    top_programs: (topPrograms.results ?? []) as AnalyticsSummary['top_programs'],
    totals_alltime: {
      api: Number((allTimeTotals as any)?.api_total ?? 0),
      mcp: Number((allTimeTotals as any)?.mcp_total ?? 0),
    },
    platform: {
      total_programs: Number((verifiedStats as any)?.total ?? 0),
      programs_with_idl: Number((verifiedStats as any)?.with_idl ?? 0),
      verified_programs: Number((verifiedStats as any)?.verified ?? 0),
      programs_with_idl_and_verified: Number((verifiedStats as any)?.with_idl_and_verified ?? 0),
      workflow_runs_total: Number((workflowRuns as any)?.total ?? 0),
      idl_versions_total: Number((idlVersionsTotal as any)?.total ?? 0),
    },
  }
}
