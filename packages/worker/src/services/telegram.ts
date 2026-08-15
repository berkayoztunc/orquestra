/**
 * Telegram Bot API integration for the Flow Builder Agent (migration 026) —
 * new from scratch, no prior integration existed (`telegram` previously was
 * only a project social-link string field). Sends flow proposals with an
 * inline Approve/Reject keyboard and edits them in place once resolved.
 */

export interface TelegramEnv {
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
}

function apiUrl(token: string, method: string): string {
  return `https://api.telegram.org/bot${token}/${method}`
}

async function callTelegram(env: TelegramEnv, method: string, body: Record<string, unknown>): Promise<any> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.error('[telegram] TELEGRAM_BOT_TOKEN not configured — skipping', method)
    return null
  }
  const res = await fetch(apiUrl(env.TELEGRAM_BOT_TOKEN, method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !(json as any)?.ok) {
    console.error(`[telegram] ${method} failed:`, res.status, JSON.stringify(json))
    return null
  }
  return (json as any).result
}

/**
 * Messages are sent as PLAIN TEXT, not MarkdownV2.
 *
 * These bodies interpolate machine-generated content — base58 addresses, model
 * ids, slugs, content hashes, and raw simulation error strings — and MarkdownV2
 * requires escaping ~18 characters anywhere they appear. A single missed one
 * fails the whole send with 400 "can't parse entities", which is exactly what
 * happened in production: an unescaped "(" around the program id meant no
 * proposal was ever delivered. Plain text removes the entire failure class.
 */

export interface FlowProposalInput {
  attemptId: string
  programId: string
  projectName: string
  reason: 'no_flow' | 'optimization_candidate'
  instructionName?: string
  paramCounts: { input: number; resolvable: number; constant: number }
  newInputCount: number
  newRpcCalls: number
  priorInputCount?: number | null
  priorRpcCalls?: number | null
  simulationSummary: string
  model: string
  neuronsEstimated?: number | null
  usdEstimated?: number | null
}

export function buildProposalMessage(input: FlowProposalInput): string {
  const reasonLine =
    input.reason === 'no_flow'
      ? 'No published flow exists for this program'
      : `Optimization — fewer inputs/RPC calls than the current published version`

  const priorLine =
    input.priorInputCount != null
      ? ` (was ${input.priorInputCount} inputs / ${input.priorRpcCalls ?? '?'} RPC calls)`
      : ''

  const costLine =
    input.neuronsEstimated != null
      ? `Model: ${input.model} · ~${Math.round(input.neuronsEstimated)} neurons (~$${(input.usdEstimated ?? 0).toFixed(4)})`
      : `Model: ${input.model}`

  const lines = [
    '🤖 Flow Builder Proposal',
    '',
    `Program: ${input.projectName} (${input.programId})`,
    `Reason: ${reasonLine}`,
    input.instructionName ? `Instruction: ${input.instructionName}` : undefined,
    '',
    'Params:',
    `  Input:      ${input.paramCounts.input}`,
    `  Resolvable: ${input.paramCounts.resolvable}`,
    `  Constant:   ${input.paramCounts.constant}`,
    '',
    `Estimated inputs required: ${input.newInputCount}${priorLine}`,
    `Estimated RPC calls: ${input.newRpcCalls}`,
    `Simulation: ${input.simulationSummary}`,
    '',
    costLine,
    `Attempt: ${input.attemptId}`,
  ].filter((line): line is string => line !== undefined)

  return lines.join('\n')
}

export async function sendFlowProposal(
  env: TelegramEnv,
  input: FlowProposalInput,
): Promise<{ messageId: string; chatId: string } | null> {
  if (!env.TELEGRAM_CHAT_ID) {
    console.error('[telegram] TELEGRAM_CHAT_ID not configured — skipping proposal send')
    return null
  }
  const text = buildProposalMessage(input)
  const result = await callTelegram(env, 'sendMessage', {
    chat_id: env.TELEGRAM_CHAT_ID,
    text,
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `flow_approve:${input.attemptId}` },
          { text: '❌ Reject', callback_data: `flow_reject:${input.attemptId}` },
        ],
      ],
    },
  })
  if (!result) return null
  return { messageId: String(result.message_id), chatId: String(env.TELEGRAM_CHAT_ID) }
}

export async function editProposalMessage(
  env: TelegramEnv,
  params: { chatId: string; messageId: string; text: string },
): Promise<void> {
  await callTelegram(env, 'editMessageText', {
    chat_id: params.chatId,
    message_id: Number(params.messageId),
    text: params.text,
  })
  // Strip the inline keyboard separately — editMessageText with no
  // reply_markup leaves the previous keyboard in place.
  await callTelegram(env, 'editMessageReplyMarkup', {
    chat_id: params.chatId,
    message_id: Number(params.messageId),
    reply_markup: { inline_keyboard: [] },
  })
}

export async function answerCallbackQuery(
  env: TelegramEnv,
  params: { callbackQueryId: string; text?: string },
): Promise<void> {
  await callTelegram(env, 'answerCallbackQuery', {
    callback_query_id: params.callbackQueryId,
    text: params.text,
  })
}

/** Plain text send — for admin command replies (/status, /pending, /help, /trigger). */
export async function sendText(env: TelegramEnv, chatId: string, text: string): Promise<void> {
  await callTelegram(env, 'sendMessage', { chat_id: chatId, text })
}

/** Registers the bot's command menu (Telegram's "/" autocomplete list). Call once, not per-request. */
export async function setBotCommands(env: TelegramEnv): Promise<void> {
  await callTelegram(env, 'setMyCommands', {
    commands: [
      { command: 'status', description: 'Flow builder activity in the last 24h' },
      { command: 'pending', description: 'Proposals awaiting approve/reject' },
      { command: 'trigger', description: 'Run the flow builder agent now' },
      { command: 'help', description: 'List available commands' },
    ],
  })
}

