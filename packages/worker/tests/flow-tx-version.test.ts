import { describe, test, expect, afterEach } from 'bun:test'
import { composeTransactionNode } from '../src/flow-engine/nodes/compose-transaction'
import { describeWireFormat } from '../src/services/tx-v1'
import type { NodeContext } from '../src/flow-engine/types'

const PAYER = '11111111111111111111111111111111'
const PROGRAM = 'ComputeBudget111111111111111111111111111111'
const BLOCKHASH = '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })
let n = 0
function ctx(extra: Partial<NodeContext> = {}): NodeContext {
  globalThis.fetch = (async (_u: any, init: any) => {
    const m = JSON.parse(init.body).method
    if (m === 'getLatestBlockhash') return new Response(JSON.stringify({ result: { value: { blockhash: BLOCKHASH, lastValidBlockHeight: 1 } } }), { status: 200 })
    return new Response(JSON.stringify({ result: { value: { err: null, logs: [], unitsConsumed: 1000, loadedAccountsDataSize: 1000 } } }), { status: 200 })
  }) as any
  return { db: {} as any, cache: {} as any, idls: {} as any, rpcUrl: `https://api.mainnet-beta.solana.com/?n=${n++}`, ...extra }
}
const ix = { programId: PROGRAM, keys: [{ pubkey: PAYER, isSigner: true, isWritable: true }], data: Buffer.from([1]).toString('base64') }
const run = (input: Record<string, unknown>, c: NodeContext) =>
  composeTransactionNode.run({ feePayer: PAYER, instructions: [ix], simulate: false, ...input } as any, c)

describe('solana.compose_transaction@1 txVersion precedence', () => {
  test('no node input, no run-level override → v0 (unchanged default)', async () => {
    const out = await run({}, ctx())
    expect(out.transactions[0]!.wireFormat).toBe('v0')
  })

  test('run-level override applies when the node does not set txVersion', async () => {
    const out = await run({}, ctx({ txVersion: 'v1' }))
    expect(out.transactions[0]!.wireFormat).toBe('v1')
  })

  test('node-level txVersion beats the run-level override', async () => {
    const out = await run({ txVersion: 'v0' }, ctx({ txVersion: 'v1' }))
    expect(out.transactions[0]!.wireFormat).toBe('v0')
  })

  test('node-level txConfig works with a run-level v1 override', async () => {
    const out = await run({ txConfig: { computeUnitLimit: 9000, loadedAccountsDataSizeLimit: 9000 } }, ctx({ txVersion: 'v1' }))
    expect(out.transactions[0]!.wireFormat).toBe('v1')
    expect(out.risk.reasons.join(' ')).not.toMatch(/computeUnitLimit=/) // caller supplied both → nothing measured
  })

  test('kill switch on the context rejects v1 but keeps the default flow working', async () => {
    await expect(run({}, ctx({ txVersion: 'v1', txV1Disabled: true }))).rejects.toThrow(/disabled/)
    const ok = await run({}, ctx({ txV1Disabled: true }))
    expect(ok.transactions[0]!.wireFormat).toBe('v0')
  })
})

describe('describeWireFormat', () => {
  test('is version-specific', () => {
    expect(describeWireFormat('legacy')).toMatch(/Transaction\.from/)
    expect(describeWireFormat('v0')).toMatch(/VersionedTransaction/)
    expect(describeWireFormat('v1')).toMatch(/0x81/)
  })
})
