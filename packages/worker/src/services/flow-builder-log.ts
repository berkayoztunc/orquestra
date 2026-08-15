/**
 * Audit log + approval-queue writes for the Flow Builder Agent (migration
 * 026). One `flow_builder_attempts` row per attempt regardless of outcome —
 * this table doubles as the Telegram approval queue (filter `outcome =
 * 'proposed'`), so there is no separate queue table. Large blobs (the draft
 * FDL/plan/raw AI response) live in the sibling `flow_builder_drafts` table,
 * kept off this row for the same reason `flow_versions` keeps them off the
 * lighter `flows` catalog row.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { generateId } from '../utils/id'
import type { FlowDocument } from '../flow-engine/fdl-schema'
import type { FlowPlan } from '../flow-engine/compiler'

export type FlowBuilderOutcome =
  | 'compile_failed'
  | 'simulate_failed'
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'published'
  | 'publish_failed'
  | 'skipped_no_improvement'

export interface ParamClassification {
  input: string[]
  resolvable: string[]
  constant: string[]
}

/**
 * Classifies each FDL node's declared inputs into Input / Resolvable /
 * Constant for the Telegram proposal message (§4 of the plan): a flow's
 * `inputs` block entries are "Input"; `resolve.constant@1` node outputs are
 * "Constant"; everything else produced by any other `resolve.*` node
 * (pda/ata/pda_state/account_data/accounts_by_filter/blockhash/quote) is
 * "Resolvable". Computed once at proposal time so it can't drift from what
 * was actually proposed if the flow is later re-simulated at approval.
 */
export function classifyParams(doc: FlowDocument): ParamClassification {
  const input = Object.keys(doc.inputs ?? {})
  const resolvable: string[] = []
  const constant: string[] = []

  for (const node of doc.nodes) {
    const [type] = node.type.split('@')
    if (!type.startsWith('resolve.')) continue
    if (type === 'resolve.constant') {
      constant.push(node.id)
    } else {
      resolvable.push(node.id)
    }
  }

  return { input, resolvable, constant }
}

export interface AttemptInput {
  programId: string
  projectId?: string | null
  projectName?: string | null
  reason: 'no_flow' | 'optimization_candidate'
  reasonDetail?: string | null
  priorFlowId?: string | null
  priorInputCount?: number | null
  priorRpcCalls?: number | null
  model: string
  promptTokens?: number | null
  completionTokens?: number | null
  neuronsEstimated?: number | null
  usdEstimated?: number | null
  attemptRounds: number
  workflowInstanceId?: string | null
}

export interface AttemptOutcomeInput {
  outcome: FlowBuilderOutcome
  fdlContentHash?: string | null
  newInputCount?: number | null
  newRpcCalls?: number | null
  rationale?: string | null
  errorDetail?: string | null
}

export interface AttemptDraftInput {
  doc?: FlowDocument
  plan?: FlowPlan
  rawAiResponse?: string
}

/** Writes the attempts row for one candidate; call once per attempt, whatever the outcome. */
export async function recordAttempt(
  db: D1Database,
  input: AttemptInput,
  outcomeInput: AttemptOutcomeInput,
  draft?: AttemptDraftInput,
): Promise<string> {
  const id = generateId()
  const now = new Date().toISOString()

  await db
    .prepare(
      `INSERT INTO flow_builder_attempts (
         id, workflow_instance_id, program_id, project_id, project_name,
         reason, reason_detail, prior_flow_id, prior_input_count, prior_rpc_calls,
         model, prompt_tokens, completion_tokens, neurons_estimated, usd_estimated,
         attempt_rounds, fdl_content_hash, new_input_count, new_rpc_calls, rationale,
         outcome, error_detail, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.workflowInstanceId ?? null,
      input.programId,
      input.projectId ?? null,
      input.projectName ?? null,
      input.reason,
      input.reasonDetail ?? null,
      input.priorFlowId ?? null,
      input.priorInputCount ?? null,
      input.priorRpcCalls ?? null,
      input.model,
      input.promptTokens ?? null,
      input.completionTokens ?? null,
      input.neuronsEstimated ?? null,
      input.usdEstimated ?? null,
      input.attemptRounds,
      outcomeInput.fdlContentHash ?? null,
      outcomeInput.newInputCount ?? null,
      outcomeInput.newRpcCalls ?? null,
      outcomeInput.rationale ?? null,
      outcomeInput.outcome,
      outcomeInput.errorDetail ?? null,
      now,
      now,
    )
    .run()

  if (draft && (draft.doc || draft.rawAiResponse)) {
    await db
      .prepare(
        `INSERT INTO flow_builder_drafts (attempt_id, fdl_json, plan_json, raw_ai_response, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        draft.doc ? JSON.stringify(draft.doc) : '{}',
        draft.plan ? JSON.stringify(draft.plan) : null,
        draft.rawAiResponse ?? null,
        now,
      )
      .run()
  }

  return id
}

