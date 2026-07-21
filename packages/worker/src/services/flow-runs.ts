/**
 * Records one row per flow execution into D1 `flow_runs` (migration 024) —
 * shared by both the REST `estimate` endpoint (routes/flows.ts) and the MCP
 * `simulate_flow` tool (routes/flow-mcp.ts), so every run of the engine's
 * interpreter is observable the same way regardless of entry point. The
 * table previously existed in the schema with nothing ever writing to it.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { generateId } from '../utils/id'
import { canonicalize, sha256Hex } from '../flow-engine/compiler'
import type { RunResult } from '../flow-engine/interpreter'

export async function recordFlowRun(
  db: D1Database,
  params: {
    versionHash: string
    lane?: 'hot' | 'durable'
    inputs: Record<string, unknown>
    result: RunResult
    latencyMs: number
  },
): Promise<void> {
  const id = generateId()
  const inputsHash = await sha256Hex(JSON.stringify(canonicalize(params.inputs)))
  const status = params.result.ok ? 'ok' : 'error'
  const errorJson = params.result.ok ? null : JSON.stringify(params.result.error)

  await db
    .prepare(
      `INSERT INTO flow_runs
         (id, version_hash, lane, status, inputs_hash, outputs_json, error_json, latency_ms, rpc_calls, external_calls, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      params.versionHash,
      params.lane ?? 'hot',
      status,
      inputsHash,
      JSON.stringify(params.result.nodeOutputs),
      errorJson,
      Math.round(params.latencyMs),
      params.result.rpcCalls,
      params.result.externalCalls,
      new Date().toISOString(),
    )
    .run()
}
