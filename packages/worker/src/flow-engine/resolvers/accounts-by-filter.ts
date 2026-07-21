/**
 * `resolve.accounts_by_filter@1` — discovers program-owned accounts by
 * dataSize/memcmp/field filters instead of a hardcoded address. This is how a
 * flow finds a pool/market/reserve account it doesn't already know the
 * address of (e.g. "the pool for mint A + mint B") without any protocol-
 * specific code — same genericity story as `orquestra.build_instruction@1`:
 * driven by `projectId` + filters, works for any program's IDL-decodable
 * account types. Thin wrapper over the existing `services/program-accounts.ts`
 * `queryProgramAccounts()` (the same function the `get_program_data` MCP tool
 * uses). RPC scan — classified `read`.
 */

import { fetchProjectIdl } from '../../services/idl-registry'
import { queryProgramAccounts } from '../../services/program-accounts'
import type { NodeContext, NodeImplementation } from '../types'
import { registerNode } from '../node-registry'

export interface ResolveAccountsByFilterInput {
  projectId: string
  accountType?: string
  dataSize?: number
  memcmp?: { offset: number; bytes: string }[]
  fieldFilters?: { field: string; bytes: string }[]
  limit?: number
}

export interface ResolveAccountsByFilterOutput {
  accounts: { address: string; data: Record<string, unknown> | null }[]
  count: number
}

function inferCluster(rpcUrl: string): 'mainnet-beta' | 'devnet' | 'testnet' {
  const lower = rpcUrl.toLowerCase()
  if (lower.includes('devnet')) return 'devnet'
  if (lower.includes('testnet')) return 'testnet'
  return 'mainnet-beta'
}

export const resolveAccountsByFilterNode: NodeImplementation<ResolveAccountsByFilterInput, ResolveAccountsByFilterOutput> = {
  type: 'resolve.accounts_by_filter',
  major: 1,
  effect: 'read',
  async run(input: ResolveAccountsByFilterInput, ctx: NodeContext): Promise<ResolveAccountsByFilterOutput> {
    const project = await fetchProjectIdl(input.projectId, { DB: ctx.db, IDLS: ctx.idls })
    if (!project) {
      throw new Error(`resolve.accounts_by_filter@1: project "${input.projectId}" not found or has no IDL`)
    }

    const result = await queryProgramAccounts({
      idl: project.idl,
      programId: project.programId,
      rpcUrl: ctx.rpcUrl,
      cluster: inferCluster(ctx.rpcUrl),
      input: {
        accountType: input.accountType,
        dataSize: input.dataSize,
        memcmp: input.memcmp,
        fieldFilters: input.fieldFilters,
        limit: input.limit,
      },
    })

    return {
      accounts: result.accounts.map((acc) => ({ address: acc.address, data: acc.data })),
      count: result.count,
    }
  },
}

registerNode(resolveAccountsByFilterNode as unknown as NodeImplementation)
