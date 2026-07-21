/**
 * Flow Definition Language (FDL) — zod schema + reference grammar.
 *
 * MVP subset of the full design (see docs/flow-engine-design.md §6): no
 * `policies.pricing`, no `flow.call@1` composition, no `map.over@1` fan-out.
 * Static nodes and static references, PLUS a minimal expression grammar
 * (comparisons/boolean/arithmetic over `$ref`s — see expression.ts) for `if`
 * guards and any `in` field that needs a computed value rather than a raw
 * passthrough.
 *
 * ---------------------------------------------------------------------------
 * Reference grammar
 * ---------------------------------------------------------------------------
 * Any string value found inside a node's `in` object (at any nesting depth —
 * directly, or inside arrays/objects nested within `in`), or a node's `if`
 * field, may be a *reference* or an *expression* rather than a literal:
 *
 *   - `$inputs.<key>`      references a declared flow input.
 *   - `$<nodeId>.<path>`   references another node's output field. `<path>` is
 *                          dot-separated and may address nested fields
 *                          (`$node.a.b`) or array indices written as plain
 *                          integers (`$node.items.0`). No bracket syntax, no
 *                          computed indices.
 *   - A trailing `?` (e.g. `$dstAta.createIx?`) marks a BARE reference
 *     *optional*: if it resolves to `null`/`undefined` (because the producing
 *     node was skipped via `if`, or the field is legitimately null), the
 *     interpreter must not error.
 *       - If the optional ref is the *entire* value of an `in` field, the
 *         resolved value becomes `null`.
 *       - If the optional ref is one entry inside an array-typed `in` field,
 *         that array entry is DROPPED entirely (not replaced with `null`).
 *         This is the "append the create-ATA instruction only if missing"
 *         idiom: `"instructions": ["$srcAta.createIx?", "$dstAta.createIx?", "$swapIx.instruction"]`.
 *   - A string containing a `$ref` PLUS an operator (`>`, `<`, `>=`, `<=`,
 *     `==`, `!=`, `&&`, `||`, `!`, `+`, `-`, `*`, `/`, parens) — e.g.
 *     `"$quote.outAmount > 0"` — is an EXPRESSION (see expression.ts),
 *     evaluated to a primitive (string/number/boolean/null). Expressions have
 *     no `?`-optional form: an undefined ref inside one is always an error.
 *   - A bare `$ref` with no operator ALWAYS returns the raw resolved value
 *     unmodified — including whole objects/arrays (e.g. `$buildIx.instruction`
 *     returning a FlowInstruction). Only strings that actually contain an
 *     operator are parsed as expressions; this is what keeps every existing
 *     bare-ref idiom (including `?`-optional/array-drop) working unchanged.
 *   - Any value with no `$` at all is a literal constant, used as-is.
 *
 * A node's `if` field must be a single BARE reference (no `?`) OR an
 * expression, evaluating to a boolean output field. It is resolved before the
 * node's `in` is materialized; a falsy (or unresolvable) value skips the node.
 *
 * This file only defines the grammar and a parser for it (`parseRef`,
 * `isRefString`, `walkRefs`). Actual *resolution* against run state
 * (inputs / nodeOutputs / skipped set) is the interpreter's job — see
 * interpreter.ts. Expression parsing/evaluation itself lives in expression.ts.
 */

import { z } from 'zod'
import { looksLikeExpression, parseExpression, collectExprRefs } from './expression'

// ---------------------------------------------------------------------------
// Reference parsing
// ---------------------------------------------------------------------------

/** A parsed `$...` reference string. */
export interface ParsedRef {
  /** `"inputs"` for `$inputs.x`, otherwise the referenced node id. */
  root: string
  /** Dot-separated path segments after the root (may be empty). */
  path: string[]
  /** True if the reference carried a trailing `?`. */
  optional: boolean
  /** The raw reference string, `?` suffix stripped. */
  raw: string
}

