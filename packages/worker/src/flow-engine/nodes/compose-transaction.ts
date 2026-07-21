/**
 * `solana.compose_transaction@1` — composes a list of instructions (typically
 * a mix of required and optionally-dropped `?`-ref instructions, e.g. an ATA
 * creation instruction that's only present when the ATA doesn't exist yet)
 * into one or more unsigned v0 transactions. Almost always one — it only
 * splits into more when the instructions don't fit a single 1232-byte packet.
 * Thin wrapper over `services/tx-builder.ts`'s `composeTransaction()`, which
 * owns the actual packing/splitting logic.
 */

import { composeTransaction, type ComposeTransactionResponse } from '../../services/tx-builder'
import type { FlowInstruction, NodeContext, NodeImplementation } from '../types'
import { registerNode } from '../node-registry'

export interface ComposeTransactionNodeInput {
  feePayer: string
  instructions: FlowInstruction[]
  simulate?: boolean
  /** Addresses of EXISTING lookup tables to compile against — see composeTransaction()'s doc comment. */
  lookupTableAddresses?: string[]
  useALT?: boolean
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
    })
  },
}

registerNode(composeTransactionNode as unknown as NodeImplementation)
