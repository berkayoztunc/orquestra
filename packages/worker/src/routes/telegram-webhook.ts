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
import { editProposalMessage, answerCallbackQuery, sendText, sendButtonMenu, setBotCommands, type ButtonRow } from '../services/telegram'
import { recordWorkflowInstance } from '../services/workflow-registry'
import { verifyIngestKey } from '../middleware/auth'
import { computePipelineHealth, runPipelineHealthCheck, startCandidatesImport, type HealthEnv } from '../services/pipeline-health'
import { getAnalyticsSummary } from '../services/analytics'

registerAllNodes()

/** Every workflow binding a Telegram admin action can create an instance of. */
type WorkflowBinding = { create(opts: { params: Record<string, unknown> }): Promise<{ id: string }> }

type Bindings = {
  DB: D1Database
  CACHE: KVNamespace
  IDLS: KVNamespace
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
  TELEGRAM_WEBHOOK_SECRET?: string
  FLOW_BUILDER_AGENT_WORKFLOW?: WorkflowBinding
  IDL_SYNC_WORKFLOW?: WorkflowBinding
  IDL_UPDATE_CACHE_WORKFLOW?: WorkflowBinding
  BULK_RECATEGORIZE_WORKFLOW?: WorkflowBinding
  VERIFIED_ANALYSIS_WORKFLOW?: WorkflowBinding
  OSEC_DISCOVER_WORKFLOW?: WorkflowBinding
  VERIFIED_MATCH_WORKFLOW?: WorkflowBinding
  VERIFIED_IDL_IMPORT_WORKFLOW?: WorkflowBinding
  CANDIDATES_IMPORT_WORKFLOW?: WorkflowBinding
  CHAIN_DISCOVERY_WORKFLOW?: WorkflowBinding
  PROGRAM_METRICS_WORKFLOW?: WorkflowBinding
  AI_ANALYSIS_WORKFLOW?: WorkflowBinding
  SOLANA_RPC_URL: string
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
  // Re-simulate with the SAME inputs the draft was proven with. The agent may
  // have discovered a real pool/market address; re-testing with a placeholder
  // wallet in its place would fail on the placeholder, not on the flow.
  const storedInputs = draft.simulation_inputs_json
    ? (JSON.parse(draft.simulation_inputs_json) as Record<string, unknown>)
    : {}
  const simInputs = { ...buildSyntheticInputs(compiled.plan.inputs), ...storedInputs }
  const simResult = await run(compiled.plan, simInputs, nodeCtx)
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
  '🤖 Orquestra Admin Bot',
  '',
  'Flow Builder:',
  '/status - flow builder activity in the last 24h',
  '/pending - proposals awaiting approve/reject',
  '/trigger <programId> - list that program\'s instructions worth a flow, then pick one',
  '',
  'Control panel:',
  '/admin - button menu for everything below',
  '/dashboard - queue/status snapshot across the sync pipeline',
  '/health - pipeline health check detail (per-check status)',
  '/remediate - force health check + auto-remediation now',
  '/analytics - traffic + platform coverage summary',
  '',
  'Sync & discovery:',
  '/sync_idl - re-check IDLs for all public projects',
  '/sync_osec - fetch OSEC verified-program list, enqueue new candidates',
  '/sync_chain - scan for newly deployed on-chain programs',
  '/sync_import [full-sweep] - drain the pending candidates queue',
  '',
  'Verification:',
  '/sync_verified_match - match OSEC verified list against DB, update is_verified flags',
  '/sync_verified_idl - fetch on-chain IDL for verified programs missing one',
  '',
  'Analysis & categorization:',
  '/sync_verified_analysis [force] - generate AI docs/analysis for verified programs',
  '/sync_metrics - import Solana Compass program activity metrics',
  '/sync_recategorize [backfill] - AI/Helius categorize projects',
  '  (no arg: only uncategorized projects; backfill: re-check already-categorized ones against Helius only)',
  '/regen_analysis <projectId> [force] - regenerate AI analysis for one project',
  '/update_cache <projectId> [force] - rebuild IDL cache/docs for one project',
  '',
  '/menu - refresh Telegram\'s "/" autocomplete list',
  '/help - this message',
].join('\n')

/**
 * Config-driven trigger table — one entry per admin workflow that takes no
 * more than a single optional string argument. Both text commands
 * (`handleCommand`) and `/admin` button taps (`adm:<key>[:<arg>]` callback
 * data) go through the same `handleAdminAction`, so the trigger logic for
 * each workflow lives in exactly one place.
 */
