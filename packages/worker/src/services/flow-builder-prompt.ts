/**
 * Prompt construction for the Flow Builder Agent's authoring step (migration
 * 026). Mirrors the message-array shape `ai-analysis.ts`/`ai-categorization.ts`
 * already use for Workers AI calls — system message with the task framing,
 * user message with the program's context.
 */

import { getFlowSchemaDocument } from '../flow-engine/schema-docs'

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n...[truncated]`
}

export interface AuthoringContext {
  programId: string
  projectName: string
  idlJson: string
  cpiMd?: string | null
  /** When optimizing an existing published flow, its current FDL + metrics. */
  existingFlow?: {
    fdlJson: string
    inputCount: number
    rpcCalls: number | null
  }
}

/**
 * Built lazily (not at module scope) — `getFlowSchemaDocument()` asserts the
 * node registry is already populated, which only happens once the caller has
 * imported the flow-engine barrel (`registerAllNodes()`). Computing this at
 * import time would race that registration.
 */
function systemPreamble(): string {
  return `You are an FDL author for the Orquestra Flow Engine. Output ONLY a single JSON object, no prose, no markdown code fences, no explanation before or after.

Your response must be exactly: { "fdl": <FlowDocument> } — where <FlowDocument> matches the grammar and node catalog documented below. If asked to optimize an existing flow and no improvement is possible, respond exactly: { "skip": true, "reason": "<why>" }.

Also include a one-sentence "rationale" field alongside "fdl" explaining what you built or optimized and why: { "fdl": <FlowDocument>, "rationale": "<one sentence>" }.

FDL grammar and node-type catalog:
${getFlowSchemaDocument()}`
}

export function buildInitialPrompt(ctx: AuthoringContext): { system: string; user: string } {
  const system = systemPreamble()

  const sections = [
    `Program: ${ctx.projectName}`,
    `Program ID: ${ctx.programId}`,
    '',
    'IDL JSON:',
    truncate(ctx.idlJson, 10_000),
  ]

  if (ctx.cpiMd) {
    sections.push('', 'Program documentation (cpi.md):', truncate(ctx.cpiMd, 6_000))
  }

  if (ctx.existingFlow) {
    sections.push(
      '',
      `An existing published flow already covers this program: ${ctx.existingFlow.inputCount} inputs, ${ctx.existingFlow.rpcCalls ?? '?'} RPC calls.`,
      'Current FDL:',
      truncate(ctx.existingFlow.fdlJson, 6_000),
      '',
      'Propose a revision with STRICTLY fewer required inputs or fewer RPC calls than the current version, or respond with the skip form above if no improvement is possible.',
    )
  } else {
    sections.push(
      '',
      'This program has no published flow yet. Author one for its single most useful instruction — pick the instruction a typical caller would want (e.g. the primary user-facing action, not an admin/init-only instruction), and minimize the number of declared `inputs` by classifying every account/argument you can as Resolvable (PDA/ATA/account-derived) or Constant rather than Input wherever the FDL grammar supports it.',
    )
  }

  return { system, user: sections.join('\n') }
}

export function buildRepairPrompt(
  ctx: AuthoringContext,
  previousDraft: string,
  compileErrors: string[],
): { system: string; user: string } {
  const system = systemPreamble()
  const user = [
    'Your previous FDL draft failed to compile. Fix ONLY what is needed to pass compilation — keep everything else the same.',
    '',
    'Compile errors:',
    ...compileErrors.map((e) => `  - ${e}`),
    '',
    'Previous draft:',
    truncate(previousDraft, 6_000),
  ].join('\n')
  return { system, user }
}
