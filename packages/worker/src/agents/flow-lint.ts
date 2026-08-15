/**
 * Reference lint for draft FDL documents.
 *
 * The compiler validates that a `$ref`'s *root* exists — the node id or input
 * key — but not that the *field* exists on that node's output. So a typo or an
 * invented field (`$myAta.addres`, `$pda.pubkey`) compiles cleanly and then
 * resolves to `undefined` at run time, where it surfaces as an opaque crash
 * inside whichever node consumed it. A real production run died exactly this
 * way: `agentAtaA: Cannot read properties of undefined (reading '_bn')` — a
 * `resolve.ata@1` node handed an undefined owner/mint.
 *
 * This turns that runtime crash into a precise, fixable compile-time message,
 * using the same NODE_CATALOG the node registry is already checked against.
 */

import { NODE_CATALOG } from '../flow-engine/schema-docs'
import { walkRefs, type FlowDocument } from '../flow-engine/fdl-schema'

/**
 * Extract the top-level field names from a catalog `output` description like
 * `'{ address: pubkey, exists: boolean, createIx: FlowInstruction | null }'`.
 * Only depth-1 keys count — nested object/array/parenthetical shapes are
 * deliberately ignored, since only the first path segment is checked.
 */
export function parseOutputFields(output: string): Set<string> {
  const fields = new Set<string>()
  const start = output.indexOf('{')
  if (start === -1) return fields

  let brace = 0
  let paren = 0
  let bracket = 0
  let token = ''

  for (let i = start; i < output.length; i++) {
    const ch = output[i]
    if (ch === '{') { brace++; token = ''; continue }
    if (ch === '}') { brace--; token = ''; continue }
    if (ch === '(') { paren++; token = ''; continue }
    if (ch === ')') { paren--; token = ''; continue }
    if (ch === '[') { bracket++; token = ''; continue }
    if (ch === ']') { bracket--; token = ''; continue }

    if (brace === 1 && paren === 0 && bracket === 0) {
      if (/[A-Za-z0-9_]/.test(ch)) { token += ch; continue }
      if (ch === ':' && token) { fields.add(token); token = ''; continue }
      // `?` in `simulation?:` keeps the token; anything else resets it
      if (ch !== '?') token = ''
      continue
    }
    token = ''
  }
  return fields
}

/** `${type}@${major}` → known top-level output field names. */
const OUTPUT_FIELDS: Map<string, Set<string>> = new Map(
  NODE_CATALOG.map((entry) => [entry.key, parseOutputFields(entry.output)] as const),
)

export interface RefLintError {
  nodeId: string
  message: string
}

/**
 * Report every `$ref` that points at a field the producing node does not emit.
 * Only flags refs whose producing node type is in the catalog AND whose output
 * shape parsed into at least one field — an unparseable shape is skipped rather
 * than guessed at, so this can never block a valid flow on a parser miss.
 */
export function lintReferences(doc: FlowDocument): RefLintError[] {
  const typeById = new Map(doc.nodes.map((n) => [n.id, n.type]))
  const errors: RefLintError[] = []

  for (const node of doc.nodes) {
    for (const ref of walkRefs(node.in)) {
      if (ref.root === 'inputs' || ref.path.length === 0) continue

      const producerType = typeById.get(ref.root)
      if (!producerType) continue // the compiler already reports unknown roots

      const known = OUTPUT_FIELDS.get(producerType)
      if (!known || known.size === 0) continue

      const field = ref.path[0]
      if (!known.has(field)) {
        errors.push({
          nodeId: node.id,
          message:
            `references "$${ref.root}.${ref.path.join('.')}" but node "${ref.root}" ` +
            `(${producerType}) outputs only: ${[...known].join(', ')}. ` +
            `This would resolve to undefined at run time.`,
        })
      }
    }
  }
  return errors
}
