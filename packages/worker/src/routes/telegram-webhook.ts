/**
 * Telegram webhook receiver for the Flow Builder Agent (migration 026) — the
 * "Approve" callback path: single-gate re-verify + publish, no second manual
 * step. New route, mounted at `/telegram` in index.ts.
 */

import { Hono, type Context } from 'hono'
import type { D1Database, KVNamespace } from '@cloudflare/workers-types'

import { registerAllNodes } from '../flow-engine'
import { compile } from '../flow-engine/compiler'
import { run } from '../flow-engine/interpreter'
import type { FlowDocument } from '../flow-engine/fdl-schema'
import type { NodeContext } from '../flow-engine/types'
import { resolveSolanaRpcUrl } from '../utils/solana-rpc'
import { publishFlowVersion } from '../services/flow-publisher'
import { cachePlan } from '../services/flow-estimator'
import { getAttempt, getDraft, transitionOutcome } from '../services/flow-builder-log'
import { editProposalMessage, answerCallbackQuery } from '../services/telegram'
import { verifyIngestKey } from '../middleware/auth'

registerAllNodes()

type Bindings = {
  DB: D1Database
  CACHE: KVNamespace
  IDLS: KVNamespace
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
  TELEGRAM_WEBHOOK_SECRET?: string
  SOLANA_RPC_URL?: string
  SOLANA_MAINNET_RPC_URL?: string
  SOLANA_FALLBACK_RPC_URLS?: string
  SOLANA_MAINNET_FALLBACK_RPC_URLS?: string
}

const app = new Hono<{ Bindings: Bindings }>()

interface TelegramCallbackQuery {
  id: string
  data?: string
  message?: { message_id: number; chat: { id: number } }
}

async function handleReject(c: Context<{ Bindings: Bindings }>, attemptId: string): Promise<void> {
  const attempt = await getAttempt(c.env.DB, attemptId)
  if (!attempt) return
  const changed = await transitionOutcome(c.env.DB, attemptId, 'proposed', 'rejected')
  if (!changed || !attempt.telegram_chat_id || !attempt.telegram_message_id) return
  await editProposalMessage(c.env, {
    chatId: attempt.telegram_chat_id,
    messageId: attempt.telegram_message_id,
    text: `❌ Rejected — attempt ${attemptId}`,
  })
}

async function handleApprove(c: Context<{ Bindings: Bindings }>, attemptId: string): Promise<void> {
  const attempt = await getAttempt(c.env.DB, attemptId)
  if (!attempt) return

  const changed = await transitionOutcome(c.env.DB, attemptId, 'proposed', 'approved')
  if (!changed) {
    // Already resolved (double-click / duplicate webhook delivery) — no-op.
    return
  }

  const editTarget =
    attempt.telegram_chat_id && attempt.telegram_message_id
      ? { chatId: attempt.telegram_chat_id, messageId: attempt.telegram_message_id }
      : null

  const draft = await getDraft(c.env.DB, attemptId)
  if (!draft) {
    await transitionOutcome(c.env.DB, attemptId, 'approved', 'publish_failed', { errorDetail: 'draft FDL missing' })
    if (editTarget) await editProposalMessage(c.env, { ...editTarget, text: `⚠️ Not published — draft FDL missing for attempt ${attemptId}` })
    return
  }

  const doc = JSON.parse(draft.fdl_json) as FlowDocument

  // Re-validate + re-simulate fresh — never trust the stored simulation as
  // still-valid at approval time (IDL/on-chain state may have drifted since
  // the proposal was sent).
  const compiled = await compile(doc)
  if (!compiled.ok) {
    const errorDetail = compiled.errors.map((e) => `${e.nodeId ?? e.path ?? ''}: ${e.message}`).join('; ')
    await transitionOutcome(c.env.DB, attemptId, 'approved', 'publish_failed', { errorDetail })
    if (editTarget) await editProposalMessage(c.env, { ...editTarget, text: `⚠️ Re-validation failed at approval time — not published: ${errorDetail}` })
    return
  }

  const { rpcUrl } = resolveSolanaRpcUrl({ network: 'mainnet-beta', env: c.env })
  const nodeCtx: NodeContext = { db: c.env.DB, cache: c.env.CACHE, idls: c.env.IDLS, rpcUrl }
  // Synthetic inputs only re-exercise the resolvable/structural path here —
  // same caveat as the workflow's original simulation (see
  // flow-builder-agent-workflow.ts header comment).
  const syntheticInputs: Record<string, unknown> = {}
  for (const [key, spec] of Object.entries(compiled.plan.inputs)) {
    if (spec.default !== undefined) syntheticInputs[key] = spec.default
    else if (spec.type === 'pubkey') syntheticInputs[key] = '11111111111111111111111111111111'
    else if (spec.type === 'bool') syntheticInputs[key] = true
    else if (spec.type === 'string') syntheticInputs[key] = 'test'
    else syntheticInputs[key] = 1
  }
  const simResult = await run(compiled.plan, syntheticInputs, nodeCtx)
  if (!simResult.ok) {
    const errorDetail = `${simResult.error.nodeId ?? '(top-level)'}: ${simResult.error.message}`
    await transitionOutcome(c.env.DB, attemptId, 'approved', 'publish_failed', { errorDetail })
    if (editTarget) await editProposalMessage(c.env, { ...editTarget, text: `⚠️ Re-simulation failed at approval time — not published: ${errorDetail}` })
    return
  }

  const publishResult = await publishFlowVersion(c.env.DB, doc, compiled.plan, {
    tier: 'instruction',
    publish: true,
    programId: attempt.program_id,
  })
  cachePlan(compiled.plan)
  await transitionOutcome(c.env.DB, attemptId, 'approved', 'published', { fdlContentHash: publishResult.contentHash })
  if (editTarget) {
    await editProposalMessage(c.env, {
      ...editTarget,
      text: `✅ Published — slug \`${publishResult.slug}\`, hash \`${publishResult.contentHash}\``,
    })
  }
}

app.post('/webhook', async (c) => {
  const secretHeader = c.req.header('X-Telegram-Bot-Api-Secret-Token')
  if (!verifyIngestKey(secretHeader, c.env.TELEGRAM_WEBHOOK_SECRET)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const body = await c.req.json().catch(() => null)
  const callbackQuery = body?.callback_query as TelegramCallbackQuery | undefined

  // Only callback_query updates matter here; everything else (plain messages,
  // edited_message, etc.) gets a bare 200 so Telegram doesn't retry.
  if (!callbackQuery?.data) {
    return c.json({ ok: true })
  }

  const [action, attemptId] = callbackQuery.data.split(':')
  if (!attemptId || (action !== 'flow_approve' && action !== 'flow_reject')) {
    return c.json({ ok: true })
  }

  try {
    if (action === 'flow_approve') {
      await handleApprove(c, attemptId)
    } else {
      await handleReject(c, attemptId)
    }
  } catch (err) {
    console.error('[telegram-webhook] callback handling failed:', err)
  }

  await answerCallbackQuery(c.env, { callbackQueryId: callbackQuery.id })
  return c.json({ ok: true })
})

export default app
