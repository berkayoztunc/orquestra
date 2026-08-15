import { describe, test, expect } from 'bun:test'
import { classifyParams } from '../src/services/flow-builder-log'
import { estimateCost } from '../src/services/flow-builder-cost'
import { buildProposalMessage } from '../src/services/telegram'
import { buildSyntheticInputs, SIMULATION_WALLET, WSOL_MINT } from '../src/services/flow-simulation-inputs'
import { lintReferences, lintDeliverable, parseOutputFields } from '../src/agents/flow-lint'
import type { FlowDocument } from '../src/flow-engine/fdl-schema'

// Literal rather than imported from flow-author-agent.ts: that module pulls in
// the Agents SDK, which requires `cloudflare:email` and cannot load under the
// bun test runtime.
const MODEL = '@cf/moonshotai/kimi-k2.7-code'

function baseDoc(nodes: FlowDocument['nodes'], inputs: FlowDocument['inputs'] = {}): FlowDocument {
  return {
    fdl: '1.0',
    meta: { slug: 'test-flow', name: 'Test Flow', intent: 'test' },
    inputs,
    outputs: { tx: { type: 'transaction' } },
    nodes,
  }
}

describe('classifyParams', () => {
  test('counts declared inputs as Input', () => {
    const doc = baseDoc(
      [{ id: 'ix', type: 'orquestra.build_instruction@1', in: {} }],
      { wallet: { type: 'pubkey' }, amount: { type: 'u64' } },
    )
    const result = classifyParams(doc)
    expect(result.input.sort()).toEqual(['amount', 'wallet'])
  })

  test('resolve.constant nodes are Constant, other resolve.* nodes are Resolvable', () => {
    const doc = baseDoc([
      { id: 'pda', type: 'resolve.pda@1', in: {} },
      { id: 'ata', type: 'resolve.ata@1', in: {} },
      { id: 'sysProg', type: 'resolve.constant@1', in: {} },
      { id: 'ix', type: 'orquestra.build_instruction@1', in: {} },
    ])
    const result = classifyParams(doc)
    expect(result.resolvable.sort()).toEqual(['ata', 'pda'])
    expect(result.constant).toEqual(['sysProg'])
    expect(result.input).toEqual([])
  })

  test('non-resolve node types are ignored (neither resolvable nor constant)', () => {
    const doc = baseDoc([
      { id: 'guard', type: 'logic.assert@1', in: {} },
      { id: 'ix', type: 'orquestra.build_instruction@1', in: {} },
    ])
    const result = classifyParams(doc)
    expect(result.resolvable).toEqual([])
    expect(result.constant).toEqual([])
  })
})

describe('estimateCost', () => {
  test('scales with prompt and completion tokens independently', () => {
    const promptOnly = estimateCost(MODEL, 1000, 0)
    const completionOnly = estimateCost(MODEL, 0, 1000)
    expect(promptOnly.neurons).toBeGreaterThan(0)
    expect(completionOnly.neurons).toBeGreaterThan(promptOnly.neurons) // output tokens cost more per-token
    expect(estimateCost(MODEL, 0, 0).neurons).toBe(0)
  })

  test('usd is proportional to neurons at $0.011/1000', () => {
    const { neurons, usd } = estimateCost(MODEL, 10_000, 10_000)
    expect(usd).toBeCloseTo((neurons * 0.011) / 1000, 10)
  })

  test('kimi is priced well above the llama fallback for the same tokens', () => {
    // Guards the reason this module exists: reusing llama rates for kimi
    // silently misreported every logged cost.
    const kimi = estimateCost('@cf/moonshotai/kimi-k2.7-code', 100_000, 10_000)
    const llama = estimateCost('@cf/meta/llama-3.3-70b-instruct-fp8-fast', 100_000, 10_000)
    expect(kimi.usd).toBeGreaterThan(llama.usd)
  })

  test('unknown model falls back rather than returning zero', () => {
    const unknown = estimateCost('@cf/some/model-that-does-not-exist', 10_000, 1_000)
    expect(unknown.usd).toBeGreaterThan(0)
  })
})

