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
  opts: { tier?: string; publish?: boolean; programId?: string; requireProof?: boolean } = {},
): Promise<PublishFlowResult> {
  const slug = plan.meta.slug
  const tier = opts.tier ?? 'instruction'
  const publish = opts.publish ?? true
  const now = new Date().toISOString()

  // A LIVE flow must have been RUN at least once, not merely compiled.
  //
  // `publish_flow` describes its input as a "proven FDL document" and the documented
  // sequence is validate_flow -> simulate_flow -> publish_flow, but nothing enforced the
  // middle step: every caller reaches here after `compile()`, which is deliberately
  // static (no RPC, no IDL). A document naming an instruction the target program does not
  // have compiles cleanly, gets a content hash, and can go live.
  //
  // Observed: a flow naming `swap_router_base_in` compiled OK against Orca whirlpool and
  // Byreal Clmm, neither of which declares that instruction.
  //
  // The evidence already exists in this schema — `simulate_flow` writes a `flow_runs` row
  // keyed by the same `version_hash` this function is about to publish — so the check is a
  // lookup, not new machinery.
  //
  // OPT-IN ON PURPOSE. It is off unless a caller asks for it, and only the two EXTERNAL
  // entry points do: the `publish_flow` MCP tool and `POST /flows`. The in-process
  // flow-builder workflow already simulates before publishing and is left exactly as it
  // was, as are the existing tests — a drive-by change should not redefine what every
  // internal caller means by "publish". Drafts are never gated: this applies only to
  // `publish: true`.
  if (publish && opts.requireProof) {
    const proof = await db
      .prepare(`SELECT 1 AS ok FROM flow_runs WHERE version_hash = ? AND status = 'ok' LIMIT 1`)
      .bind(plan.hash)
      .first<{ ok: number }>()
    if (!proof) {
      throw new Error(
        `flow "${slug}" has never run successfully (no flow_runs row for content hash ` +
          `${plan.hash} with status 'ok'). Call simulate_flow on this exact document first, ` +
          `or publish it as a draft. Compiling proves the document's structure, not that ` +
          `its instructions exist on the target program.`,
      )
    }
  }

  const existingFlow = await db.prepare('SELECT id FROM flows WHERE slug = ?').bind(slug).first<{ id: string }>()
  let flowId: string
  if (!existingFlow) {
    flowId = generateId()
    await db
      .prepare(
        `INSERT INTO flows (id, slug, intent, protocol, tier, status, program_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      )
      .bind(flowId, slug, plan.meta.intent, plan.meta.protocol ?? null, tier, opts.programId ?? null, now, now)
      .run()
  } else {
    flowId = existingFlow.id
    if (opts.programId) {
      await db.prepare(`UPDATE flows SET program_id = ? WHERE id = ?`).bind(opts.programId, flowId).run()
    }
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
