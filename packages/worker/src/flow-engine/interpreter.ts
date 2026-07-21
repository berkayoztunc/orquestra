/**
 * Stratified FlowPlan interpreter.
 *
 * Walks `plan.strata` in order. Within a stratum: resolves each node's `if`
 * guard, skips falsy ones, resolves the remaining nodes' `in` objects against
 * accumulated run state, and executes them concurrently via `Promise.all`.
 * Enforces wall-time and read/external call budgets between strata.
 */

import { isRefString, parseRef, type ParsedRef } from './fdl-schema'
import { looksLikeExpression, parseExpression, evaluateExpression } from './expression'
import { getNode } from './node-registry'
import type { NodeContext } from './types'
import type { FlowPlan, PlanNode } from './compiler'

export interface RunError {
  nodeId?: string
  message: string
}

export interface RunCallCounts {
  rpcCalls: number
  externalCalls: number
}

export type RunResult =
  | ({ ok: true; outputs: Record<string, unknown>; nodeOutputs: Record<string, unknown> } & RunCallCounts)
  | ({ ok: false; error: RunError; nodeOutputs: Record<string, unknown> } & RunCallCounts)

interface RunState {
  inputs: Record<string, unknown>
  nodeOutputs: Record<string, unknown>
  skipped: Set<string>
}

/** Tags a thrown error with the id of the node that produced it. */
class NodeRunError extends Error {
  nodeId: string
  constructor(nodeId: string, cause: unknown) {
    const message =
      cause instanceof Error
        ? cause.message
        : String((cause as { message?: unknown } | null | undefined)?.message ?? cause)
    super(message)
    this.nodeId = nodeId
  }
}

function getPath(root: unknown, path: string[]): unknown {
  let cur = root
  for (const seg of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

/** Resolve a parsed reference against current run state. Unresolvable -> undefined. */
function resolveRef(ref: ParsedRef, state: RunState): unknown {
  if (ref.root === 'inputs') {
    return getPath(state.inputs, ref.path)
  }
  if (state.skipped.has(ref.root)) {
    return undefined
  }
  if (!(ref.root in state.nodeOutputs)) {
    return undefined
  }
  return getPath(state.nodeOutputs[ref.root], ref.path)
}

/** Evaluate an expression string (already validated at compile time) against run state. */
function resolveExpressionString(src: string, state: RunState): string | number | boolean | null {
  const ast = parseExpression(src)
  return evaluateExpression(ast, (root, path) => resolveRef({ root, path, optional: false, raw: '' }, state))
}

/**
 * Deep-resolve a value (as found in a node's `in` object) against run state.
 * - A bare `$ref` (optionally `?`-suffixed) as the *whole* value is replaced by its
 *   resolved value unmodified (including whole objects/arrays); an unresolved
 *   optional ref becomes `null`.
 * - A string containing a `$ref` PLUS an operator is an EXPRESSION — evaluated to a
 *   primitive via expression.ts. No `?`-optional form; an undefined ref inside an
 *   expression always throws.
 * - Inside arrays, an unresolved optional `$ref?` entry is DROPPED from the array.
 * - Objects are walked recursively; non-ref literals pass through unchanged.
 */
function resolveValue(value: unknown, state: RunState): unknown {
  if (isRefString(value)) {
    const parsed = parseRef(value)
    if (parsed) {
      const resolved = resolveRef(parsed, state)
      if (parsed.optional && (resolved === null || resolved === undefined)) {
        return null
      }
      return resolved
    }
    if (looksLikeExpression(value)) {
      return resolveExpressionString(value, state)
    }
    return value
  }

  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (const item of value) {
      if (isRefString(item)) {
        const parsed = parseRef(item)
        if (parsed?.optional) {
          const resolved = resolveRef(parsed, state)
          if (resolved === null || resolved === undefined) {
            continue // drop this array entry entirely
          }
          out.push(resolved)
          continue
        }
      }
      out.push(resolveValue(item, state))
    }
    return out
  }

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = resolveValue((value as Record<string, unknown>)[key], state)
    }
    return out
  }

  return value
}

/** `if` must be a bare (non-optional) $ref or an expression; unresolvable/falsy -> skip. */
function resolveIf(ifRef: string, state: RunState): boolean {
  const parsed = parseRef(ifRef)
  if (parsed) return Boolean(resolveRef(parsed, state))
  if (looksLikeExpression(ifRef)) return Boolean(resolveExpressionString(ifRef, state))
  return false
}

export async function run(
  plan: FlowPlan,
  inputs: Record<string, unknown>,
  ctx: NodeContext,
): Promise<RunResult> {
  const nodeOutputs: Record<string, unknown> = {}
  const skipped = new Set<string>()
  const state: RunState = { inputs, nodeOutputs, skipped }

  const startedAt = Date.now()
  let rpcCallCount = 0
  let externalCallCount = 0

  for (const stratum of plan.strata) {
    // Wall-time budget — checked before every stratum.
    if (Date.now() - startedAt > plan.budgets.wallTimeMs) {
      return { ok: false, error: { message: 'wallTimeMs budget exceeded' }, nodeOutputs, rpcCalls: rpcCallCount, externalCalls: externalCallCount }
    }

    // Resolve `if` guards; partition into runnable vs skipped.
    const runnable: PlanNode[] = []
    for (const node of stratum) {
      if (node.if !== undefined && !resolveIf(node.if, state)) {
        skipped.add(node.id)
        continue
      }
      runnable.push(node)
    }

    // Budget accounting for this stratum's eligible invocations, checked before executing.
    let strataRpc = 0
    let strataExternal = 0
    const implByNodeId = new Map(runnable.map((node) => [node.id, getNode(node.type)] as const))
    for (const impl of implByNodeId.values()) {
      if (!impl) continue
      if (impl.effect === 'read') strataRpc++
      else if (impl.effect === 'external') strataExternal++
    }
    if (rpcCallCount + strataRpc > plan.budgets.rpcCalls) {
      return { ok: false, error: { message: 'budget exceeded: rpcCalls' }, nodeOutputs, rpcCalls: rpcCallCount, externalCalls: externalCallCount }
    }
    if (externalCallCount + strataExternal > plan.budgets.externalCalls) {
      return { ok: false, error: { message: 'budget exceeded: externalCalls' }, nodeOutputs, rpcCalls: rpcCallCount, externalCalls: externalCallCount }
    }
    rpcCallCount += strataRpc
    externalCallCount += strataExternal

    // Execute the stratum concurrently.
    try {
      const results = await Promise.all(
        runnable.map(async (node) => {
          const impl = implByNodeId.get(node.id)
          if (!impl) {
            throw new NodeRunError(node.id, `unknown node type "${node.type}"`)
          }
          try {
            const resolvedInput = resolveValue(node.in, state) as Record<string, unknown>
            const output = await impl.run(resolvedInput, ctx)
            return { id: node.id, output }
          } catch (err) {
            throw new NodeRunError(node.id, err)
          }
        }),
      )
      for (const { id, output } of results) {
        nodeOutputs[id] = output
      }
    } catch (err) {
      if (err instanceof NodeRunError) {
        return { ok: false, error: { nodeId: err.nodeId, message: err.message }, nodeOutputs, rpcCalls: rpcCallCount, externalCalls: externalCallCount }
      }
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { message }, nodeOutputs, rpcCalls: rpcCallCount, externalCalls: externalCallCount }
    }
  }

  return { ok: true, outputs: nodeOutputs, nodeOutputs, rpcCalls: rpcCallCount, externalCalls: externalCallCount }
}
