import { describe, test, expect } from 'bun:test'
import { compile } from '../src/flow-engine/compiler'
import type { FlowDocument } from '../src/flow-engine/fdl-schema'
import type { NodeContext } from '../src/flow-engine/types'
import { publishFlowVersion } from '../src/services/flow-publisher'
import { listFlows, getFlowMetadata } from '../src/services/flow-catalog'
import { estimateFlow } from '../src/services/flow-estimator'
import '../src/flow-engine'

// A more capable fake D1 than the one in flow-engine.test.ts's publishFlowVersion
// tests — this one also serves the JOIN-shaped SELECTs used by flow-catalog.ts
// and flow-estimator.ts, so real publishFlowVersion + real listFlows/getFlowMetadata/
// estimateFlow can be exercised together end to end without a live D1.
function makeFakeDb() {
  interface FlowRow {
    id: string
    slug: string
    intent: string
    protocol: string | null
    tier: string
    status: string
    stable_version_hash: string | null
    updated_at: string
  }
  interface VersionRow {
    content_hash: string
    flow_id: string
    version: number
    fdl_json: string
    metadata_json: string
  }
  const flows: FlowRow[] = []
  const versions: VersionRow[] = []

  const db = {
    prepare(sql: string) {
      function withArgs(args: unknown[]) {
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
                return { max_version: rows.reduce((m, v) => Math.max(m, v.version), 0) } as T
              }
              // JOIN-shaped single-row lookups (getFlowMetadata / estimateFlow), both filtered by slug + published
              if (sql.includes('WHERE f.slug = ? AND f.status')) {
                const flow = flows.find((f) => f.slug === args[0] && f.status === 'published')
                if (!flow) return null
                const version = versions.find((v) => v.content_hash === flow.stable_version_hash)
                if (!version) return null
                if (sql.includes('v.fdl_json')) {
                  return { content_hash: version.content_hash, fdl_json: version.fdl_json } as T
                }
                return { slug: flow.slug, intent: flow.intent, protocol: flow.protocol, tier: flow.tier, metadata_json: version.metadata_json } as T
              }
              return null
            },
            async all<T>(): Promise<{ results: T[] }> {
              if (sql.includes("WHERE f.status = 'published'")) {
                const results = flows
                  .filter((f) => f.status === 'published')
                  .map((f) => {
                    const version = versions.find((v) => v.content_hash === f.stable_version_hash)!
                    return { slug: f.slug, intent: f.intent, protocol: f.protocol, tier: f.tier, metadata_json: version.metadata_json } as T
                  })
                  .sort((a: any, b: any) => (a.slug > b.slug ? 1 : -1))
                return { results }
              }
              return { results: [] }
            },
            async run() {
              if (sql.startsWith('INSERT INTO flows')) {
                const [id, slug, intent, protocol, tier, , updated_at] = args as string[]
                flows.push({ id, slug, intent, protocol, tier, status: 'draft', stable_version_hash: null, updated_at })
              } else if (sql.startsWith('INSERT INTO flow_versions')) {
                const [content_hash, flow_id, version, fdl_json, , metadata_json] = args as [string, string, number, string, string, string]
                versions.push({ content_hash, flow_id, version, fdl_json, metadata_json })
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
      }
      return { bind: (...args: unknown[]) => withArgs(args), ...withArgs([]) }
    },
  }
  return { db: db as unknown as Parameters<typeof publishFlowVersion>[0], flows, versions }
}

async function publishFixture(db: Parameters<typeof publishFlowVersion>[0], doc: FlowDocument) {
  const compiled = await compile(doc)
  if (!compiled.ok) throw new Error('fixture failed to compile: ' + JSON.stringify(compiled.errors))
  return publishFlowVersion(db, doc, compiled.plan)
}

const swapDoc: FlowDocument = {
  fdl: '1.0',
  meta: { slug: 'raydium-swap-token', name: 'Swap token on Raydium', intent: 'swap', protocol: 'raydium', programs: ['675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'] },
  inputs: { wallet: { type: 'pubkey' } },
  outputs: { out: { type: 'json' } },
  nodes: [{ id: 'pda', type: 'resolve.pda@1', in: { program: '$inputs.wallet', seeds: ['vault'] } }],
}

