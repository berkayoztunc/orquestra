import { describe, test, expect } from 'bun:test'
import { compile } from '../src/flow-engine/compiler'
import type { FlowDocument } from '../src/flow-engine/fdl-schema'
import { FlowNotProvenError, publishFlowVersion } from '../src/services/flow-publisher'
import { simulateSuccessContent } from '../src/routes/flow-mcp'
import '../src/flow-engine'

/**
 * `publish_flow` describes its input as a "proven FDL document", and the documented
 * sequence is validate_flow -> simulate_flow -> publish_flow. Nothing enforced the middle
 * step: every publish path reaches publishFlowVersion after `compile()`, which is
 * deliberately static — no RPC, no IDL. So a document naming an instruction the target
 * program does not declare compiles cleanly, earns a content hash, and can go live.
 *
 * Observed on the live surface: one document naming `swap_router_base_in` returned
 * "Compiled OK" against Orca whirlpool and Byreal Clmm. Neither program declares it.
 *
 * The evidence needed already exists in this schema — simulate_flow writes a `flow_runs`
 * row under the same version_hash — so the gate is a lookup.
 */

/** Minimal D1 fake: just the statements publishFlowVersion issues. */
function makeDb(runs: Array<{ version_hash: string; status: string }> = []) {
  const flows: Array<{ id: string; slug: string }> = []
  const versions: Array<{ content_hash: string; flow_id: string; version: number }> = []
  const db = {
    prepare(sql: string) {
      const bind = (...args: unknown[]) => ({
        async first<T>(): Promise<T | null> {
          if (sql.includes('FROM flow_runs')) {
            const hit = runs.find((r) => r.version_hash === args[0] && r.status === 'ok')
            return (hit ? { ok: 1 } : null) as T | null
          }
          if (sql.includes('SELECT id FROM flows WHERE slug')) {
            const row = flows.find((f) => f.slug === args[0])
            return (row ? { id: row.id } : null) as T | null
          }
          if (sql.includes('SELECT content_hash FROM flow_versions')) {
            const row = versions.find((v) => v.content_hash === args[0])
            return (row ? { content_hash: row.content_hash } : null) as T | null
          }
          if (sql.includes('MAX(version)')) return { max_version: versions.length } as T
          return null as T | null
        },
        async run() {
          if (sql.includes('INSERT INTO flows')) flows.push({ id: String(args[0]), slug: String(args[1]) })
          if (sql.includes('INSERT INTO flow_versions'))
            versions.push({ content_hash: String(args[0]), flow_id: String(args[1]), version: Number(args[2]) })
          return { success: true }
        },
        async all() {
          return { results: [] }
        },
      })
      return { bind, ...bind() }
    },
  }
  return db as unknown as D1Database
}

const DOC = {
  fdl: '1.0',
  meta: { slug: 'proof-gate-probe', name: 'Proof gate probe', intent: 'swap' },
  inputs: { payer: { type: 'pubkey' } },
  outputs: { address: { type: 'string' } },
  nodes: [
    {
      id: 'pda',
      type: 'resolve.pda@1',
      in: { program: 'raWrRH5R3Ym7rRFry3T8YrED6nBcUUVN2HLAdmtQLdm', seeds: ['launch'] },
    },
  ],
} as unknown as FlowDocument

describe('publishing live requires a successful run, not just a compile', () => {
  test('an unproven document is refused, and the refusal names the missing step', async () => {
    const compiled = await compile(DOC)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    const attempt = publishFlowVersion(makeDb([]), DOC, compiled.plan, {
      publish: true,
      requireProof: true,
    })

    await expect(attempt).rejects.toThrow(FlowNotProvenError)
    await expect(attempt).rejects.toThrow(/simulate_flow/)
  })

  test('the refusal is TYPED, so the callers can render it as the caller\'s problem', async () => {
    // Thrown as a plain Error it reaches systemErrorContent / systemErrorResponse and
    // renders as a server fault — telling an agent to retry the one thing that will never
    // start working on its own. Same reasoning as RpcUrlNotAllowedError.
    const compiled = await compile(DOC)
    if (!compiled.ok) return

    const err = await publishFlowVersion(makeDb([]), DOC, compiled.plan, {
      publish: true,
      requireProof: true,
    }).catch((e) => e)

    expect(err).toBeInstanceOf(FlowNotProvenError)
    expect(err.contentHash).toBe(compiled.plan.hash)
  })

  test('the same document publishes once a successful run exists for that exact hash', async () => {
    const compiled = await compile(DOC)
    if (!compiled.ok) return

    const db = makeDb([{ version_hash: compiled.plan.hash, status: 'ok' }])
    const result = await publishFlowVersion(db, DOC, compiled.plan, { publish: true, requireProof: true })

    expect(result.contentHash).toBe(compiled.plan.hash)
  })

  test('a run that FAILED is not proof', async () => {
    const compiled = await compile(DOC)
    if (!compiled.ok) return

    const db = makeDb([{ version_hash: compiled.plan.hash, status: 'error' }])

    await expect(
      publishFlowVersion(db, DOC, compiled.plan, { publish: true, requireProof: true }),
    ).rejects.toThrow(FlowNotProvenError)
  })

  test('a run of a DIFFERENT document is not proof — the hash has to match', async () => {
    const compiled = await compile(DOC)
    if (!compiled.ok) return

    const db = makeDb([{ version_hash: 'some-other-flows-hash', status: 'ok' }])

    await expect(
      publishFlowVersion(db, DOC, compiled.plan, { publish: true, requireProof: true }),
    ).rejects.toThrow(FlowNotProvenError)
  })

  test('drafts are never gated — only going live is', async () => {
    const compiled = await compile(DOC)
    if (!compiled.ok) return

    const result = await publishFlowVersion(makeDb([]), DOC, compiled.plan, {
      publish: false,
      requireProof: true,
    })

    expect(result.contentHash).toBe(compiled.plan.hash)
  })

  test('internal callers are untouched — the gate is opt-in', async () => {
    const compiled = await compile(DOC)
    if (!compiled.ok) return

    const result = await publishFlowVersion(makeDb([]), DOC, compiled.plan, { publish: true })

    expect(result.contentHash).toBe(compiled.plan.hash)
  })
})

/**
 * The other half of the gate, on the MCP side. The service refuses an unproven publish;
 * these cover what simulate_flow tells a client when the run SUCCEEDED but its proof row
 * did not make it to the database.
 *
 * A warning in the response text is not enough. An MCP client branches on `isError`, so a
 * protocol-level success sends it straight on to publish_flow — which then refuses the
 * document for the proof that was never written. The call must fail loudly at the step
 * where the failure happened, not silently at the next one.
 */
describe('simulate_flow response when the proof write fails', () => {
  const OUTPUTS = { swap: { signature: '5x…' } }

  test('a recorded proof is a plain success', () => {
    const res = simulateSuccessContent(OUTPUTS, true)

    expect(res.isError).toBeUndefined()
    expect(res.content[0].text).toContain('**Run succeeded.**')
    expect(res.content[0].text).not.toContain('Proof was NOT recorded')
  })

  test('a failed proof write is isError, not just a warning line', () => {
    const res = simulateSuccessContent(OUTPUTS, false)

    // The flag is the load-bearing assertion: without it a client proceeds to
    // publish_flow and hits a refusal it could not have predicted from this response.
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('Proof was NOT recorded')
  })

  test('the run that did happen is still reported — the outputs are not discarded', () => {
    const res = simulateSuccessContent(OUTPUTS, false)

    expect(res.content[0].text).toContain('**Run succeeded.**')
    expect(res.content[0].text).toContain('5x…')
  })
})
