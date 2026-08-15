/**
 * Instruction triage — the cheap step that runs BEFORE any authoring spend.
 *
 * A program like Orca Whirlpool has ~40 instructions, only a handful of which
 * are worth a published flow (swap, increase/decrease liquidity, collect fees),
 * the rest being admin/init plumbing. Authoring is the expensive part (~$0.15
 * per flow), so this picks candidates with a small cheap model and hands them
 * to the operator to choose from, rather than guessing and spending.
 */

import type { AnchorIDL } from './idl-parser'

/** Deliberately the cheap model: this is a shortlist, not authoring. */
export const TRIAGE_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

export interface TriagedInstruction {
  name: string
  reason: string
}

/** Instruction names that are never worth a caller-facing flow. */
const ADMIN_PATTERNS = /^(initialize|init|create_config|set_|update_|admin|migrate|close_|collect_protocol|transfer_ownership|accept_admin|delete_)/i

function instructionSummaries(idl: AnchorIDL): Array<{ name: string; accounts: number; args: number }> {
  return (idl.instructions ?? []).map((ix: any) => ({
    name: ix.name,
    accounts: (ix.accounts ?? []).length,
    args: (ix.args ?? []).length,
  }))
}

function extractJsonArray(raw: string): unknown[] | null {
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Shortlist the instructions worth building a flow for. Falls back to a
 * name-heuristic list if the model is unavailable or returns nothing usable —
 * the operator picks from the result either way, so a rough list still works.
 */
export async function triageInstructions(
  ai: Ai,
  idl: AnchorIDL,
  projectName: string,
  limit = 6,
): Promise<TriagedInstruction[]> {
  const all = instructionSummaries(idl)
  if (all.length === 0) return []

  const heuristic = (): TriagedInstruction[] =>
    all
      .filter((i) => !ADMIN_PATTERNS.test(i.name))
      .slice(0, limit)
      .map((i) => ({ name: i.name, reason: `${i.accounts} accounts, ${i.args} args` }))

  const system =
    'You pick which Solana program instructions deserve a reusable, published "flow" for end users. ' +
    'Choose only instructions a normal caller would invoke (swap, deposit, withdraw, add/remove liquidity, claim, stake). ' +
    'Exclude admin, initialization, config and protocol-maintenance instructions. ' +
    `Return ONLY a JSON array, at most ${limit} entries, of {"name": "<exact instruction name>", "reason": "<max 12 words>"}.`

  const user = `Program: ${projectName}\nInstructions (name, accounts, args):\n${all
    .map((i) => `- ${i.name} (${i.accounts} accounts, ${i.args} args)`)
    .join('\n')}`

  try {
    const response: any = await (ai as any).run(TRIAGE_MODEL, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 600,
      temperature: 0.1,
    })
    const parsed = extractJsonArray((response?.response as string) ?? '')
    if (!parsed) return heuristic()

    const valid = new Set(all.map((i) => i.name))
    const picked = parsed
      .map((entry) => {
        const row = entry as Record<string, unknown>
        const name = typeof row.name === 'string' ? row.name : ''
        const reason = typeof row.reason === 'string' ? row.reason : ''
        return { name, reason }
      })
      // The model occasionally invents or renames an instruction; only keep
      // ones that actually exist in this IDL.
      .filter((entry) => valid.has(entry.name))
      .slice(0, limit)

    return picked.length > 0 ? picked : heuristic()
  } catch (err) {
    console.error('[flow-triage] model call failed, using heuristic:', err)
    return heuristic()
  }
}
