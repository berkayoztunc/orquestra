/**
 * FDL -> FlowPlan compiler.
 *
 * Validates a Flow Definition Language document, builds its dependency graph,
 * topologically batches nodes into "strata" (parallel execution batches), and
 * computes a content-addressed hash of the document.
 *
 * NOTE on `compile()`'s signature: the hash is a SHA-256 digest computed via
 * Web Crypto (`crypto.subtle.digest`), which is Promise-only in every runtime
 * (Workers included — there is no synchronous subtle-crypto API). `compile()`
 * is therefore `async` / returns `Promise<CompileResult>`, which is a
 * necessary deviation from a hypothetical fully-synchronous signature.
 */

import {
  FlowDocumentSchema,
  walkRefs,
  parseRef,
  collectExpressionStrings,
  type FlowDocument,
  type FlowNode,
  type FlowMeta,
  type FlowInputSpec,
  type FlowOutputSpec,
} from './fdl-schema'
import { looksLikeExpression, parseExpression, collectExprRefs, ExpressionSyntaxError } from './expression'
import { getNode } from './node-registry'

export interface CompileError {
  nodeId?: string
  path?: string
  message: string
}

export interface PlanNode {
  id: string
  type: string // "resolve.ata@1"
  in: Record<string, unknown> // raw `in` object from the FDL doc, unmodified — interpreter resolves refs at runtime
  if?: string
}

export interface FlowPlan {
  hash: string // SHA-256 hex of the canonicalized FlowDocument
  meta: FlowMeta
  inputs: Record<string, FlowInputSpec>
  outputs: Record<string, FlowOutputSpec>
  strata: PlanNode[][] // topologically-sorted parallel batches
  budgets: { wallTimeMs: number; externalCalls: number; rpcCalls: number }
}

export type CompileResult = { ok: true; plan: FlowPlan } | { ok: false; errors: CompileError[] }

export interface CompileOptions {
  /** Skip the "node type must be registered" check. Useful in tests where node
   *  implementations haven't been registered in the current process yet. */
  skipNodeTypeCheck?: boolean
}

/** Recursively sort object keys (arrays keep their original order) so JSON.stringify is stable. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = canonicalize(obj[key])
    }
    return sorted
  }
  return value
}

/** Exported for reuse anywhere else in the worker that needs the same SHA-256-hex primitive (e.g. hashing run inputs for `flow_runs.inputs_hash`). */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Kahn's-algorithm topological batching. Returns leftover (cyclic) node ids that never reached in-degree 0. */
function kahnStrata(
  nodeIds: Set<string>,
  deps: Map<string, Set<string>>,
): { strata: string[][]; cyclic: string[] } {
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()
  for (const id of nodeIds) {
    inDegree.set(id, deps.get(id)?.size ?? 0)
    adjacency.set(id, [])
  }
  for (const [id, depSet] of deps) {
    for (const dep of depSet) {
      adjacency.get(dep)?.push(id)
    }
  }

  const strata: string[][] = []
  const remaining = new Set(nodeIds)
  while (remaining.size > 0) {
    const ready = Array.from(remaining).filter((id) => (inDegree.get(id) ?? 0) === 0)
    if (ready.length === 0) break // everything left is part of a cycle
    ready.sort() // deterministic ordering within a stratum
    strata.push(ready)
    for (const id of ready) {
      remaining.delete(id)
      for (const next of adjacency.get(id) ?? []) {
        inDegree.set(next, (inDegree.get(next) ?? 0) - 1)
      }
    }
  }
  return { strata, cyclic: Array.from(remaining) }
}

