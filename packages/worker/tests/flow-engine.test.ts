import { describe, test, expect } from 'bun:test'
import { compile } from '../src/flow-engine/compiler'
import { run } from '../src/flow-engine/interpreter'
import { registerNode, getNode, listNodes } from '../src/flow-engine/node-registry'
import { getFlowSchemaDocument, NODE_CATALOG } from '../src/flow-engine/schema-docs'
import { FLOW_INPUT_TYPES, type FlowDocument } from '../src/flow-engine/fdl-schema'
import type { NodeContext, NodeImplementation } from '../src/flow-engine/types'
import { publishFlowVersion } from '../src/services/flow-publisher'
import { verifyIngestKey } from '../src/middleware/auth'
import '../src/flow-engine' // registers built-in nodes (resolve.pda@1, logic.assert@1, etc)

const dummyCtx: NodeContext = {
  db: {} as NodeContext['db'],
  cache: {} as NodeContext['cache'],
  idls: {} as NodeContext['idls'],
  rpcUrl: 'https://api.mainnet-beta.solana.com',
}

const validDoc: FlowDocument = {
  fdl: '1.0',
  meta: { slug: 'test-flow', name: 'Test Flow', intent: 'test' },
  inputs: { program: { type: 'pubkey' } },
  outputs: { pda: { type: 'json' } },
  nodes: [
    {
      id: 'pda',
      type: 'resolve.pda@1',
      in: { program: '$inputs.program', seeds: ['vault'] },
    },
    {
      id: 'guard',
      type: 'logic.assert@1',
      in: { condition: true, message: 'unreachable' },
      after: ['pda'],
    },
  ],
}

describe('compiler', () => {
  test('accepts a valid fixture flow', async () => {
    const result = await compile(validDoc)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.plan.strata.length).toBe(2)
      expect(result.plan.strata[0].map((n) => n.id)).toEqual(['pda'])
      expect(result.plan.strata[1].map((n) => n.id)).toEqual(['guard'])
      expect(result.plan.hash).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  test('rejects a cyclic graph', async () => {
    const cyclic: FlowDocument = {
      ...validDoc,
      nodes: [
        { id: 'a', type: 'resolve.pda@1', in: { program: '$inputs.program', seeds: ['$b.address'] } },
        { id: 'b', type: 'resolve.pda@1', in: { program: '$inputs.program', seeds: ['$a.address'] } },
      ],
    }
    const result = await compile(cyclic)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('cycle detected'))).toBe(true)
    }
  })

  test('rejects an unresolvable reference', async () => {
    const dangling: FlowDocument = {
      ...validDoc,
      nodes: [
        {
          id: 'pda',
          type: 'resolve.pda@1',
          in: { program: '$inputs.doesNotExist', seeds: ['vault'] },
        },
      ],
    }
    const result = await compile(dangling)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('unresolvable input reference'))).toBe(true)
    }
  })

  test('rejects an unregistered node type', async () => {
    const unknownType: FlowDocument = {
      ...validDoc,
      nodes: [{ id: 'x', type: 'made.up@1', in: {} }],
    }
    const result = await compile(unknownType)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('unknown node type'))).toBe(true)
    }
  })

  test('FLOW_INPUT_TYPES includes signed integer types (IMP-2)', () => {
    expect(FLOW_INPUT_TYPES).toContain('i64')
    expect(FLOW_INPUT_TYPES).toContain('i32')
  })

  test('compiles a flow with an i64 input type (IMP-2)', async () => {
    const docWithI64: FlowDocument = {
      ...validDoc,
      inputs: { ...validDoc.inputs, amount: { type: 'i64' } },
    }
    const result = await compile(docWithI64)
    expect(result.ok).toBe(true)
  })
})

