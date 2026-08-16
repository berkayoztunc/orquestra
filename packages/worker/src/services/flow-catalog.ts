/**
 * Flow catalog read path — listing/searching/fetching published flows.
 * Shared by the REST endpoints (routes/flows.ts) and the discovery MCP tools
 * (routes/flow-mcp.ts: list_flows, get_flow_metadata) so an MCP-only client
 * (no REST access) can still find and inspect published flows, not just
 * author new ones.
 */

import type { D1Database } from '@cloudflare/workers-types'

interface FlowCatalogRow {
  slug: string
  intent: string
  protocol: string | null
  tier: string
  metadata_json: string
}

export interface FlowMeta {
  slug: string
  name: string
  description?: string
  intent: string
  protocol?: string
  programs?: string[]
  networks?: string[]
}

export interface FlowSummary {
  slug: string
  intent: string
  protocol: string | null
  tier: string
  meta: FlowMeta
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
  /** Logo for `meta.programs[0]` (the flow's primary program), from program_categories — null when unset/unverified. */
  iconUrl?: string | null
}

async function fetchPublishedFlows(db: D1Database): Promise<FlowCatalogRow[]> {
  const { results } = await db
    .prepare(
      `SELECT f.slug, f.intent, f.protocol, f.tier, v.metadata_json
       FROM flows f
       JOIN flow_versions v ON v.content_hash = f.stable_version_hash
       WHERE f.status = 'published'
       ORDER BY f.slug`,
    )
    .all<FlowCatalogRow>()
  return results ?? []
}

function rowToSummary(row: FlowCatalogRow): FlowSummary {
  const metadata = JSON.parse(row.metadata_json) as { meta: FlowMeta; inputs: Record<string, unknown>; outputs: Record<string, unknown> }
  return { slug: row.slug, intent: row.intent, protocol: row.protocol, tier: row.tier, ...metadata }
}

/**
 * Attaches `iconUrl` for each summary's primary program (`meta.programs[0]`)
 * via one batch lookup against `program_categories`, instead of a per-flow
 * query. Mutates and returns the same array for convenience at call sites.
 */
async function attachIconUrls(db: D1Database, summaries: FlowSummary[]): Promise<FlowSummary[]> {
  const programIds = [...new Set(summaries.map((f) => f.meta.programs?.[0]).filter((id): id is string => Boolean(id)))]
  if (programIds.length === 0) return summaries

  const placeholders = programIds.map(() => '?').join(',')
  const { results } = await db
    .prepare(`SELECT program_id, icon_url FROM program_categories WHERE program_id IN (${placeholders})`)
    .bind(...programIds)
    .all<{ program_id: string; icon_url: string | null }>()

  const iconByProgram = new Map((results ?? []).map((r) => [r.program_id, r.icon_url]))
  for (const summary of summaries) {
    const primaryProgram = summary.meta.programs?.[0]
    summary.iconUrl = primaryProgram ? (iconByProgram.get(primaryProgram) ?? null) : null
  }
  return summaries
}

export interface ListFlowsFilter {
  /** Free-text substring match (case-insensitive) against slug, name, intent, protocol, and program addresses. */
  query?: string
  intent?: string
  protocol?: string
  limit?: number
}

/**
 * Lists + searches published flows. Simple substring filtering over the small
 * in-memory catalog, not SQLite FTS — fine at the catalog sizes this engine
 * has today; worth revisiting if the catalog grows into the thousands.
 */
export async function listFlows(db: D1Database, filter: ListFlowsFilter = {}): Promise<FlowSummary[]> {
  const rows = await fetchPublishedFlows(db)
  let summaries = rows.map(rowToSummary)

  if (filter.intent) {
    summaries = summaries.filter((f) => f.intent === filter.intent)
  }
  if (filter.protocol) {
    summaries = summaries.filter((f) => f.protocol === filter.protocol)
  }
  if (filter.query) {
    const q = filter.query.toLowerCase()
    summaries = summaries.filter((f) => {
      const haystack = [f.slug, f.meta.name, f.intent, f.protocol, ...(f.meta.programs ?? [])].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }
  if (filter.limit && filter.limit > 0) {
    summaries = summaries.slice(0, filter.limit)
  }
  return attachIconUrls(db, summaries)
}

export async function getFlowMetadata(db: D1Database, slug: string): Promise<FlowSummary | null> {
  const row = await db
    .prepare(
      `SELECT f.slug, f.intent, f.protocol, f.tier, v.metadata_json
       FROM flows f
       JOIN flow_versions v ON v.content_hash = f.stable_version_hash
       WHERE f.slug = ? AND f.status = 'published'`,
    )
    .bind(slug)
    .first<FlowCatalogRow>()
  if (!row) return null
  const [summary] = await attachIconUrls(db, [rowToSummary(row)])
  return summary
}
