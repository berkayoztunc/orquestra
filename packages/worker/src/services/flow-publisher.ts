/**
 * Shared publish logic for the flow registry (D1 `flows`/`flow_versions`,
 * migration 024). Used by both the HTTP admin endpoint (`POST /flows`,
 * routes/flows.ts) and the MCP `publish_flow` tool (routes/mcp.ts) so the
 * upsert/versioning logic exists in exactly one place.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { generateId } from '../utils/id'
import type { FlowDocument } from '../flow-engine/fdl-schema'
import type { FlowPlan } from '../flow-engine/compiler'

export interface PublishFlowResult {
  slug: string
  flowId: string
  contentHash: string
  status: 'published' | 'draft'
}

export async function publishFlowVersion(
  db: D1Database,
  doc: FlowDocument,
  plan: FlowPlan,
  opts: { tier?: string; publish?: boolean } = {},
): Promise<PublishFlowResult> {
  const slug = plan.meta.slug
  const tier = opts.tier ?? 'instruction'
  const publish = opts.publish ?? true
  const now = new Date().toISOString()

  const existingFlow = await db.prepare('SELECT id FROM flows WHERE slug = ?').bind(slug).first<{ id: string }>()
  let flowId: string
  if (!existingFlow) {
    flowId = generateId()
    await db
      .prepare(
        `INSERT INTO flows (id, slug, intent, protocol, tier, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
      )
      .bind(flowId, slug, plan.meta.intent, plan.meta.protocol ?? null, tier, now, now)
      .run()
  } else {
    flowId = existingFlow.id
  }

  const existingVersion = await db
    .prepare('SELECT content_hash FROM flow_versions WHERE content_hash = ?')
    .bind(plan.hash)
    .first<{ content_hash: string }>()

  if (!existingVersion) {
    const versionRow = await db
      .prepare('SELECT COALESCE(MAX(version), 0) AS max_version FROM flow_versions WHERE flow_id = ?')
      .bind(flowId)
      .first<{ max_version: number }>()
    const nextVersion = (versionRow?.max_version ?? 0) + 1

    const metadataJson = JSON.stringify({ meta: plan.meta, inputs: plan.inputs, outputs: plan.outputs })
    await db
      .prepare(
        `INSERT INTO flow_versions (content_hash, flow_id, version, fdl_json, plan_json, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(plan.hash, flowId, nextVersion, JSON.stringify(doc), JSON.stringify(plan), metadataJson, now)
      .run()
  }

  if (publish) {
    await db
      .prepare(`UPDATE flows SET status = 'published', stable_version_hash = ?, updated_at = ? WHERE id = ?`)
      .bind(plan.hash, now, flowId)
      .run()
  } else {
    await db.prepare(`UPDATE flows SET updated_at = ? WHERE id = ?`).bind(now, flowId).run()
  }

  return { slug, flowId, contentHash: plan.hash, status: publish ? 'published' : 'draft' }
}