describe('interpreter', () => {
  test('dry-runs a fixture flow end to end (pure nodes only, no RPC)', async () => {
    const compiled = await compile(validDoc)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    const result = await run(compiled.plan, { program: '11111111111111111111111111111111' }, dummyCtx)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const pdaOutput = result.nodeOutputs.pda as { address: string; bump: number }
      expect(typeof pdaOutput.address).toBe('string')
      expect(typeof pdaOutput.bump).toBe('number')
      expect(result.nodeOutputs.guard).toEqual({ ok: true })
    }
  })

  test('aborts and reports the failing node when a node throws', async () => {
    const failing: FlowDocument = {
      ...validDoc,
      nodes: [{ id: 'guard', type: 'logic.assert@1', in: { condition: false, message: 'boom' } }],
    }
    const compiled = await compile(failing)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    const result = await run(compiled.plan, { program: '11111111111111111111111111111111' }, dummyCtx)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.nodeId).toBe('guard')
      expect(result.error.message).toBe('boom')
    }
  })

  test('skips a node behind a falsy `if` and drops it from downstream refs', async () => {
    const withGuard: FlowDocument = {
      fdl: '1.0',
      meta: { slug: 'test-if', name: 'Test If', intent: 'test' },
      inputs: { go: { type: 'bool' } },
      outputs: { out: { type: 'json' } },
      nodes: [
        { id: 'gate', type: 'logic.assert@1', in: { condition: true }, if: '$inputs.go' },
      ],
    }
    const compiled = await compile(withGuard)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    const result = await run(compiled.plan, { go: false }, dummyCtx)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.nodeOutputs.gate).toBeUndefined()
    }
  })

  test('drops a `?`-suffixed optional array reference when the value is missing', async () => {
    let seenInput: unknown = null
    const probe: NodeImplementation<{ items: unknown[] }, { ok: true }> = {
      type: 'test.probe',
      major: 1,
      effect: 'pure',
      async run(input) {
        seenInput = input
        return { ok: true }
      },
    }
    registerNode(probe as unknown as NodeImplementation)
    expect(getNode('test.probe@1')).toBeDefined()

    const doc: FlowDocument = {
      fdl: '1.0',
      meta: { slug: 'test-optional', name: 'Test Optional', intent: 'test' },
      inputs: { go: { type: 'bool' } },
      outputs: { out: { type: 'json' } },
      nodes: [
        { id: 'gate', type: 'logic.assert@1', in: { condition: true }, if: '$inputs.go' },
        { id: 'probe', type: 'test.probe@1', in: { items: ['$gate.ok?', 'literal'] }, after: ['gate'] },
      ],
    }
    const compiled = await compile(doc)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    const result = await run(compiled.plan, { go: false }, dummyCtx)
    expect(result.ok).toBe(true)
    expect(seenInput).toEqual({ items: ['literal'] })
  })

  test('applies inputs.<key>.default when the caller omits the key (BUG-1)', async () => {
    const docWithDefault: FlowDocument = {
      ...validDoc,
      inputs: { program: { type: 'pubkey', default: '11111111111111111111111111111111' } },
    }
    const compiled = await compile(docWithDefault)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    const result = await run(compiled.plan, {}, dummyCtx)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const pdaOutput = result.nodeOutputs.pda as { address: string; bump: number }
      expect(typeof pdaOutput.address).toBe('string')
    }
  })

  test('does not override a caller-provided value with the declared default (BUG-1)', async () => {
    const docWithDefault: FlowDocument = {
      ...validDoc,
      inputs: { program: { type: 'pubkey', default: '11111111111111111111111111111111' } },
    }
    const compiled = await compile(docWithDefault)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    // Same program used for both the default and the explicit input, so derive
    // a second, distinct PDA to prove the caller's own value actually won.
    const explicitProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
    const defaultResult = await run(compiled.plan, {}, dummyCtx)
    const explicitResult = await run(compiled.plan, { program: explicitProgram }, dummyCtx)
    expect(defaultResult.ok).toBe(true)
    expect(explicitResult.ok).toBe(true)
    if (defaultResult.ok && explicitResult.ok) {
      const defaultAddr = (defaultResult.nodeOutputs.pda as { address: string }).address
      const explicitAddr = (explicitResult.nodeOutputs.pda as { address: string }).address
      expect(explicitAddr).not.toBe(defaultAddr)
    }
  })

  test('does not override a falsy caller-provided value (0/false/"") with the declared default (BUG-1)', async () => {
    const doc: FlowDocument = {
      fdl: '1.0',
      meta: { slug: 'test-falsy-default', name: 'Test Falsy Default', intent: 'test' },
      inputs: { go: { type: 'bool', default: true } },
      outputs: { out: { type: 'json' } },
      nodes: [{ id: 'gate', type: 'logic.assert@1', in: { condition: true }, if: '$inputs.go' }],
    }
    const compiled = await compile(doc)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    // Explicit `false` must win over the `default: true` — the gated node must be skipped.
    const result = await run(compiled.plan, { go: false }, dummyCtx)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.nodeOutputs.gate).toBeUndefined()
    }
  })

  test('resolve.pda@1 derives distinct addresses for distinct u64 seed values (numeric PDA seed kinds)', async () => {
    const doc: FlowDocument = {
      fdl: '1.0',
      meta: { slug: 'test-numeric-seed', name: 'Test Numeric Seed', intent: 'test' },
      inputs: { program: { type: 'pubkey' }, planId: { type: 'u64' } },
      outputs: { pda: { type: 'json' } },
      nodes: [
        {
          id: 'pda',
          type: 'resolve.pda@1',
          in: { program: '$inputs.program', seeds: ['plan', { kind: 'u64', value: '$inputs.planId' }] },
        },
      ],
    }
    const compiled = await compile(doc)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    const resultA = await run(compiled.plan, { program: '11111111111111111111111111111111', planId: '1' }, dummyCtx)
    const resultB = await run(compiled.plan, { program: '11111111111111111111111111111111', planId: '2' }, dummyCtx)
    expect(resultA.ok).toBe(true)
    expect(resultB.ok).toBe(true)
    if (resultA.ok && resultB.ok) {
      const addrA = (resultA.nodeOutputs.pda as { address: string }).address
      const addrB = (resultB.nodeOutputs.pda as { address: string }).address
      expect(typeof addrA).toBe('string')
      // Different planId -> different seed bytes -> different derived address.
      expect(addrA).not.toBe(addrB)
    }
  })

  test('leaves a required input with no default undefined when omitted (BUG-1 regression guard)', async () => {
    const compiled = await compile(validDoc)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    const result = await run(compiled.plan, {}, dummyCtx)
    // Unchanged pre-existing behavior: no default to fall back to, so the node
    // still receives `program: undefined` and fails downstream exactly as before.
    expect(result.ok).toBe(false)
  })
})

