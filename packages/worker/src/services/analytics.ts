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
 * MCP tool_id enum — must stay in sync with the tool registration order
 * in routes/mcp.ts.
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