const REF_RE = /^\$([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z0-9_]+)*)(\?)?$/

/** True if `value` is a string that starts with `$` (i.e. looks like a reference). */
export function isRefString(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('$')
}

/**
 * Parse a `$...` reference string. Returns `null` if `value` is not a
 * syntactically valid reference (callers should treat that as a hard error
 * for strings starting with `$`, since it means malformed FDL).
 */
export function parseRef(value: string): ParsedRef | null {
  const m = REF_RE.exec(value)
  if (!m) return null
  const [, root, pathStr, q] = m
  const path = pathStr.length > 0 ? pathStr.slice(1).split('.') : []
  return { root, path, optional: q === '?', raw: `$${root}${pathStr}` }
}

/** A bare (non-optional) ref pattern, used to validate `if` fields. */
export const BARE_REF_PATTERN = /^\$[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/

/**
 * Recursively walk a JSON-like value (as found in a node's `in` object) and
 * collect every reference found, at any nesting depth — including refs
 * embedded inside expression strings (e.g. `"$quote.outAmount > 0"` yields a
 * ref for `$quote.outAmount`), so the compiler's dependency graph sees them
 * for cycle detection and "unresolvable reference" checks. Malformed
 * expressions are silently skipped here (the compiler's expression-validation
 * pass reports those as a proper CompileError with a clear message instead).
 */
export function walkRefs(value: unknown): ParsedRef[] {
  const out: ParsedRef[] = []
  const visit = (v: unknown): void => {
    if (isRefString(v)) {
      const parsed = parseRef(v)
      if (parsed) {
        out.push(parsed)
        return
      }
      if (looksLikeExpression(v)) {
        try {
          for (const ref of collectExprRefs(parseExpression(v))) {
            out.push({ root: ref.root, path: ref.path, optional: false, raw: ref.raw })
          }
        } catch {
          // malformed expression — reported separately by the compiler
        }
      }
      return
    }
    if (Array.isArray(v)) {
      for (const item of v) visit(item)
      return
    }
    if (v !== null && typeof v === 'object') {
      for (const key of Object.keys(v as Record<string, unknown>)) {
        visit((v as Record<string, unknown>)[key])
      }
    }
  }
  visit(value)
  return out
}

/**
 * Recursively walk a JSON-like value and collect every string that
 * `looksLikeExpression` matches, at any nesting depth — used by the compiler
 * to validate every expression's syntax at compile time (rather than only
 * discovering a malformed expression when a run happens to hit it).
 */
export function collectExpressionStrings(value: unknown): string[] {
  const out: string[] = []
  const visit = (v: unknown): void => {
    if (typeof v === 'string') {
      if (looksLikeExpression(v)) out.push(v)
      return
    }
    if (Array.isArray(v)) {
      for (const item of v) visit(item)
      return
    }
    if (v !== null && typeof v === 'object') {
      for (const key of Object.keys(v as Record<string, unknown>)) {
        visit((v as Record<string, unknown>)[key])
      }
    }
  }
  visit(value)
  return out
}

/** True if `value` is a syntactically valid expression string (has $refs + operators, parses cleanly). */
export function isValidExpressionString(value: string): boolean {
  try {
    parseExpression(value)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Generic JSON value schema (used for `in` field values: literal or ref)
// ---------------------------------------------------------------------------

export type FdlValue = string | number | boolean | null | FdlValue[] | { [key: string]: FdlValue }

const FdlValueSchema: z.ZodType<FdlValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(FdlValueSchema),
    z.record(z.string(), FdlValueSchema),
  ]),
)

// ---------------------------------------------------------------------------
// meta
// ---------------------------------------------------------------------------

