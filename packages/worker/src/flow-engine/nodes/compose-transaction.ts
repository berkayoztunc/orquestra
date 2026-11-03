/**
 * `solana.compose_transaction@1` — composes a list of instructions (typically
 * a mix of required and optionally-dropped `?`-ref instructions, e.g. an ATA
 * creation instruction that's only present when the ATA doesn't exist yet)
 * into one or more unsigned transactions (v0 by default; `txVersion` opts into
 * 'legacy' or 'v1'). Almost always one — it only splits into more when the
 * instructions don't fit a single packet (1232 bytes; 4096 for v1).
 * Thin wrapper over `services/tx-builder.ts`'s `composeTransaction()`, which
 * owns the actual packing/splitting logic.
 */

import { composeTransaction, type ComposeTransactionResponse } from '../../services/tx-builder'
import type { TxVersion, TxV1Config } from '../../services/tx-v1'
import type { FlowInstruction, NodeContext, NodeImplementation } from '../types'
import { registerNode } from '../node-registry'

export interface ComposeTransactionNodeInput {
  feePayer: string
  instructions: FlowInstruction[]
  simulate?: boolean
  /** Addresses of EXISTING lookup tables to compile against — see composeTransaction()'s doc comment. */
  lookupTableAddresses?: string[]
  useALT?: boolean
  /**
   * Opt-in transaction format: 'legacy' | 'v0' | 'v1'. Omitted → the run-level override
   * (NodeContext.txVersion) if any, else 'v0'. v1 = 4096-byte packets, max 64 inline accounts, no ALTs.
   */
  txVersion?: TxVersion
  /** v1 only: { priorityFeeLamports?, computeUnitLimit?, loadedAccountsDataSizeLimit?, heapSize? }. Unset limits are measured via simulation. */
  txConfig?: TxV1Config
}

export type ComposeTransactionNodeOutput = ComposeTransactionResponse

export const composeTransactionNode: NodeImplementation<ComposeTransactionNodeInput, ComposeTransactionNodeOutput> = {
  type: 'solana.compose_transaction',
  major: 1,
  effect: 'read', // simulates against RPC by default
  async run(input: ComposeTransactionNodeInput, ctx: NodeContext): Promise<ComposeTransactionNodeOutput> {
    return composeTransaction({
      feePayer: input.feePayer,
      instructions: input.instructions,
      rpcUrl: ctx.rpcUrl,
      simulate: input.simulate,
      lookupTableAddresses: input.lookupTableAddresses,
      useALT: input.useALT,
      // precedence: node input > run-level override > composeTransaction's default (v0)
      txVersion: input.txVersion ?? ctx.txVersion,
      txConfig: input.txConfig,
      txV1Disabled: ctx.txV1Disabled,
    })
  },
}

registerNode(composeTransactionNode as unknown as NodeImplementation)