export async function compile(doc: FlowDocument, opts: CompileOptions = {}): Promise<CompileResult> {
  // 1. Structural validation.
  const parsed = FlowDocumentSchema.safeParse(doc)
  if (!parsed.success) {
    const errors: CompileError[] = parsed.error.issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.join('.') : undefined,
      message: issue.message,
    }))
    return { ok: false, errors }
  }
  const validDoc = parsed.data
  const errors: CompileError[] = []

  // 2. Node type registration.
  if (!opts.skipNodeTypeCheck) {
    for (const node of validDoc.nodes) {
      if (!getNode(node.type)) {
        errors.push({ nodeId: node.id, message: `unknown node type "${node.type}"` })
      }
    }
  }

  // 3. Unique node ids.
  const idCounts = new Map<string, number>()
  for (const node of validDoc.nodes) {
    idCounts.set(node.id, (idCounts.get(node.id) ?? 0) + 1)
  }
  for (const [id, count] of idCounts) {
    if (count > 1) {
      errors.push({ nodeId: id, message: `duplicate node id "${id}" (declared ${count} times)` })
    }
  }

  // Build a de-duplicated node map (first occurrence wins) for graph analysis.
  const nodeById = new Map<string, FlowNode>()
  for (const node of validDoc.nodes) {
    if (!nodeById.has(node.id)) nodeById.set(node.id, node)
  }
  const nodeIds = new Set(nodeById.keys())
  const inputKeys = new Set(Object.keys(validDoc.inputs))

  // 3.5. Expression syntax validation — every expression string (inside `in`, or a
  //      non-bare-ref `if`) must parse cleanly. Checked once, up front, so a malformed
  //      expression is reported here with a precise position rather than surfacing as a
  //      confusing runtime failure the first time a flow actually executes.
  for (const node of nodeById.values()) {
    const exprStrings = collectExpressionStrings(node.in)
    if (node.if && looksLikeExpression(node.if)) exprStrings.push(node.if)

    for (const src of exprStrings) {
      try {
        parseExpression(src)
      } catch (err) {
        const message = err instanceof ExpressionSyntaxError ? err.message : String(err)
        errors.push({ nodeId: node.id, message: `invalid expression "${src}": ${message}` })
      }
    }
  }

  // 4. Dependency graph + reference validation + cycle detection.
  const deps = new Map<string, Set<string>>()
  for (const id of nodeIds) deps.set(id, new Set())

  for (const node of nodeById.values()) {
    const refs = walkRefs(node.in)
    if (node.if) {
      const ifRef = parseRef(node.if)
      if (ifRef) {
        refs.push(ifRef)
      } else if (looksLikeExpression(node.if)) {
        try {
          for (const ref of collectExprRefs(parseExpression(node.if))) {
            refs.push({ root: ref.root, path: ref.path, optional: false, raw: ref.raw })
          }
        } catch {
          // already reported by the expression-syntax-validation pass above
        }
      }
    }

    for (const ref of refs) {
      if (ref.root === 'inputs') {
        const key = ref.path[0]
        if (!key || !inputKeys.has(key)) {
          errors.push({
            nodeId: node.id,
            message: `unresolvable input reference "$inputs.${ref.path.join('.')}"`,
          })
        }
        continue
      }

      if (!nodeIds.has(ref.root)) {
        errors.push({ nodeId: node.id, message: `unresolvable node reference "$${ref.root}"` })
        continue
      }
      if (ref.root === node.id) {
        errors.push({ nodeId: node.id, message: `cycle detected involving node "${node.id}"` })
        continue
      }
      deps.get(node.id)!.add(ref.root)
    }

    for (const afterId of node.after ?? []) {
      if (!nodeIds.has(afterId)) {
        errors.push({ nodeId: node.id, message: `unresolvable node reference "${afterId}" in "after"` })
        continue
      }
      if (afterId === node.id) {
        errors.push({ nodeId: node.id, message: `cycle detected involving node "${node.id}"` })
        continue
      }
      deps.get(node.id)!.add(afterId)
    }
  }

  // Single Kahn's-algorithm pass serves both cycle detection and (on success) strata batching.
  const { strata: idStrata, cyclic } = kahnStrata(nodeIds, deps)
  for (const id of cyclic) {
    errors.push({ nodeId: id, message: `cycle detected involving node "${id}"` })
  }

  // 5. Outputs non-empty is already enforced by FlowDocumentSchema. Output-wiring validation
  //    is deliberately out of scope for this MVP pass.

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  // 6. Materialize strata as PlanNode batches.
  const strata: PlanNode[][] = idStrata.map((batch) =>
    batch.map((id) => {
      const node = nodeById.get(id)!
      const planNode: PlanNode = { id: node.id, type: node.type, in: node.in }
      if (node.if !== undefined) planNode.if = node.if
      return planNode
    }),
  )

  // 7. Content-addressed hash.
  const hash = await sha256Hex(JSON.stringify(canonicalize(validDoc)))

  // 8. Budgets with defaults.
  const budgets = {
    wallTimeMs: validDoc.policies?.budgets?.wallTimeMs ?? 4000,
    externalCalls: validDoc.policies?.budgets?.externalCalls ?? 10,
    rpcCalls: validDoc.policies?.budgets?.rpcCalls ?? 20,
  }

  return {
    ok: true,
    plan: {
      hash,
      meta: validDoc.meta,
      inputs: validDoc.inputs,
      outputs: validDoc.outputs,
      strata,
      budgets,
    },
  }
}
