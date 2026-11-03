import { describe, test, expect, afterEach } from 'bun:test'
import { Transaction, VersionedTransaction } from '@solana/web3.js'
import { buildTransaction } from '../src/services/tx-builder'
import { TxOptionError } from '../src/services/tx-v1'

const PAYER = '11111111111111111111111111111111'
const PROGRAM = 'ComputeBudget111111111111111111111111111111'
const BLOCKHASH = '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM'

const IDL = {
  name: 'demo',
  version: '0.31.0',
  instructions: [
    {
      name: 'ping',
      discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
      accounts: [{ name: 'payer', isMut: true, isSigner: true }],
      args: [],
    },
  ],
}

function build(extra: Record<string, unknown> = {}) {
  return buildTransaction(
    IDL as any,
    'ping',
    { accounts: { payer: PAYER }, args: {}, feePayer: PAYER, recentBlockhash: BLOCKHASH, ...extra } as any,
    PROGRAM,
    'https://api.mainnet-beta.solana.com',
    { cluster: 'mainnet-beta' as any, rpcUrlHost: 'api.mainnet-beta.solana.com' },
  )
}

function b64ToBytes(b64: string) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

const realFetch = globalThis.fetch
let simulateCalls = 0
function stubSimulate(value: Record<string, unknown> = { err: null, logs: [], unitsConsumed: 5000, loadedAccountsDataSize: 100_000 }) {
  simulateCalls = 0
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body)
    if (body.method === 'simulateTransaction') simulateCalls++
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value } }), { status: 200 })
  }) as any
}
afterEach(() => { globalThis.fetch = realFetch })

describe('buildTransaction txVersion (opt-in)', () => {
  test('default (no txVersion) is unchanged: legacy wire format, base58', async () => {
    const res = await build()
    expect(res.wireFormat).toBe('legacy')
    expect(res.encoding).toBe('base58')
    expect(res.estimatedFee).toBe(5000)
    expect(res.riskReasons.join(' ')).not.toMatch(/v1/)
  })

  test("explicit 'legacy' produces byte-identical output to the default", async () => {
    const a = await build()
    const b = await build({ txVersion: 'legacy' })
    expect(b.serializedTransaction).toBe(a.serializedTransaction)
    expect(b.transaction).toBe(a.transaction)
  })

  test("'v0' returns a v0 VersionedTransaction (no lookup tables), base58 by default", async () => {
    const res = await build({ txVersion: 'v0', encoding: 'base64' })
    expect(res.wireFormat).toBe('v0')
    const tx = VersionedTransaction.deserialize(b64ToBytes(res.serializedTransaction))
    expect(tx.version).toBe(0)
  })

  test("'v1' returns a v1 transaction: 0x81 first byte, base64 default, limits measured via simulation", async () => {
    stubSimulate()
    const res = await build({ txVersion: 'v1' })
    expect(res.wireFormat).toBe('v1')
    expect(res.encoding).toBe('base64')
    const bytes = b64ToBytes(res.serializedTransaction)
    expect(bytes[0]).toBe(0x81)
    expect(res.riskReasons.join(' ')).toContain('computeUnitLimit=5500') // 5000 + 10%
    expect(simulateCalls).toBe(1) // one measuring pass, no final sim unless requested
  })

  test("'v1' with simulate:true simulates the FINAL bytes in addition to the measuring pass", async () => {
    stubSimulate()
    const res = await build({ txVersion: 'v1', simulate: true })
    expect(simulateCalls).toBe(2)
    expect(res.simulationError).toBeNull()
  })

  test("'v1' estimatedFee includes the total priority fee in lamports", async () => {
    stubSimulate()
    const res = await build({ txVersion: 'v1', txConfig: { priorityFeeLamports: 2500 } })
    expect(res.estimatedFee).toBe(5000 + 2500)
  })

  test("'v1' with both limits supplied needs no simulation", async () => {
    stubSimulate()
    await build({ txVersion: 'v1', txConfig: { computeUnitLimit: 10_000, loadedAccountsDataSizeLimit: 50_000 } })
    expect(simulateCalls).toBe(0)
  })

  test("'v1' falls back to protocol maximum limits when measuring fails (never left at zero)", async () => {
    stubSimulate({ err: 'AccountNotFound', logs: [] })
    const res = await build({ txVersion: 'v1' })
    expect(res.riskReasons.join(' ')).toMatch(/protocol maximum/)
  })

  test('txConfig without txVersion v1 is rejected, not silently ignored', async () => {
    await expect(build({ txConfig: { computeUnitLimit: 1000 } })).rejects.toThrow(TxOptionError)
    await expect(build({ txVersion: 'v0', txConfig: { computeUnitLimit: 1000 } })).rejects.toThrow(/only applies to txVersion "v1"/)
  })

  test('an unknown txVersion is rejected', async () => {
    await expect(build({ txVersion: 'v9' })).rejects.toThrow(TxOptionError)
  })

  test('legacy output is still decodable by web3.js Transaction.from', async () => {
    const res = await build({ encoding: 'base64' })
    expect(() => Transaction.from(b64ToBytes(res.serializedTransaction))).not.toThrow()
  })
})
