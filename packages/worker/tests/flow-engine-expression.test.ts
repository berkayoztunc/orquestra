import { describe, test, expect } from 'bun:test'
import { parseExpression, evaluateExpression, collectExprRefs, looksLikeExpression, ExpressionSyntaxError } from '../src/flow-engine/expression'
import { compile } from '../src/flow-engine/compiler'
import { run } from '../src/flow-engine/interpreter'
import type { FlowDocument } from '../src/flow-engine/fdl-schema'
import type { NodeContext } from '../src/flow-engine/types'
import '../src/flow-engine'

const dummyCtx: NodeContext = {
  db: {} as NodeContext['db'],
  cache: {} as NodeContext['cache'],
  idls: {} as NodeContext['idls'],
  rpcUrl: 'https://api.mainnet-beta.solana.com',
}

describe('looksLikeExpression', () => {
  test('a bare ref is not an expression', () => {
    expect(looksLikeExpression('$node.field')).toBe(false)
    expect(looksLikeExpression('$node.field?')).toBe(false)
  })
  test('a ref with an operator is an expression', () => {
    expect(looksLikeExpression('$node.field > 0')).toBe(true)
    expect(looksLikeExpression('$a.x && $b.y')).toBe(true)
  })
  test('a plain literal is not an expression', () => {
    expect(looksLikeExpression('hello world')).toBe(false)
    expect(looksLikeExpression(42)).toBe(false)
  })
})

describe('parseExpression + evaluateExpression', () => {
  function evalWith(src: string, vars: Record<string, unknown>) {
    const ast = parseExpression(src)
    return evaluateExpression(ast, (root, path) => {
      let cur: unknown = vars[root]
      for (const seg of path) {
        if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
        cur = (cur as Record<string, unknown>)[seg]
      }
      return cur
    })
  }

  test('numeric comparisons', () => {
    expect(evalWith('$a.x > 0', { a: { x: 5 } })).toBe(true)
    expect(evalWith('$a.x > 0', { a: { x: -1 } })).toBe(false)
    expect(evalWith('$a.x >= 5', { a: { x: 5 } })).toBe(true)
    expect(evalWith('$a.x <= 4', { a: { x: 5 } })).toBe(false)
  })

  test('equality works on any primitive type', () => {
    expect(evalWith('$a.x == 5', { a: { x: 5 } })).toBe(true)
    expect(evalWith('$a.x == "ok"', { a: { x: 'ok' } })).toBe(true)
    expect(evalWith('$a.x != "ok"', { a: { x: 'no' } })).toBe(true)
    expect(evalWith('$a.x == true', { a: { x: true } })).toBe(true)
  })

  test('boolean operators with short-circuit', () => {
    expect(evalWith('$a.x > 0 && $a.y > 0', { a: { x: 1, y: 1 } })).toBe(true)
    expect(evalWith('$a.x > 0 && $a.y > 0', { a: { x: -1, y: 1 } })).toBe(false)
    expect(evalWith('$a.x > 0 || $a.y > 0', { a: { x: -1, y: 1 } })).toBe(true)
    expect(evalWith('!($a.x > 0)', { a: { x: -1 } })).toBe(true)
    // short-circuit: right side references something that would throw if evaluated
    expect(evalWith('$a.x > 0 && $missing.field > 0', { a: { x: -1 } })).toBe(false)
  })

  test('arithmetic with correct precedence', () => {
    expect(evalWith('$a.x + $a.y * 2', { a: { x: 1, y: 3 } })).toBe(7)
    expect(evalWith('($a.x + $a.y) * 2', { a: { x: 1, y: 3 } })).toBe(8)
    expect(evalWith('$a.x - $a.y', { a: { x: 10, y: 4 } })).toBe(6)
    expect(evalWith('$a.x / 2 > 3', { a: { x: 10 } })).toBe(true)
  })

  test('a bare ref with no operator round-trips any value unmodified via evaluateExpression directly', () => {
    // (the interpreter never routes a pure bare ref through the expression evaluator —
    // this just proves the evaluator itself doesn't coerce ref values it's handed)
    const obj = { nested: true, arr: [1, 2, 3] }
    expect(evalWith('$a.x', { a: { x: obj } })).toBe(obj)
  })

  test('malformed expressions throw ExpressionSyntaxError', () => {
    expect(() => parseExpression('$a.x >')).toThrow(ExpressionSyntaxError)
    expect(() => parseExpression('$a.x && && $b.y')).toThrow(ExpressionSyntaxError)
    expect(() => parseExpression('$a.x > 0 (')).toThrow(ExpressionSyntaxError)
    expect(() => parseExpression('foo($a.x)')).toThrow(ExpressionSyntaxError) // no function calls
  })

  test('collectExprRefs finds every $ref in the tree', () => {
    const ast = parseExpression('$a.x > 0 && $b.y == $c.z')
    const refs = collectExprRefs(ast).map((r) => r.raw)
    expect(refs.sort()).toEqual(['$a.x', '$b.y', '$c.z'].sort())
  })

  test('evaluating a ref that resolves to undefined throws', () => {
    expect(() => evalWith('$missing.field > 0', {})).toThrow(/resolved to undefined/)
  })
})

