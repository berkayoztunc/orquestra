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
  return summaries
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
  return row ? rowToSummary(row) : null
}