export async function setTelegramMessage(
  db: D1Database,
  attemptId: string,
  telegramMessageId: string,
  telegramChatId: string,
): Promise<void> {
  await db
    .prepare(`UPDATE flow_builder_attempts SET telegram_message_id = ?, telegram_chat_id = ?, updated_at = ? WHERE id = ?`)
    .bind(telegramMessageId, telegramChatId, new Date().toISOString(), attemptId)
    .run()
}

export interface AttemptRow {
  id: string
  program_id: string
  project_name: string | null
  outcome: FlowBuilderOutcome
  telegram_message_id: string | null
  telegram_chat_id: string | null
}

export async function getAttempt(db: D1Database, attemptId: string): Promise<AttemptRow | null> {
  return db.prepare(`SELECT * FROM flow_builder_attempts WHERE id = ?`).bind(attemptId).first<AttemptRow>()
}

export interface DraftRow {
  attempt_id: string
  fdl_json: string
}

export async function getDraft(db: D1Database, attemptId: string): Promise<DraftRow | null> {
  return db.prepare(`SELECT * FROM flow_builder_drafts WHERE attempt_id = ?`).bind(attemptId).first<DraftRow>()
}

export interface AttemptsSummary {
  windowHours: number
  counts: Record<string, number>
  totalCostUsd: number
}

/** Powers the Telegram /status command and the (future) daily digest. */
export async function getRecentAttemptsSummary(db: D1Database, windowHours = 24): Promise<AttemptsSummary> {
  const { results } = await db
    .prepare(
      `SELECT outcome, COUNT(*) AS n, COALESCE(SUM(usd_estimated), 0) AS cost
       FROM flow_builder_attempts
       WHERE created_at > datetime('now', ?)
       GROUP BY outcome`,
    )
    .bind(`-${windowHours} hours`)
    .all<{ outcome: string; n: number; cost: number }>()

  const counts: Record<string, number> = {}
  let totalCostUsd = 0
  for (const row of results ?? []) {
    counts[row.outcome] = row.n
    totalCostUsd += row.cost ?? 0
  }
  return { windowHours, counts, totalCostUsd }
}

export interface PendingAttemptRow {
  id: string
  program_id: string
  project_name: string | null
  created_at: string
}

/** Attempts still awaiting a Telegram approve/reject tap. */
export async function getPendingAttempts(db: D1Database, limit = 10): Promise<PendingAttemptRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, program_id, project_name, created_at FROM flow_builder_attempts
       WHERE outcome = 'proposed' ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<PendingAttemptRow>()
  return results ?? []
}

/**
 * Guard-transitions an attempt's outcome, only if it's still in `fromOutcome`
 * — makes the Telegram callback handler idempotent against duplicate webhook
 * deliveries / double-clicks (0 rows changed = already resolved).
 */
export async function transitionOutcome(
  db: D1Database,
  attemptId: string,
  fromOutcome: FlowBuilderOutcome,
  toOutcome: FlowBuilderOutcome,
  extra?: { errorDetail?: string | null; fdlContentHash?: string | null },
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE flow_builder_attempts
       SET outcome = ?, error_detail = COALESCE(?, error_detail), fdl_content_hash = COALESCE(?, fdl_content_hash), updated_at = ?
       WHERE id = ? AND outcome = ?`,
    )
    .bind(toOutcome, extra?.errorDetail ?? null, extra?.fdlContentHash ?? null, new Date().toISOString(), attemptId, fromOutcome)
    .run()
  return (result.meta?.changes ?? 0) > 0
}