interface AdminAction {
  /** Shown in the confirmation message once triggered. */
  label: string
  /** Which workflow binding on `Bindings` to call `.create()` on. */
  binding: keyof Bindings
  /** `workflow` column value for `recordWorkflowInstance` / the health checker's registry. */
  workflowName: string
  /** Builds the Workflow's `params` payload from the optional command/button argument. */
  buildParams: (arg?: string) => Record<string, unknown>
}

const ADMIN_ACTIONS: Record<string, AdminAction> = {
  idlsync: {
    label: 'IDL sync (all public projects)',
    binding: 'IDL_SYNC_WORKFLOW',
    workflowName: 'idl-sync',
    buildParams: () => ({ trigger: 'admin' }),
  },
  osec: {
    label: 'OSEC verified-program discovery',
    binding: 'OSEC_DISCOVER_WORKFLOW',
    workflowName: 'osec-discover',
    buildParams: () => ({ trigger: 'admin' }),
  },
  vmatch: {
    label: 'Verified match (OSEC list vs DB)',
    binding: 'VERIFIED_MATCH_WORKFLOW',
    workflowName: 'verified-match',
    buildParams: () => ({ trigger: 'admin' }),
  },
  vidl: {
    label: 'Verified IDL import',
    binding: 'VERIFIED_IDL_IMPORT_WORKFLOW',
    workflowName: 'verified-idl-import',
    buildParams: () => ({ trigger: 'admin' }),
  },
  vanalysis: {
    label: 'Verified analysis (AI docs)',
    binding: 'VERIFIED_ANALYSIS_WORKFLOW',
    workflowName: 'verified-analysis',
    buildParams: (arg) => ({ trigger: 'admin', force: arg === 'force' }),
  },
  chain: {
    label: 'Chain discovery (new on-chain deploys)',
    binding: 'CHAIN_DISCOVERY_WORKFLOW',
    workflowName: 'chain-discovery',
    buildParams: () => ({ trigger: 'admin' }),
  },
  metrics: {
    label: 'Program metrics import',
    binding: 'PROGRAM_METRICS_WORKFLOW',
    workflowName: 'program-metrics-import',
    buildParams: () => ({}),
  },
  recat: {
    label: 'Recategorize projects',
    binding: 'BULK_RECATEGORIZE_WORKFLOW',
    workflowName: 'bulk-recategorize',
    buildParams: (arg) => ({ trigger: 'admin', mode: arg === 'backfill' ? 'backfill' : 'uncategorized' }),
  },
}