const stakeDoc: FlowDocument = {
  fdl: '1.0',
  meta: { slug: 'marinade-stake-sol', name: 'Stake SOL with Marinade', intent: 'stake', protocol: 'marinade' },
  inputs: { wallet: { type: 'pubkey' } },
  outputs: { out: { type: 'json' } },
  nodes: [{ id: 'pda', type: 'resolve.pda@1', in: { program: '$inputs.wallet', seeds: ['vault'] } }],
}

describe('listFlows (list_flows MCP tool + GET /flows)', () => {
  test('returns nothing when the catalog is empty', async () => {
    const { db } = makeFakeDb()
    expect(await listFlows(db)).toEqual([])
  })

  test('lists every published flow with full inputs/outputs', async () => {
    const { db } = makeFakeDb()
    await publishFixture(db, swapDoc)
    await publishFixture(db, stakeDoc)

    const flows = await listFlows(db)
    expect(flows).toHaveLength(2)
    expect(flows.map((f) => f.slug).sort()).toEqual(['marinade-stake-sol', 'raydium-swap-token'])
    expect(flows.find((f) => f.slug === 'raydium-swap-token')?.inputs).toEqual(swapDoc.inputs)
  })

  test('a draft (unpublished) flow does not appear', async () => {
    const { db } = makeFakeDb()
    const compiled = await compile(swapDoc)
    if (!compiled.ok) throw new Error('fixture failed')
    await publishFlowVersion(db, swapDoc, compiled.plan, { publish: false })

    expect(await listFlows(db)).toEqual([])
  })

  test('query filters by free-text match against slug/name/intent/protocol', async () => {
    const { db } = makeFakeDb()
    await publishFixture(db, swapDoc)
    await publishFixture(db, stakeDoc)

    expect((await listFlows(db, { query: 'marinade' })).map((f) => f.slug)).toEqual(['marinade-stake-sol'])
    expect((await listFlows(db, { query: 'SWAP' })).map((f) => f.slug)).toEqual(['raydium-swap-token']) // case-insensitive
    expect((await listFlows(db, { query: 'nonexistent-thing' })).length).toBe(0)
  })

  test('intent and protocol filters do exact matches', async () => {
    const { db } = makeFakeDb()
    await publishFixture(db, swapDoc)
    await publishFixture(db, stakeDoc)

    expect((await listFlows(db, { intent: 'stake' })).map((f) => f.slug)).toEqual(['marinade-stake-sol'])
    expect((await listFlows(db, { protocol: 'raydium' })).map((f) => f.slug)).toEqual(['raydium-swap-token'])
  })

  test('limit truncates the result set', async () => {
    const { db } = makeFakeDb()
    await publishFixture(db, swapDoc)
    await publishFixture(db, stakeDoc)

    expect((await listFlows(db, { limit: 1 })).length).toBe(1)
  })
})

describe('getFlowMetadata (get_flow_metadata MCP tool + GET /flows/:slug)', () => {
  test('returns null for an unknown slug', async () => {
    const { db } = makeFakeDb()
    expect(await getFlowMetadata(db, 'does-not-exist')).toBeNull()
  })

  test('returns the full contract for a published flow', async () => {
    const { db } = makeFakeDb()
    await publishFixture(db, swapDoc)

    const flow = await getFlowMetadata(db, 'raydium-swap-token')
    expect(flow).not.toBeNull()
    expect(flow?.meta.name).toBe('Swap token on Raydium')
    expect(flow?.inputs).toEqual(swapDoc.inputs)
    expect(flow?.outputs).toEqual(swapDoc.outputs)
  })
})

describe('estimateFlow (estimate_flow MCP tool + POST /flows/:slug/estimate)', () => {
  const dummyCtx: NodeContext = {
    db: {} as NodeContext['db'],
    cache: {} as NodeContext['cache'],
    idls: {} as NodeContext['idls'],
    rpcUrl: 'https://api.mainnet-beta.solana.com',
  }

  test('reports not_found for an unknown slug', async () => {
    const { db } = makeFakeDb()
    const result = await estimateFlow(db, dummyCtx, 'does-not-exist', {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.kind).toBe('not_found')
  })

  test('runs a published flow end to end and returns real node outputs', async () => {
    const { db } = makeFakeDb()
    await publishFixture(db, swapDoc)

    const result = await estimateFlow(db, dummyCtx, 'raydium-swap-token', { wallet: '11111111111111111111111111111111' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.outcome.result.ok).toBe(true)
      if (result.outcome.result.ok) {
        expect(result.outcome.result.nodeOutputs.pda).toHaveProperty('address')
      }
      expect(result.outcome.versionHash).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})
