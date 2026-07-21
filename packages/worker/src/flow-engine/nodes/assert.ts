/**
 * `logic.assert@1` — throws if `condition` is falsy, otherwise returns `{ ok: true }`.
 *
 * Note: per the FDL spec, the interpreter resolves any `$ref` inside `condition` to a
 * plain boolean before calling this node — this node does no reference resolution
 * itself, it only evaluates the already-resolved boolean.
 */

import type { NodeImplementation } from '../types'
import { registerNode } from '../node-registry'

export interface LogicAssertInput {
  condition: boolean
  message?: string
}

export interface LogicAssertOutput {
  ok: true
}

export const logicAssertNode: NodeImplementation<LogicAssertInput, LogicAssertOutput> = {
  type: 'logic.assert',
  major: 1,
  effect: 'pure',
  async run(input: LogicAssertInput): Promise<LogicAssertOutput> {
    if (!input.condition) {
      throw new Error(input.message ?? 'assertion failed')
    }
    return { ok: true }
  },
}

registerNode(logicAssertNode as unknown as NodeImplementation)
