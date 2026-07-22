/**
 * `resolve.account_data@1` — decodes a single already-known account address using the
 * project's registered IDL. Fills the gap between `resolve.pda_state@1` (existence +
 * lamports only, never decodes) and `resolve.accounts_by_filter@1` (decodes, but only
 * works when the account can be found via a program-wide scan + memcmp filter —
 * impossible for account types that have a dynamic-length field, e.g. a `Vec<T>`, before
 * the field a caller needs, since Solana's memcmp filter needs one fixed byte offset
 * shared across every scanned account). When the address is already known (e.g. a
 * deterministic PDA derived by `resolve.pda@1`), this decodes it directly — no scan, no
 * offset inference needed. RPC read.
 */

import { fetchProjectIdl } from '../../services/idl-registry'
import { fetchAndDecodeAccount } from '../../services/program-accounts'
import type { NodeContext, NodeImplementation } from '../types'
import { registerNode } from '../node-registry'

export interface ResolveAccountDataInput {
  address: string
  projectId: string
  accountType?: string
}

export interface ResolveAccountDataOutput {
  exists: boolean
  accountType: string | null
  data: Record<string, unknown> | null
}

export const resolveAccountDataNode: NodeImplementation<ResolveAccountDataInput, ResolveAccountDataOutput> = {
  type: 'resolve.account_data',
  major: 1,
  effect: 'read',
  async run(input: ResolveAccountDataInput, ctx: NodeContext): Promise<ResolveAccountDataOutput> {
    const project = await fetchProjectIdl(input.projectId, { DB: ctx.db, IDLS: ctx.idls })
    if (!project) {
      throw new Error(`resolve.account_data@1: project "${input.projectId}" not found or has no IDL`)
    }

    const result = await fetchAndDecodeAccount({
      idl: project.idl,
      address: input.address,
      rpcUrl: ctx.rpcUrl,
      accountType: input.accountType,
    })

    return { exists: result.exists, accountType: result.accountType, data: result.data }
  },
}

registerNode(resolveAccountDataNode as unknown as NodeImplementation)