describe('orquestra.build_instruction@1 (generic, IDL-driven node)', () => {
  test('compiles into a flow graph — no protocol-specific node type exists, this is the only instruction-building node', async () => {
    // No bundled/hardcoded flow data — this is a synthetic fixture proving the
    // generic node type registers and wires into a graph correctly. Any real
    // program works the same way at runtime: it's driven entirely by
    // `projectId`/`instruction`/`accounts`/`args`, resolved like any other node.
    const doc: FlowDocument = {
      fdl: '1.0',
      meta: { slug: 'test-generic-build', name: 'Test', intent: 'test' },
      inputs: {
        projectId: { type: 'string' },
        instructionName: { type: 'string' },
        wallet: { type: 'pubkey' },
      },
      outputs: { unsignedTransaction: { type: 'transaction' } },
      nodes: [
        {
          id: 'ix',
          type: 'orquestra.build_instruction@1',
          in: {
            projectId: '$inputs.projectId',
            instruction: '$inputs.instructionName',
            accounts: { authority: '$inputs.wallet' },
            args: {},
            feePayer: '$inputs.wallet',
          },
        },
        {
          id: 'tx',
          type: 'solana.compose_transaction@1',
          in: { feePayer: '$inputs.wallet', instructions: ['$ix.instruction'], simulate: false },
        },
      ],
    }
    const result = await compile(doc)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.plan.strata.map((s) => s.map((n) => n.id))).toEqual([['ix'], ['tx']])
    }
  })
})

describe('get_flow_schema docs (MCP tool 11)', () => {
  // `test.*` node types (e.g. "test.probe@1" registered by an earlier test in
  // this file) are excluded by schema-docs.ts itself — see the comment on
  // assertCatalogMatchesRegistry().
  const realRegisteredNodes = () => listNodes().filter((n) => !n.type.startsWith('test.'))

  test('every registered node type has a catalog entry, and vice versa', () => {
    const registered = new Set(realRegisteredNodes().map((n) => `${n.type}@${n.major}`))
    const documented = new Set(NODE_CATALOG.map((n) => n.key))
    expect(documented).toEqual(registered)
  })

  test('getFlowSchemaDocument() returns grammar + every node type, and does not throw', () => {
    const doc = getFlowSchemaDocument()
    expect(doc).toContain('Flow Definition Language')
    expect(doc).toContain('orquestra.build_instruction@1')
    expect(doc).toContain('solana.compose_transaction@1')
    for (const node of realRegisteredNodes()) {
      expect(doc).toContain(`${node.type}@${node.major}`)
    }
  })

  test('grammar documents i64/i32 input types (IMP-2)', () => {
    const doc = getFlowSchemaDocument()
    expect(doc).toContain('"i64"')
    expect(doc).toContain('"i32"')
  })
})

describe('verifyIngestKey (used by both POST /flows and the publish_flow MCP tool)', () => {
  test('accepts matching keys', () => {
    expect(verifyIngestKey('secret123', 'secret123')).toBe(true)
  })
  test('rejects mismatched keys', () => {
    expect(verifyIngestKey('wrong', 'secret123')).toBe(false)
  })
  test('rejects missing provided/expected', () => {
    expect(verifyIngestKey(undefined, 'secret123')).toBe(false)
    expect(verifyIngestKey('secret123', undefined)).toBe(false)
    expect(verifyIngestKey(null, null)).toBe(false)
  })
})

