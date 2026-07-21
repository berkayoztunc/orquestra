/**
 * Shared "compile a published flow's plan (cached) and run it" logic — used
 * by both the REST `POST /flows/:slug/estimate` endpoint and the MCP
 * `estimate_flow` tool, so an MCP-only client can actually run a flow it
 * found via list_flows/get_flow_metadata without needing separate REST
 * access. Also owns the in-isolate compiled-plan cache (content-addressed,
 * no invalidation needed) so both entry points share the same cache instead
 * of each compiling independently.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { compile, type FlowPlan } from '../flow-engine/compiler'
import { run, type RunResult } from '../flow-engine/interpreter'
import type { FlowDocument } from '../flow-engine/fdl-schema'
import type { NodeContext } from '../flow-engine/types'

const planCache = new Map<string, FlowPlan>()

/** Store an already-compiled plan (e.g. right after publish) so the next estimate/run skips recompiling. */
export function cachePlan(plan: FlowPlan): void {
  planCache.set(plan.hash, plan)
}

export async function compilePlan(fdlJson: string, contentHash: string): Promise<FlowPlan> {
  const cached = planCache.get(contentHash)
  if (cached) return cached

  const doc = JSON.parse(fdlJson) as FlowDocument
  const result = await compile(doc)
  if (!result.ok) {
    const detail = result.errors.map((e) => `${e.nodeId ?? e.path ?? ''}: ${e.message}`).join('; ')
    throw new Error(`stored flow version ${contentHash} failed to compile: ${detail}`)
  }
  planCache.set(contentHash, result.plan)
  return result.plan
}

export interface EstimateFlowOutcome {
  versionHash: string
  latencyMs: number
  result: RunResult
}

export type EstimateFlowResult =
  | { ok: true; outcome: EstimateFlowOutcome }
  | { ok: false; kind: 'not_found'; reason: string }

/** Looks up a published flow by slug, compiles (cached), and runs it against `inputs`. */
export async function estimateFlow(db: D1Database, ctx: NodeContext, slug: string, inputs: Record<string, unknown>): Promise<EstimateFlowResult> {
  const row = await db
    .prepare(
      `SELECT v.content_hash, v.fdl_json
       FROM flows f
       JOIN flow_versions v ON v.content_hash = f.stable_version_hash
       WHERE f.slug = ? AND f.status = 'published'`,
    )
    .bind(slug)
    .first<{ content_hash: string; fdl_json: string }>()

  if (!row) {
    return { ok: false, kind: 'not_found', reason: `No published flow with slug "${slug}".` }
  }

  const plan = await compilePlan(row.fdl_json, row.content_hash)
  const startedAt = Date.now()
  const result = await run(plan, inputs, ctx)
  const latencyMs = Date.now() - startedAt

  return { ok: true, outcome: { versionHash: row.content_hash, latencyMs, result } }
}