describe('expressions in FDL: compile time', () => {
  test('an expression is accepted in a node "if" field and its refs feed the dependency graph', async () => {
    const doc: FlowDocument = {
      fdl: '1.0',
      meta: { slug: 'test-expr-if', name: 'Test', intent: 'test' },
      inputs: { program: { type: 'pubkey' }, threshold: { type: 'u64' } },
      outputs: { out: { type: 'json' } },
      nodes: [
        { id: 'pda', type: 'resolve.pda@1', in: { program: '$inputs.program', seeds: ['vault'] } },
        { id: 'guard', type: 'logic.assert@1', in: { condition: true }, if: '$pda.bump > 0' },
      ],
    }
    const result = await compile(doc)
    expect(result.ok).toBe(true)
    if (result.ok) {
      // guard depends on pda (via the expression's $pda.bump ref), so pda must come first
      expect(result.plan.strata[0].map((n) => n.id)).toEqual(['pda'])
      expect(result.plan.strata[1].map((n) => n.id)).toEqual(['guard'])
    }
  })

  test('a malformed expression is reported as a CompileError, not a crash', async () => {
    const doc: FlowDocument = {
      fdl: '1.0',
      meta: { slug: 'test-expr-bad', name: 'Test', intent: 'test' },
      inputs: { program: { type: 'pubkey' } },
      outputs: { out: { type: 'json' } },
      nodes: [{ id: 'pda', type: 'resolve.pda@1', in: { program: '$inputs.program', seeds: ['vault'] }, if: '$pda.bump >' }],
    }
    const result = await compile(doc)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('invalid expression'))).toBe(true)
    }
  })

  test('an expression referencing a nonexistent node is an unresolvable-reference CompileError', async () => {
    const doc: FlowDocument = {
      fdl: '1.0',
      meta: { slug: 'test-expr-dangling', name: 'Test', intent: 'test' },
      inputs: { program: { type: 'pubkey' } },
      outputs: { out: { type: 'json' } },
      nodes: [{ id: 'pda', type: 'resolve.pda@1', in: { program: '$inputs.program', seeds: ['vault'] }, if: '$doesNotExist.field > 0' }],
    }
    const result = await compile(doc)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('unresolvable node reference'))).toBe(true)
    }
  })
})

describe('expressions in FDL: run time', () => {
  test('a node behind a true expression guard runs; a false one is skipped', async () => {
    const makeDoc = (op: string): FlowDocument => ({
      fdl: '1.0',
      meta: { slug: 'test-expr-run', name: 'Test', intent: 'test' },
      inputs: { program: { type: 'pubkey' } },
      outputs: { out: { type: 'json' } },
      nodes: [
        { id: 'pda', type: 'resolve.pda@1', in: { program: '$inputs.program', seeds: ['vault'] } },
        { id: 'guard', type: 'logic.assert@1', in: { condition: true }, if: `$pda.bump ${op} 0` },
      ],
    })

    const compiledTrue = await compile(makeDoc('>='))
    expect(compiledTrue.ok).toBe(true)
    if (compiledTrue.ok) {
      const result = await run(compiledTrue.plan, { program: '11111111111111111111111111111111' }, dummyCtx)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.nodeOutputs.guard).toEqual({ ok: true })
    }

    const compiledFalse = await compile(makeDoc('<'))
    expect(compiledFalse.ok).toBe(true)
    if (compiledFalse.ok) {
      const result = await run(compiledFalse.plan, { program: '11111111111111111111111111111111' }, dummyCtx)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.nodeOutputs.guard).toBeUndefined()
    }
  })

  test('RunResult reports rpcCalls/externalCalls counts', async () => {
    const doc: FlowDocument = {
      fdl: '1.0',
      meta: { slug: 'test-call-counts', name: 'Test', intent: 'test' },
      inputs: { program: { type: 'pubkey' } },
      outputs: { out: { type: 'json' } },
      nodes: [{ id: 'pda', type: 'resolve.pda@1', in: { program: '$inputs.program', seeds: ['vault'] } }],
    }
    const compiled = await compile(doc)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return
    const result = await run(compiled.plan, { program: '11111111111111111111111111111111' }, dummyCtx)
    expect(result.rpcCalls).toBe(0) // resolve.pda@1 is "pure", not "read"
    expect(result.externalCalls).toBe(0)
  })
})
