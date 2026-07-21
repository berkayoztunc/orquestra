/**
 * `resolve.constant@1` — looks up a protocol-scoped constant from the
 * `protocol_descriptors` D1 table (created by a separate migration; not
 * present in this file's history — assumed to exist per the flow-engine spec).
 *
 * Classified `pure` rather than `read` for MVP purposes: a D1 point lookup is a
 * cheap, deterministic dependency and not worth the ceremony of the `read`
 * effect class (which is reserved for RPC/network-style reads).
 */

import type { NodeContext, NodeImplementation } from '../types'
import { registerNode } from '../node-registry'

export interface ResolveConstantInput {
  protocol: string
  key: string
}

export interface ResolveConstantOutput {
  value: unknown
}

interface ProtocolDescriptorRow {
  descriptor_json: string
}

export const resolveConstantNode: NodeImplementation<ResolveConstantInput, ResolveConstantOutput> = {
  type: 'resolve.constant',
  major: 1,
  effect: 'pure',
  async run(input: ResolveConstantInput, ctx: NodeContext): Promise<ResolveConstantOutput> {
    const row = await ctx.db
      .prepare(
        'SELECT descriptor_json FROM protocol_descriptors WHERE protocol = ? ORDER BY version DESC LIMIT 1',
      )
      .bind(input.protocol)
      .first<ProtocolDescriptorRow>()

    if (!row) {
      return { value: null }
    }

    const parsed = JSON.parse(row.descriptor_json) as Record<string, unknown>
    return { value: parsed[input.key] ?? null }
  },
}

registerNode(resolveConstantNode as unknown as NodeImplementation)
