import { describe, test, expect, afterEach } from 'bun:test'
import idlApp from '../src/routes/idl'
import { generateJWT } from '../src/services/jwt'

const SECRET = 'test-secret'
const PROGRAM = 'BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya'

const IDL = {
  version: '0.1.0',
  name: 'demo_program',
  instructions: [{ name: 'ping', accounts: [{ name: 'payer', isMut: true, isSigner: true }], args: [] }],
}

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

/** RPC where every account lookup is empty → no on-chain IDL (absent). */
function rpcWithNoIdl() {
  globalThis.fetch = (async (_u: any, init: any) => {
    const body = JSON.parse(init.body)
    const one = (id: number) => ({ jsonrpc: '2.0', id, result: { context: { slot: 1 }, value: null } })
    return new Response(JSON.stringify(Array.isArray(body) ? body.map((b: any) => one(b.id)) : one(body.id)), { status: 200 })
  }) as any
}
function rpcDown() {
  globalThis.fetch = (async () => { throw new Error('network down') }) as any
}

type Captured = { inserts: Array<{ sql: string; params: unknown[] }> }
function makeEnv(cap: Captured) {
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async first() { return null },
            async all() { return { results: [] } },
            async run() { if (/^\s*INSERT/i.test(sql)) cap.inserts.push({ sql, params }); return { success: true } },
          }
        },
      }
    },
  }
  const kv = { async get() { return null }, async put() {}, async delete() {} }
  return {
    DB: db, IDLS: kv, CACHE: kv, JWT_SECRET: SECRET, API_BASE_URL: 'https://api.test',
    SOLANA_MAINNET_RPC_URL: 'https://rpc.test.invalid',
  } as any
}

async function upload(env: any, body: Record<string, unknown>) {
  const token = await generateJWT({ sub: 'user1', username: 'u' }, SECRET)
  return idlApp.request('/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }, env, { waitUntil() {}, passThroughOnException() {} } as any)
}

describe('POST /api/idl/upload — provenance', () => {
  test('no on-chain IDL → accepted, stored as manual, and the response says so', async () => {
    rpcWithNoIdl()
    const cap: Captured = { inserts: [] }
    const res = await upload(makeEnv(cap), { name: 'Demo', programId: PROGRAM, idl: IDL })
    expect(res.status).toBe(201)
    const json = await res.json() as any

    expect(json.provenance.origin).toBe('manual')
    expect(json.provenance.verifiedOnChain).toBe(false)
    expect(json.provenance.notice).toMatch(/No verified on-chain IDL/)
    expect(json.onChainIdl.status).toBe('absent')
    expect(json.warnings.join(' ')).toMatch(/uploaded manually/)

    const versionInsert = cap.inserts.find((i) => i.sql.includes('INSERT INTO idl_versions'))
    expect(versionInsert).toBeDefined()
    expect(versionInsert!.sql).toContain('idl_source')
    expect(versionInsert!.params).toContain('manual')
  })

  test('rejects a programId that is not a valid base58 32-byte address', async () => {
    rpcWithNoIdl()
    for (const bad of ['not-a-pubkey', 'short', '1'.repeat(40), '../../etc/passwd']) {
      const res = await upload(makeEnv({ inserts: [] }), { name: 'Demo', programId: bad, idl: IDL })
      expect(res.status).toBe(400)
      expect(((await res.json()) as any).error).toMatch(/valid base58 Solana program address/)
    }
  })

  test('if the chain cannot be checked, the upload fails closed with 503 and nothing is stored', async () => {
    rpcDown()
    const cap: Captured = { inserts: [] }
    const res = await upload(makeEnv(cap), { name: 'Demo', programId: PROGRAM, idl: IDL })
    expect(res.status).toBe(503)
    expect(((await res.json()) as any).code).toBe('ONCHAIN_IDL_CHECK_FAILED')
    expect(cap.inserts).toHaveLength(0)
  })
})
