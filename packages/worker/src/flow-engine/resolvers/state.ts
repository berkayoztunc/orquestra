/**
 * `resolve.pda_state@1` — checks whether an account exists on-chain and reports its
 * lamports balance. MVP simplification: `decoded` is always `null`; IDL-based account
 * decoding (via `services/account-parser.ts`'s `detectAccountType`/`deserializeAccountData`)
 * is deferred to a follow-up — this node only needs existence + lamports for now.
 */

import { fetchAccountInfo } from '../../utils/solana-rpc'
import type { NodeContext, NodeImplementation } from '../types'
import { registerNode } from '../node-registry'

export interface ResolvePdaStateInput {
  address: string
}

export interface ResolvePdaStateOutput {
  exists: boolean
  decoded: unknown | null
  lamports: number | null
}

export const resolvePdaStateNode: NodeImplementation<ResolvePdaStateInput, ResolvePdaStateOutput> = {
  type: 'resolve.pda_state',
  major: 1,
  effect: 'read',
  async run(input: ResolvePdaStateInput, ctx: NodeContext): Promise<ResolvePdaStateOutput> {
    const accountInfo = await fetchAccountInfo(input.address, ctx.rpcUrl)

    return {
      exists: accountInfo !== null,
      decoded: null,
      lamports: accountInfo?.lamports ?? null,
    }
  },
}

registerNode(resolvePdaStateNode as unknown as NodeImplementation)
