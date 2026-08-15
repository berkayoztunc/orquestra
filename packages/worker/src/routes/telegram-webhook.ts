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
import { buildSyntheticInputs } from '../services/flow-simulation-inputs'
import { publishFlowVersion } from '../services/flow-publisher'
import { cachePlan } from '../services/flow-estimator'
import { getAttempt, getDraft, transitionOutcome, getRecentAttemptsSummary, getPendingAttempts } from '../services/flow-builder-log'
import { editProposalMessage, answerCallbackQuery, sendText } from '../services/telegram'
import { recordWorkflowInstance } from '../services/workflow-registry'
import { verifyIngestKey } from '../middleware/auth'

registerAllNodes()

type Bindings = {
  DB: D1Database
  CACHE: KVNamespace
  IDLS: KVNamespace
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
  TELEGRAM_WEBHOOK_SECRET?: string
  FLOW_BUILDER_AGENT_WORKFLOW?: { create(opts: { params: Record<string, unknown> }): Promise<{ id: string }> }
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
  // Same synthetic inputs the agent and workflow simulate with, so a draft that
  // passed there cannot fail here purely because the three call sites disagreed
  // on what to fill in (they used to).
  const simResult = await run(compiled.plan, buildSyntheticInputs(compiled.plan.inputs), nodeCtx)
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
      text: `✅ Published — slug ${publishResult.slug}, hash ${publishResult.contentHash}`,
    })
  }
}

const HELP_TEXT = [
  '🤖 Flow Builder Agent',
  '',
  '/status - activity in the last 24h',
  '/pending - proposals awaiting approve/reject',
  '/trigger [programId] - run the agent now (top candidates, or one program if given)',
  '/help - this message',
].join('\n')

async function handleStatus(c: Context<{ Bindings: Bindings }>, chatId: string): Promise<void> {
  const summary = await getRecentAttemptsSummary(c.env.DB, 24)
  const lines = [
    (`📊 Last ${summary.windowHours}h`),
    '',
    ...Object.entries(summary.counts).map(([outcome, n]) => (`${outcome}: ${n}`)),
    Object.keys(summary.counts).length === 0 ? ('no attempts yet') : '',
    '',
    (`Est. cost: $${summary.totalCostUsd.toFixed(4)}`),
  ].filter(Boolean)
  await sendText(c.env, chatId, lines.join('\n'))
}

async function handlePending(c: Context<{ Bindings: Bindings }>, chatId: string): Promise<void> {
  const pending = await getPendingAttempts(c.env.DB, 10)
  if (pending.length === 0) {
    await sendText(c.env, chatId, ('No proposals awaiting approval.'))
    return
  }
  const lines = [(`⏳ ${pending.length} pending:`), '']
  for (const p of pending) {
    lines.push((`${p.project_name ?? p.program_id} — attempt ${p.id} (${p.created_at})`))
  }
  await sendText(c.env, chatId, lines.join('\n'))
}

/** Loose Solana base58 address shape check — 32-44 chars, base58 alphabet. */
const BASE58_PROGRAM_ID_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

async function handleTrigger(c: Context<{ Bindings: Bindings }>, chatId: string, programId?: string): Promise<void> {
  if (programId && !BASE58_PROGRAM_ID_RE.test(programId)) {
    await sendText(c.env, chatId, (`"${programId}" doesn't look like a valid program ID.`))
    return
  }
  const workflow = c.env.FLOW_BUILDER_AGENT_WORKFLOW
  if (!workflow) {
    await sendText(c.env, chatId, ('FLOW_BUILDER_AGENT_WORKFLOW binding not available.'))
    return
  }
  const instance = await workflow.create({ params: { trigger: 'admin', programId } })
  await recordWorkflowInstance(c.env.DB, { instanceId: instance.id, workflow: 'flow-builder-agent', trigger: 'admin' })
  const scope = programId ? `for ${programId}` : '(top candidates)'
  await sendText(c.env, chatId, `🚀 Started ${scope} — instance ${instance.id}`)
}

async function handleCommand(c: Context<{ Bindings: Bindings }>, chatId: string, text: string): Promise<void> {
  const parts = text.trim().split(/\s+/)
  const command = parts[0].split('@')[0]
  switch (command) {
    case '/status':
      return handleStatus(c, chatId)
    case '/pending':
      return handlePending(c, chatId)
    case '/trigger':
      return handleTrigger(c, chatId, parts[1])
    case '/start':
    case '/help':
      await sendText(c.env, chatId, HELP_TEXT)
      return
    default:
      return
  }
}

app.post('/webhook', async (c) => {
  const secretHeader = c.req.header('X-Telegram-Bot-Api-Secret-Token')
  if (!verifyIngestKey(secretHeader, c.env.TELEGRAM_WEBHOOK_SECRET)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const body = await c.req.json().catch(() => null)
  const callbackQuery = body?.callback_query as TelegramCallbackQuery | undefined
  const message = body?.message as { text?: string; chat?: { id: number } } | undefined

  // Admin-only surface — every command and every callback is restricted to
  // the configured TELEGRAM_CHAT_ID, regardless of who messages the bot.
  const senderChatId = String(callbackQuery?.message?.chat.id ?? message?.chat?.id ?? '')
  const isAdmin = Boolean(c.env.TELEGRAM_CHAT_ID) && senderChatId === c.env.TELEGRAM_CHAT_ID

  if (callbackQuery?.data) {
    const [action, attemptId] = callbackQuery.data.split(':')
    if (attemptId && (action === 'flow_approve' || action === 'flow_reject') && isAdmin) {
      try {
        if (action === 'flow_approve') {
          await handleApprove(c, attemptId)
        } else {
          await handleReject(c, attemptId)
        }
      } catch (err) {
        console.error('[telegram-webhook] callback handling failed:', err)
      }
    }
    await answerCallbackQuery(c.env, { callbackQueryId: callbackQuery.id })
    return c.json({ ok: true })
  }

  if (message?.text?.startsWith('/') && isAdmin) {
    try {
      await handleCommand(c, senderChatId, message.text)
    } catch (err) {
      console.error('[telegram-webhook] command handling failed:', err)
    }
  }

  return c.json({ ok: true })
})

export default app