describe('parseOutputFields', () => {
  test('extracts top-level fields and ignores nested shapes', () => {
    expect([...parseOutputFields('{ address: pubkey, bump: number }')].sort()).toEqual(['address', 'bump'])
    expect([...parseOutputFields('{ address: pubkey, exists: boolean, createIx: FlowInstruction | null, tokenProgram: pubkey }')].sort())
      .toEqual(['address', 'createIx', 'exists', 'tokenProgram'])
  })

  test('handles nested objects, arrays and optional keys', () => {
    const fields = parseOutputFields(
      '{ transactions: { unsignedTransaction: string, simulation?: { success, err } }[], risk: { level, reasons: string[] } }',
    )
    // Only depth-1 keys — nested `unsignedTransaction`/`level` must not leak out.
    expect([...fields].sort()).toEqual(['risk', 'transactions'])
  })

  test('ignores parenthetical prose containing colons', () => {
    const fields = parseOutputFields('{ address: pubkey (the token program actually used: auto-detected), bump: number }')
    expect([...fields].sort()).toEqual(['address', 'bump'])
  })
})

describe('lintReferences', () => {
  const ataDoc = (ref: string) =>
    baseDoc(
      [
        { id: 'ata', type: 'resolve.ata@1', in: { owner: '$inputs.wallet', mint: '$inputs.mint' } },
        { id: 'ix', type: 'orquestra.build_instruction@1', in: { accounts: { tokenAccount: ref } } },
      ],
      { wallet: { type: 'pubkey' }, mint: { type: 'pubkey' } },
    )

  test('accepts a reference to a field the node actually emits', () => {
    expect(lintReferences(ataDoc('$ata.address'))).toEqual([])
  })

  test('rejects a reference to a field the node does not emit', () => {
    // This is the exact bug class that crashed production with
    // "Cannot read properties of undefined (reading '_bn')".
    const errors = lintReferences(ataDoc('$ata.addres'))
    expect(errors).toHaveLength(1)
    expect(errors[0].nodeId).toBe('ix')
    expect(errors[0].message).toContain('addres')
    expect(errors[0].message).toContain('address')
  })

  test('ignores $inputs refs and whole-node refs', () => {
    const doc = baseDoc(
      [
        { id: 'ix', type: 'orquestra.build_instruction@1', in: { a: '$inputs.wallet', b: '$ata' } },
        { id: 'ata', type: 'resolve.ata@1', in: {} },
      ],
      { wallet: { type: 'pubkey' } },
    )
    expect(lintReferences(doc)).toEqual([])
  })

  test('ignores refs to unknown node types rather than guessing', () => {
    const doc = baseDoc([
      { id: 'x', type: 'not.a.real.node@9', in: {} },
      { id: 'ix', type: 'orquestra.build_instruction@1', in: { a: '$x.whatever' } },
    ])
    expect(lintReferences(doc)).toEqual([])
  })
})

describe('lintDeliverable', () => {
  const build = { id: 'ix', type: 'orquestra.build_instruction@1', in: {} }
  const compose = { id: 'tx', type: 'solana.compose_transaction@1', in: {} }

  test('accepts a flow that builds an instruction and composes one transaction', () => {
    expect(lintDeliverable(baseDoc([build, compose]))).toEqual([])
  })

  test('rejects an inspection-only flow that produces no transaction', () => {
    // A real run finalized exactly this: a scratch flow that only read an
    // account, which is valid FDL but useless as a published flow.
    const errors = lintDeliverable(baseDoc([{ id: 'probe', type: 'resolve.account_data@1', in: {} }]))
    expect(errors).toHaveLength(2)
    expect(errors.join(' ')).toContain('builds no instruction')
    expect(errors.join(' ')).toContain('produces no transaction')
  })

  test('rejects more than one terminal compose node', () => {
    const errors = lintDeliverable(baseDoc([build, compose, { ...compose, id: 'tx2' }]))
    expect(errors.join(' ')).toContain('exactly one terminal compose node')
  })
})

