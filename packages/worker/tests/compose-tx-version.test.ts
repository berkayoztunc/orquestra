import { describe, test, expect, afterEach } from 'bun:test'
import { VersionedTransaction } from '@solana/web3.js'
import { composeTransaction, packInstructionsIntoV1Batches } from '../src/services/tx-builder'
import { TxOptionError } from '../src/services/tx-v1'

const PAYER = '11111111111111111111111111111111'
const PROGRAM = 'ComputeBudget111111111111111111111111111111'
const BLOCKHASH = '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM'

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function key(i: number): string {
  const bytes = new Uint8Array(32)
  bytes[0] = 1; bytes[30] = (i >> 8) & 0xff; bytes[31] = i & 0xff
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  let out = ''
  while (n > 0n) { out = ALPHABET[Number(n % 58n)]! + out; n /= 58n }
  return out
}

function flowIx(accounts = 1, dataBytes = 4, seed = 0) {
  return {
    programId: PROGRAM,
    keys: [
      { pubkey: PAYER, isSigner: true, isWritable: true },
      ...Array.from({ length: accounts }, (_, i) => ({ pubkey: key(seed * 100 + i), isSigner: false, isWritable: false })),
    ],
    data: Buffer.alloc(dataBytes, 7).toString('base64'),
  }
}

const realFetch = globalThis.fetch
const methods: string[] = []
let rpcCounter = 0
function stubRpc() {
  methods.length = 0
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body)
    methods.push(body.method)
    if (body.method === 'getLatestBlockhash') {
      return new Response(JSON.stringify({ result: { value: { blockhash: BLOCKHASH, lastValidBlockHeight: 100 } } }), { status: 200 })
    }
    if (body.method === 'simulateTransaction') {
      return new Response(JSON.stringify({ result: { value: { err: null, logs: [], unitsConsumed: 3000, loadedAccountsDataSize: 50_000 } } }), { status: 200 })
    }
    return new Response(JSON.stringify({ result: { value: null } }), { status: 200 })
  }) as any
}
afterEach(() => { globalThis.fetch = realFetch })
// unique rpc url per test → bypasses the warm-isolate blockhash cache
const rpc = () => `https://api.mainnet-beta.solana.com/?t=${rpcCounter++}`

