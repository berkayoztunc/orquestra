/**
 * `logic.find_in_array@1` — finds the element of `array` whose `field` matches `value`
 * (compared as strings, so numbers/booleans/pubkeys all just work) and optionally
 * extracts one field from it. Pure — no RPC.
 *
 * Fills a real gap in the `$ref`/expression grammar: dot-paths only address a fixed
 * index (`$node.items.0`), and expressions have no loops or computed indices — so a
 * flow has no way to pick "the array element whose name matches this input" on its
 * own. This is exactly what's needed after `resolve.accounts_by_filter@1` or
 * `resolve.account_data@1` returns a decoded account with a `Vec<T>` field (e.g. a
 * store's product list) and the flow needs one entry from it by name, not by a fixed
 * index that could point at the wrong product for a different caller.
 */

import type { NodeImplementation } from '../types'
import { registerNode } from '../node-registry'

export interface FindInArrayInput {
  array: unknown[]
  field: string
  value: string | number | boolean
  select?: string
}

export interface FindInArrayOutput {
  found: boolean
  index: number | null
  value: unknown | null
}

export const logicFindInArrayNode: NodeImplementation<FindInArrayInput, FindInArrayOutput> = {
  type: 'logic.find_in_array',
  major: 1,
  effect: 'pure',
  async run(input: FindInArrayInput): Promise<FindInArrayOutput> {
    const array = Array.isArray(input.array) ? input.array : []
    const target = String(input.value)

    const index = array.findIndex((item) => {
      if (item == null || typeof item !== 'object') return false
      const fieldValue = (item as Record<string, unknown>)[input.field]
      return fieldValue !== undefined && String(fieldValue) === target
    })

    if (index === -1) {
      return { found: false, index: null, value: null }
    }

    const item = array[index] as Record<string, unknown>
    const value = input.select ? item[input.select] ?? null : item

    return { found: true, index, value }
  },
}

registerNode(logicFindInArrayNode as unknown as NodeImplementation)