async function handleAdminAction(c: Context<{ Bindings: Bindings }>, chatId: string, key: string, arg?: string): Promise<void> {
  const action = ADMIN_ACTIONS[key]
  if (!action) {
    await sendText(c.env, chatId, `Unknown admin action "${key}".`)
    return
  }
  const workflow = c.env[action.binding] as WorkflowBinding | undefined
  if (!workflow) {
    await sendText(c.env, chatId, `${action.binding} binding not available.`)
    return
  }
  try {
    const params = action.buildParams(arg)
    const instance = await workflow.create({ params })
    await recordWorkflowInstance(c.env.DB, { instanceId: instance.id, workflow: action.workflowName, trigger: 'admin', params })
    await sendText(c.env, chatId, `🚀 ${action.label} started — instance ${instance.id}`)
  } catch (err) {
    await sendText(c.env, chatId, `⚠️ Failed to start ${action.label}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * candidates-import is the one workflow with an existing stack-avoidance
 * guard (`startCandidatesImport` in pipeline-health.ts, also used by the
 * cron and remediation paths) — routed separately from the generic table so
 * that guard applies here too instead of stacking duplicate import instances.
 */
async function handleSyncImport(c: Context<{ Bindings: Bindings }>, chatId: string, arg?: string): Promise<void> {
  const mode = arg === 'full-sweep' ? 'full-sweep' : 'import'
  const res = await startCandidatesImport(c.env as unknown as HealthEnv, 'admin', mode)
  await sendText(
    c.env,
    chatId,
    res.started ? `🚀 Candidates import (${mode}) started — instance ${res.instanceId}` : `Import not started: ${res.reason}`,
  )
}

async function handleHealth(c: Context<{ Bindings: Bindings }>, chatId: string): Promise<void> {
  const health = await computePipelineHealth(c.env as unknown as HealthEnv)
  const icon = health.status === 'ok' ? '✅' : health.status === 'degraded' ? '⚠️' : '🔴'
  const lines = [
    `${icon} Pipeline: ${health.status}`,
    '',
    ...health.checks.map((ch) => `${ch.ok ? '✅' : ch.severity === 'critical' ? '🔴' : '⚠️'} ${ch.name}: ${ch.detail}`),
  ]
  await sendText(c.env, chatId, lines.join('\n'))
}

async function handleRemediate(c: Context<{ Bindings: Bindings }>, chatId: string): Promise<void> {
  await sendText(c.env, chatId, '🛠 Running health check + auto-remediation…')
  const health = await runPipelineHealthCheck(c.env as unknown as HealthEnv)
  const icon = health.status === 'ok' ? '✅' : health.status === 'degraded' ? '⚠️' : '🔴'
  const lines = [
    `${icon} Pipeline: ${health.status}`,
    '',
    ...health.checks.filter((ch) => !ch.ok).map((ch) => `${ch.severity === 'critical' ? '🔴' : '⚠️'} ${ch.name}: ${ch.detail}`),
    health.remediations.length ? '' : undefined,
    ...health.remediations.map((r) => `→ ${r}`),
  ].filter((l): l is string => l !== undefined)
  await sendText(c.env, chatId, lines.length > 2 ? lines.join('\n') : `${icon} Pipeline: ${health.status} — nothing to remediate`)
}

async function handleAnalytics(c: Context<{ Bindings: Bindings }>, chatId: string): Promise<void> {
  const a = await getAnalyticsSummary(c.env.DB)
  const last7 = a.daily_api.slice(-7).reduce((sum, d) => sum + Number(d.total), 0)
  const idlPct = a.platform.total_programs > 0 ? (100 * a.platform.programs_with_idl) / a.platform.total_programs : 0
  const lines = [
    '📈 Analytics',
    '',
    `All-time: ${a.totals_alltime.api} API · ${a.totals_alltime.mcp} MCP requests`,
    `Last 7d API requests: ${last7}`,
    '',
    'Top programs:',
    ...a.top_programs.slice(0, 5).map((p, i) => `${i + 1}. ${p.name} — ${p.total}`),
    '',
    `Platform: ${a.platform.total_programs} programs, ${idlPct.toFixed(1)}% with IDL, ${a.platform.verified_programs} verified`,
    `IDL versions: ${a.platform.idl_versions_total} · Workflow runs: ${a.platform.workflow_runs_total}`,
  ]
  await sendText(c.env, chatId, lines.join('\n'))
}

async function handleDashboard(c: Context<{ Bindings: Bindings }>, chatId: string): Promise<void> {
  const db = c.env.DB
  const [candidates, osec, verifiedIdl, verifiedAnalysis, metrics] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN status = 'has_idl' THEN 1 ELSE 0 END) AS has_idl,
              SUM(CASE WHEN status = 'no_idl' THEN 1 ELSE 0 END) AS no_idl
       FROM program_candidates`,
    ).first<{ total: number; pending: number; has_idl: number; no_idl: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM program_candidates WHERE source = 'osec'`,
    ).first<{ total: number; pending: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS n FROM projects p LEFT JOIN idl_versions v ON v.project_id = p.id
       WHERE p.is_verified = 1 AND v.id IS NULL`,
    ).first<{ n: number }>(),
    db.prepare(
      `SELECT COUNT(DISTINCT p.id) AS n FROM projects p
       JOIN idl_versions v ON v.project_id = p.id
       LEFT JOIN ai_analyses aa ON aa.project_id = p.id
       WHERE p.is_verified = 1 AND p.is_public = 1 AND aa.id IS NULL`,
    ).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS total, MAX(fetched_at) AS last_fetched FROM program_metrics`).first<{ total: number; last_fetched: string | null }>(),
  ])
  const lines = [
    '📋 Pipeline dashboard',
    '',
    `Candidates queue: ${candidates?.total ?? 0} total, ${candidates?.pending ?? 0} pending, ${candidates?.has_idl ?? 0} has_idl, ${candidates?.no_idl ?? 0} no_idl`,
    `OSEC candidates: ${osec?.total ?? 0} total, ${osec?.pending ?? 0} pending`,
    `Verified programs missing IDL: ${verifiedIdl?.n ?? 0}`,
    `Verified programs missing AI analysis: ${verifiedAnalysis?.n ?? 0}`,
    `Program metrics: ${metrics?.total ?? 0} rows, last fetched ${metrics?.last_fetched ?? 'never'}`,
  ]
  await sendText(c.env, chatId, lines.join('\n'))
}

/** `/regen_analysis <projectId> [force]` — regenerate AI docs/analysis for one project. */
async function handleRegenAnalysis(c: Context<{ Bindings: Bindings }>, chatId: string, projectId?: string, forceArg?: string): Promise<void> {
  if (!projectId) {
    await sendText(c.env, chatId, 'Usage: /regen_analysis <projectId> [force]')
    return
  }
  const workflow = c.env.AI_ANALYSIS_WORKFLOW
  if (!workflow) {
    await sendText(c.env, chatId, 'AI_ANALYSIS_WORKFLOW binding not available.')
    return
  }
  const force = forceArg === 'force'
  const instance = await workflow.create({ params: { projectId, force } })
  await sendText(c.env, chatId, `🚀 Regenerating analysis for ${projectId} (force=${force}) — instance ${instance.id}`)
}

/** `/update_cache <projectId> [force]` — rebuild IDL summary/docs/category cache for one project. */
async function handleUpdateCache(c: Context<{ Bindings: Bindings }>, chatId: string, projectId?: string, forceArg?: string): Promise<void> {
  if (!projectId) {
    await sendText(c.env, chatId, 'Usage: /update_cache <projectId> [force]')
    return
  }
  const workflow = c.env.IDL_UPDATE_CACHE_WORKFLOW
  if (!workflow) {
    await sendText(c.env, chatId, 'IDL_UPDATE_CACHE_WORKFLOW binding not available.')
    return
  }
  const force = forceArg === 'force'
  const instance = await workflow.create({ params: { projectId, force } })
  await sendText(c.env, chatId, `🚀 Rebuilding IDL cache for ${projectId} (force=${force}) — instance ${instance.id}`)
}

/** `/admin` — button menu covering every action `ADMIN_ACTIONS` plus the health/analytics reads. */
async function handleAdminMenu(c: Context<{ Bindings: Bindings }>, chatId: string): Promise<void> {
  const rows: ButtonRow[][] = [
    [{ text: '🔄 IDL Sync', callback_data: 'adm:idlsync' }, { text: '🔎 OSEC Discover', callback_data: 'adm:osec' }],
    [{ text: '⛓ Chain Discovery', callback_data: 'adm:chain' }, { text: '📦 Import Queue', callback_data: 'adm:import' }],
    [{ text: '📦 Import (full sweep)', callback_data: 'adm:import:full-sweep' }],
    [{ text: '✅ Verified Match', callback_data: 'adm:vmatch' }, { text: '📥 Verified IDL Import', callback_data: 'adm:vidl' }],
    [{ text: '🧠 Verified Analysis', callback_data: 'adm:vanalysis' }, { text: '🧠 + Force', callback_data: 'adm:vanalysis:force' }],
    [{ text: '📊 Program Metrics', callback_data: 'adm:metrics' }, { text: '🏷 Recategorize', callback_data: 'adm:recat' }],
    [{ text: '🏷 Recategorize (backfill)', callback_data: 'adm:recat:backfill' }],
    [{ text: '❤️ Health', callback_data: 'adm:health' }, { text: '🛠 Remediate Now', callback_data: 'adm:remediate' }],
    [{ text: '📈 Analytics', callback_data: 'adm:analytics' }, { text: '📋 Dashboard', callback_data: 'adm:dashboard' }],
  ]
  await sendButtonMenu(c.env, chatId, '🤖 Admin control panel', rows)
}

/**
 * Dispatch for `adm:<key>[:<arg>]` callback data — covers the four read-only
 * actions (health/remediate/analytics/dashboard) plus every `ADMIN_ACTIONS`
 * trigger and the guarded candidates-import path. Single entry point so
 * `/admin` button taps and the equivalent text commands can never drift.
 */
async function handleAdmKey(c: Context<{ Bindings: Bindings }>, chatId: string, key: string, arg?: string): Promise<void> {
  switch (key) {
    case 'health':
      return handleHealth(c, chatId)
    case 'remediate':
      return handleRemediate(c, chatId)
    case 'analytics':
      return handleAnalytics(c, chatId)
    case 'dashboard':
      return handleDashboard(c, chatId)
    case 'import':
      return handleSyncImport(c, chatId, arg)
    default:
      return handleAdminAction(c, chatId, key, arg)
  }
}

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

/**
 * Operator picked an instruction from a triage shortlist — start authoring for
 * exactly that one. This is the only path that spends authoring money, and it
 * always follows an explicit tap.
 */
async function handleBuildChoice(c: Context<{ Bindings: Bindings }>, chatId: string, triageId: string, index: string): Promise<void> {
  const raw = await c.env.CACHE.get(`triage:${triageId}`)
  if (!raw) {
    await sendText(c.env, chatId, 'That shortlist has expired — run /trigger <programId> again.')
    return
  }
  const triage = JSON.parse(raw) as {
    programId: string
    projectName: string
    choices: Array<{ name: string; reason: string }>
  }
  if (index === 'x') {
    await sendText(c.env, chatId, `Cancelled — nothing built for ${triage.projectName}.`)
    return
  }
  const choice = triage.choices[Number(index)]
  if (!choice) {
    await sendText(c.env, chatId, 'Unknown selection.')
    return
  }
  const workflow = c.env.FLOW_BUILDER_AGENT_WORKFLOW
  if (!workflow) {
    await sendText(c.env, chatId, 'FLOW_BUILDER_AGENT_WORKFLOW binding not available.')
    return
  }
  const instance = await workflow.create({
    params: { trigger: 'admin', mode: 'build', programId: triage.programId, instruction: choice.name },
  })
  await recordWorkflowInstance(c.env.DB, { instanceId: instance.id, workflow: 'flow-builder-agent', trigger: 'admin' })
  await sendText(c.env, chatId, `🚀 Building "${choice.name}" for ${triage.projectName} — instance ${instance.id}`)
}

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
  // With a program id: shortlist its instructions and ask first, so authoring
  // spend always follows an explicit choice. Without one: fall back to the
  // priority pick and build directly.
  const mode = programId ? 'triage' : 'build'
  const instance = await workflow.create({ params: { trigger: 'admin', mode, programId } })
  await recordWorkflowInstance(c.env.DB, { instanceId: instance.id, workflow: 'flow-builder-agent', trigger: 'admin' })
  await sendText(
    c.env,
    chatId,
    programId ? `🔎 Finding instructions worth a flow for ${programId}…` : `🚀 Started (next candidate) — instance ${instance.id}`,
  )
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
    case '/admin':
      return handleAdminMenu(c, chatId)
    case '/dashboard':
      return handleDashboard(c, chatId)
    case '/health':
      return handleHealth(c, chatId)
    case '/remediate':
      return handleRemediate(c, chatId)
    case '/analytics':
      return handleAnalytics(c, chatId)
    case '/sync_idl':
      return handleAdminAction(c, chatId, 'idlsync')
    case '/sync_osec':
      return handleAdminAction(c, chatId, 'osec')
    case '/sync_verified_match':
      return handleAdminAction(c, chatId, 'vmatch')
    case '/sync_verified_idl':
      return handleAdminAction(c, chatId, 'vidl')
    case '/sync_verified_analysis':
      return handleAdminAction(c, chatId, 'vanalysis', parts[1])
    case '/sync_chain':
      return handleAdminAction(c, chatId, 'chain')
    case '/sync_import':
      return handleSyncImport(c, chatId, parts[1])
    case '/sync_metrics':
      return handleAdminAction(c, chatId, 'metrics')
    case '/sync_recategorize':
      return handleAdminAction(c, chatId, 'recat', parts[1])
    case '/regen_analysis':
      return handleRegenAnalysis(c, chatId, parts[1], parts[2])
    case '/update_cache':
      return handleUpdateCache(c, chatId, parts[1], parts[2])
    case '/menu':
      await setBotCommands(c.env)
      await sendText(c.env, chatId, '✅ "/" menu refreshed — reopen the chat\'s command list to see it.')
      return
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
    const parts = callbackQuery.data.split(':')
    const [action] = parts
    if (isAdmin) {
      try {
        if (action === 'flow_approve' && parts[1]) {
          await handleApprove(c, parts[1])
        } else if (action === 'flow_reject' && parts[1]) {
          await handleReject(c, parts[1])
        } else if (action === 'fb' && parts[1] && parts[2] !== undefined) {
          await handleBuildChoice(c, senderChatId, parts[1], parts[2])
        } else if (action === 'adm' && parts[1]) {
          await handleAdmKey(c, senderChatId, parts[1], parts[2])
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