describe('composeTransaction txVersion (opt-in)', () => {
  test('default is unchanged: v0', async () => {
    stubRpc()
    const res = await composeTransaction({ feePayer: PAYER, instructions: [flowIx()], rpcUrl: rpc(), simulate: false })
    expect(res.transactions).toHaveLength(1)
    expect(res.transactions[0]!.wireFormat).toBe('v0')
    const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(res.transactions[0]!.unsignedTransaction), (c) => c.charCodeAt(0)))
    expect(tx.version).toBe(0)
    expect(methods).not.toContain('simulateTransaction')
  })

  test("'legacy' compiles a legacy message", async () => {
    stubRpc()
    const res = await composeTransaction({ feePayer: PAYER, instructions: [flowIx()], rpcUrl: rpc(), simulate: false, txVersion: 'legacy' })
    expect(res.transactions[0]!.wireFormat).toBe('legacy')
    const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(res.transactions[0]!.unsignedTransaction), (c) => c.charCodeAt(0)))
    expect(tx.version).toBe('legacy')
  })

  test("'v1' emits a v1 transaction with measured limits and records how they were chosen", async () => {
    stubRpc()
    const res = await composeTransaction({ feePayer: PAYER, instructions: [flowIx(), flowIx(2, 4, 1)], rpcUrl: rpc(), simulate: false, txVersion: 'v1' })
    expect(res.transactions).toHaveLength(1)
    const t = res.transactions[0]!
    expect(t.wireFormat).toBe('v1')
    expect(t.instructionCount).toBe(2)
    expect(Uint8Array.from(atob(t.unsignedTransaction), (c) => c.charCodeAt(0))[0]).toBe(0x81)
    expect(res.risk.reasons.join(' ')).toContain('computeUnitLimit=3300')
  })

  test("'v1' skips lookup tables with a note and never fetches them", async () => {
    stubRpc()
    const res = await composeTransaction({
      feePayer: PAYER, instructions: [flowIx()], rpcUrl: rpc(), simulate: false,
      txVersion: 'v1', lookupTableAddresses: [key(999)],
    })
    expect(res.risk.reasons.join(' ')).toMatch(/does not support address lookup tables/)
    expect(methods).not.toContain('getMultipleAccounts')
    expect(methods).not.toContain('getAccountInfo')
  })

  test("'legacy' with lookup tables is an error", async () => {
    stubRpc()
    await expect(
      composeTransaction({ feePayer: PAYER, instructions: [flowIx()], rpcUrl: rpc(), simulate: false, txVersion: 'legacy', lookupTableAddresses: [key(999)] }),
    ).rejects.toThrow(/cannot use address lookup tables/)
  })

  test("'v1' with more than 64 accounts fails with an actionable hint", async () => {
    stubRpc()
    await expect(
      composeTransaction({ feePayer: PAYER, instructions: [flowIx(70)], rpcUrl: rpc(), simulate: false, txVersion: 'v1' }),
    ).rejects.toThrow(/txVersion "v0" with lookupTableAddresses/)
  })

  test('kill switch (txV1Disabled) rejects v1 but not v0', async () => {
    stubRpc()
    await expect(
      composeTransaction({ feePayer: PAYER, instructions: [flowIx()], rpcUrl: rpc(), simulate: false, txVersion: 'v1', txV1Disabled: true }),
    ).rejects.toThrow(TxOptionError)
    const ok = await composeTransaction({ feePayer: PAYER, instructions: [flowIx()], rpcUrl: rpc(), simulate: false, txVersion: 'v0', txV1Disabled: true })
    expect(ok.transactions[0]!.wireFormat).toBe('v0')
  })

  test('txConfig without txVersion v1 is rejected', async () => {
    stubRpc()
    await expect(
      composeTransaction({ feePayer: PAYER, instructions: [flowIx()], rpcUrl: rpc(), simulate: false, txConfig: { computeUnitLimit: 1 } }),
    ).rejects.toThrow(/only applies to txVersion "v1"/)
  })

  test('v1 with simulate (default) simulates each final transaction', async () => {
    stubRpc()
    const res = await composeTransaction({ feePayer: PAYER, instructions: [flowIx()], rpcUrl: rpc(), txVersion: 'v1' })
    expect(res.transactions[0]!.simulation?.success).toBe(true)
    expect(methods.filter((m) => m === 'simulateTransaction')).toHaveLength(2) // measuring pass + final
  })
})

describe('packInstructionsIntoV1Batches', () => {
  const ix = (seed: number, bytes: number) => ({
    programId: PROGRAM,
    keys: [{ pubkey: PAYER, isSigner: true, isWritable: true }, { pubkey: key(seed), isSigner: false, isWritable: true }],
    data: new Uint8Array(bytes).fill(seed),
  })

  test('uses the 4096-byte limit: what needed 4 legacy packets fits fewer v1 packets', async () => {
    const instructions = [ix(1, 900), ix(2, 900), ix(3, 900), ix(4, 900)]
    const sizes = await packInstructionsIntoV1Batches(instructions, PAYER, BLOCKHASH)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(4)
    expect(sizes.length).toBeLessThan(4) // 4 x ~900B > 1232 would need several legacy/v0 packets
    expect(sizes).toEqual([4]) // 3600B + overhead fits one 4096 packet
  })

  test('splits in order when a v1 packet is exceeded, preserving instruction order', async () => {
    const instructions = [ix(1, 1900), ix(2, 1900), ix(3, 1900)]
    const sizes = await packInstructionsIntoV1Batches(instructions, PAYER, BLOCKHASH)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(3)
    expect(sizes.length).toBeGreaterThan(1)
  })

  test('a single instruction larger than 4096 bytes throws', async () => {
    await expect(packInstructionsIntoV1Batches([ix(1, 5000)], PAYER, BLOCKHASH)).rejects.toThrow(TxOptionError)
  })
})