const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const FlowMetaSchema = z.object({
  slug: z.string().regex(KEBAB_CASE_RE, 'meta.slug must be kebab-case'),
  name: z.string().min(1),
  /** Short human-readable summary (one or two sentences) — the catalog UI's card description. Optional; author it when publishing so the flow reads as more than just a name. */
  description: z.string().optional(),
  intent: z.string().min(1),
  protocol: z.string().optional(),
  programs: z.array(z.string()).optional(),
  networks: z.array(z.string()).optional(),
})
export type FlowMeta = z.infer<typeof FlowMetaSchema>

// ---------------------------------------------------------------------------
// inputs / outputs
// ---------------------------------------------------------------------------

export const FLOW_INPUT_TYPES = ['pubkey', 'u64', 'u32', 'u16', 'u8', 'string', 'bool', 'bps'] as const
export const FlowInputTypeSchema = z.enum(FLOW_INPUT_TYPES)
export type FlowInputType = z.infer<typeof FlowInputTypeSchema>

export const FlowInputSpecSchema = z
  .object({
    type: FlowInputTypeSchema,
    description: z.string().optional(),
    default: FdlValueSchema.optional(),
  })
  .passthrough()
export type FlowInputSpec = z.infer<typeof FlowInputSpecSchema>

export const FLOW_OUTPUT_TYPES = ['transaction', 'transaction[]', 'json', 'u64', 'string', 'bool'] as const
export const FlowOutputTypeSchema = z.enum(FLOW_OUTPUT_TYPES)
export type FlowOutputType = z.infer<typeof FlowOutputTypeSchema>

export const FlowOutputSpecSchema = z
  .object({
    type: FlowOutputTypeSchema,
    description: z.string().optional(),
  })
  .passthrough()
export type FlowOutputSpec = z.infer<typeof FlowOutputSpecSchema>

// ---------------------------------------------------------------------------
// nodes
// ---------------------------------------------------------------------------

const NODE_ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
/** `<type>@<major>`, e.g. "resolve.pda@1". Major must be a positive integer with no leading zero. */
const NODE_TYPE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*@(0|[1-9][0-9]*)$/

export const FlowNodeSchema = z.object({
  id: z.string().regex(NODE_ID_RE, 'node.id must be a valid identifier'),
  type: z.string().regex(NODE_TYPE_RE, 'node.type must match "<type>@<major>", e.g. "resolve.pda@1"'),
  in: z.record(z.string(), FdlValueSchema).default({}),
  if: z
    .string()
    .refine((v) => BARE_REF_PATTERN.test(v) || looksLikeExpression(v), {
      message: 'node.if must be a bare $ref (no "?" suffix) or an expression, e.g. "$quote.outAmount > 0"',
    })
    .optional(),
  after: z.array(z.string()).optional(),
})
export type FlowNode = z.infer<typeof FlowNodeSchema>

// ---------------------------------------------------------------------------
// policies
// ---------------------------------------------------------------------------

export const FlowBudgetsSchema = z.object({
  wallTimeMs: z.number().positive().optional(),
  externalCalls: z.number().int().nonnegative().optional(),
  rpcCalls: z.number().int().nonnegative().optional(),
})
export type FlowBudgets = z.infer<typeof FlowBudgetsSchema>

export const FlowPoliciesSchema = z.object({
  budgets: FlowBudgetsSchema.optional(),
})
export type FlowPolicies = z.infer<typeof FlowPoliciesSchema>

// ---------------------------------------------------------------------------
// document
// ---------------------------------------------------------------------------

export const FlowDocumentSchema = z.object({
  fdl: z.literal('1.0'),
  meta: FlowMetaSchema,
  inputs: z.record(z.string(), FlowInputSpecSchema).default({}),
  outputs: z.record(z.string(), FlowOutputSpecSchema).refine((o) => Object.keys(o).length > 0, {
    message: 'outputs must be a non-empty object',
  }),
  nodes: z.array(FlowNodeSchema).min(1, 'nodes must contain at least one node'),
  policies: FlowPoliciesSchema.optional(),
})

export type FlowDocument = z.infer<typeof FlowDocumentSchema>
