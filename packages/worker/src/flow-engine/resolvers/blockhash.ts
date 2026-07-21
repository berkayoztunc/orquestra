/**
 * `resolve.blockhash@1` — fetches the latest blockhash for transaction assembly.
 * MVP: no caching. A follow-up could add a short-TTL `ctx.cache` (KV) layer to
 * reduce redundant RPC calls across nodes in the same flow run.
 */

import { Connection } from '@solana/web3.js'
import type { NodeContext, NodeImplementation } from '../types'
import { registerNode } from '../node-registry'

export type ResolveBlockhashInput = Record<string, never>

export interface ResolveBlockhashOutput {
  blockhash: string
  lastValidBlockHeight: number
}

export const resolveBlockhashNode: NodeImplementation<ResolveBlockhashInput, ResolveBlockhashOutput> = {
  type: 'resolve.blockhash',
  major: 1,
  effect: 'read',
  async run(_input: ResolveBlockhashInput, ctx: NodeContext): Promise<ResolveBlockhashOutput> {
    const connection = new Connection(ctx.rpcUrl)
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
    return { blockhash, lastValidBlockHeight }
  },
}

registerNode(resolveBlockhashNode)