describe('publishFlowVersion (shared by POST /flows and the publish_flow MCP tool)', () => {
  // Minimal stateful in-memory D1 mock — just enough SQL-shape matching to
  // exercise the real insert/upsert/version logic in services/flow-publisher.ts.
  function makeFakeDb() {
    const flows: Array<{
      id: string
      slug: string
      intent: string
      protocol: string | null
      tier: string
      status: string
      stable_version_hash: string | null
      updated_at: string
    }> = []
    const versions: Array<{ content_hash: string; flow_id: string; version: number }> = []

    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async first<T>(): Promise<T | null> {
                if (sql.includes('SELECT id FROM flows WHERE slug')) {
                  const row = flows.find((f) => f.slug === args[0])
                  return (row ? { id: row.id } : null) as T | null
                }
                if (sql.includes('SELECT content_hash FROM flow_versions WHERE content_hash')) {
                  const row = versions.find((v) => v.content_hash === args[0])
                  return (row ? { content_hash: row.content_hash } : null) as T | null
                }
                if (sql.includes('MAX(version)')) {
                  const rows = versions.filter((v) => v.flow_id === args[0])
                  const max = rows.reduce((m, v) => Math.max(m, v.version), 0)
                  return { max_version: max } as T
                }
                return null
              },
              async run() {
                if (sql.startsWith('INSERT INTO flows')) {
                  const [id, slug, intent, protocol, tier, , updated_at] = args as string[]
                  flows.push({ id, slug, intent, protocol, tier, status: 'draft', stable_version_hash: null, updated_at })
                } else if (sql.startsWith('INSERT INTO flow_versions')) {
                  const [content_hash, flow_id, version] = args as [string, string, number]
                  versions.push({ content_hash, flow_id, version })
                } else if (sql.includes("status = 'published'")) {
                  const [stable_version_hash, updated_at, id] = args as string[]
                  const row = flows.find((f) => f.id === id)
                  if (row) {
                    row.status = 'published'
                    row.stable_version_hash = stable_version_hash
                    row.updated_at = updated_at
                  }
                } else if (sql.startsWith('UPDATE flows SET updated_at')) {
                  const [updated_at, id] = args as string[]
                  const row = flows.find((f) => f.id === id)
                  if (row) row.updated_at = updated_at
                }
                return { success: true }
              },
            }
          },
        }
      },
    }
    return { db: db as unknown as Parameters<typeof publishFlowVersion>[0], flows, versions }
  }

  const doc: FlowDocument = {
    fdl: '1.0',
    meta: { slug: 'publish-test-flow', name: 'Publish Test', intent: 'test' },
    inputs: { program: { type: 'pubkey' } },
    outputs: { pda: { type: 'json' } },
    nodes: [{ id: 'pda', type: 'resolve.pda@1', in: { program: '$inputs.program', seeds: ['vault'] } }],
  }

  test('publishes a new flow: creates one flow row + one version, status published', async () => {
    const { db, flows, versions } = makeFakeDb()
    const compiled = await compile(doc)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    const result = await publishFlowVersion(db, doc, compiled.plan)
    expect(result.status).toBe('published')
    expect(result.slug).toBe('publish-test-flow')
    expect(flows).toHaveLength(1)
    expect(versions).toHaveLength(1)
    expect(flows[0].status).toBe('published')
    expect(flows[0].stable_version_hash).toBe(result.contentHash)
  })

  test('publish: false lands a draft without moving stable_version_hash', async () => {
    const { db, flows } = makeFakeDb()
    const compiled = await compile(doc)
    if (!compiled.ok) return

    const result = await publishFlowVersion(db, doc, compiled.plan, { publish: false })
    expect(result.status).toBe('draft')
    expect(flows[0].status).toBe('draft')
    expect(flows[0].stable_version_hash).toBeNull()
  })

  test('re-publishing identical FDL is idempotent — no duplicate version row', async () => {
    const { db, flows, versions } = makeFakeDb()
    const compiled = await compile(doc)
    if (!compiled.ok) return

    await publishFlowVersion(db, doc, compiled.plan)
    await publishFlowVersion(db, doc, compiled.plan)

    expect(flows).toHaveLength(1)
    expect(versions).toHaveLength(1)
  })

  test('a changed FDL for the same slug creates a second version under the same flow', async () => {
    const { db, flows, versions } = makeFakeDb()
    const compiledV1 = await compile(doc)
    if (!compiledV1.ok) return
    await publishFlowVersion(db, doc, compiledV1.plan)

    const docV2: FlowDocument = { ...doc, policies: { budgets: { rpcCalls: 99 } } }
    const compiledV2 = await compile(docV2)
    if (!compiledV2.ok) return
    await publishFlowVersion(db, docV2, compiledV2.plan)

    expect(flows).toHaveLength(1) // same flow (same slug)
    expect(versions).toHaveLength(2) // two distinct content-hashed versions
    expect(versions[0].flow_id).toBe(versions[1].flow_id)
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2])
  })
})