describe('buildSyntheticInputs', () => {
  test('uses the real funded simulation wallet for pubkey inputs', () => {
    const inputs = buildSyntheticInputs({ wallet: { type: 'pubkey' } })
    expect(inputs.wallet).toBe(SIMULATION_WALLET)
    // The old System Program placeholder owns no ATAs and no SOL, which made
    // every simulation fail on the wallet rather than on the flow.
    expect(inputs.wallet).not.toBe('11111111111111111111111111111111')
  })

  test('mint-shaped inputs get a real mint, not a wallet', () => {
    // A wallet address does not decode as a mint, which made simulations fail
    // on the placeholder rather than on the flow.
    const inputs = buildSyntheticInputs({ inputMint: { type: 'pubkey' }, wallet: { type: 'pubkey' } })
    expect(inputs.inputMint).toBe(WSOL_MINT)
    expect(inputs.wallet).toBe(SIMULATION_WALLET)
  })

  test('a declared default always wins over the generated value', () => {
    const inputs = buildSyntheticInputs({
      slippageBps: { type: 'bps', default: 300 },
      wallet: { type: 'pubkey', default: 'SoMeOtherWallet1111111111111111111111111111' },
    })
    expect(inputs.slippageBps).toBe(300)
    expect(inputs.wallet).toBe('SoMeOtherWallet1111111111111111111111111111')
  })

  test('fills each declared type with a usable value', () => {
    const inputs = buildSyntheticInputs({
      amount: { type: 'u64' },
      flag: { type: 'bool' },
      memo: { type: 'string' },
      bps: { type: 'bps' },
    })
    expect(inputs.amount).toBe(1)
    expect(inputs.flag).toBe(true)
    expect(inputs.memo).toBe('test')
    expect(inputs.bps).toBe(50)
  })
})

describe('buildProposalMessage', () => {
  test('includes attempt id and program id for traceability', () => {
    const text = buildProposalMessage({
      attemptId: 'attempt-123',
      programId: 'Prog11111111111111111111111111111111111',
      projectName: 'Test Program',
      reason: 'no_flow',
      paramCounts: { input: 2, resolvable: 3, constant: 1 },
      newInputCount: 2,
      newRpcCalls: 4,
      simulationSummary: 'OK, 4 RPC calls',
      model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    })
    expect(text).toContain('attempt-123')
    expect(text).toContain('Prog11111111111111111111111111111111111')
  })

  test('shows prior counts when optimizing an existing flow', () => {
    const text = buildProposalMessage({
      attemptId: 'a1',
      programId: 'Prog1',
      projectName: 'X',
      reason: 'optimization_candidate',
      paramCounts: { input: 1, resolvable: 2, constant: 0 },
      newInputCount: 1,
      newRpcCalls: 2,
      priorInputCount: 3,
      priorRpcCalls: 5,
      simulationSummary: 'OK',
      model: 'm',
    })
    expect(text).toContain('was 3 inputs')
  })

  test('is plain text — no MarkdownV2 escaping that Telegram would reject', () => {
    // An unescaped "(" around the program id used to fail every send with
    // 400 "can't parse entities", so no proposal was ever delivered.
    const text = buildProposalMessage({
      attemptId: 'a1',
      programId: 'Prog1',
      projectName: 'A2a Swap',
      reason: 'no_flow',
      paramCounts: { input: 1, resolvable: 1, constant: 0 },
      newInputCount: 1,
      newRpcCalls: 1,
      simulationSummary: 'OK, 1 RPC calls',
      model: '@cf/moonshotai/kimi-k2.7-code',
    })
    expect(text).not.toContain('\\')
    expect(text).toContain('(Prog1)')
  })
})
