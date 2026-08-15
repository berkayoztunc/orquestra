import { describe, test, expect } from 'bun:test'
import { classifyParams } from '../src/services/flow-builder-log'
import { estimateCost } from '../src/services/flow-builder-generator'
import { buildProposalMessage } from '../src/services/telegram'
import type { FlowDocument } from '../src/flow-engine/fdl-schema'

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
    const promptOnly = estimateCost(1000, 0)
    const completionOnly = estimateCost(0, 1000)
    expect(promptOnly.neurons).toBeGreaterThan(0)
    expect(completionOnly.neurons).toBeGreaterThan(promptOnly.neurons) // output tokens cost more per-token
    expect(estimateCost(0, 0).neurons).toBe(0)
  })

  test('usd is proportional to neurons at $0.011/1000', () => {
    const { neurons, usd } = estimateCost(10_000, 10_000)
    expect(usd).toBeCloseTo((neurons * 0.011) / 1000, 10)
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
    expect(text).toContain('attempt\\-123')
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
})
