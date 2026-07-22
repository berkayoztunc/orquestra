/**
 * `solana.system_transfer@1` and `solana.sync_native@1` — narrow, well-known-wire-format
 * instruction builders for the two native-program operations flows most commonly need
 * and have no IDL to build against: moving lamports via the System Program, and
 * refreshing a wrapped-SOL token account's balance after such a transfer.
 *
 * Deliberately NOT a generic "raw instruction" escape hatch (arbitrary program + accounts
 * + bytes) — that would reintroduce the exact unsafe, unauditable construction the rest of
 * this engine avoids by requiring an IDL. These two node types hardcode a single, fixed,
 * public wire format each (Solana's System and SPL Token program layouts are stable,
 * documented, part of the base protocol) and take only the handful of typed fields each
 * instruction actually needs.
 */

import { PublicKey, SystemProgram } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import type { FlowInstruction, NodeImplementation } from '../types'
import { registerNode } from '../node-registry'

// ────────────────────────────────────────────────────────
// solana.system_transfer@1
// ────────────────────────────────────────────────────────

export interface SystemTransferInput {
  from: string
  to: string
  lamports: string | number
}

export interface SystemTransferOutput {
  instruction: FlowInstruction
}

export const systemTransferNode: NodeImplementation<SystemTransferInput, SystemTransferOutput> = {
  type: 'solana.system_transfer',
  major: 1,
  effect: 'pure',
  async run(input: SystemTransferInput): Promise<SystemTransferOutput> {
    const from = new PublicKey(input.from)
    const to = new PublicKey(input.to)
    const lamports = BigInt(input.lamports)
    const ix = SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports })
    return {
      instruction: {
        programId: ix.programId.toBase58(),
        keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
        data: Buffer.from(ix.data).toString('base64'),
      },
    }
  },
}

registerNode(systemTransferNode as unknown as NodeImplementation)

// ────────────────────────────────────────────────────────
// solana.sync_native@1
// ────────────────────────────────────────────────────────

export interface SyncNativeInput {
  account: string
  /** Token program owning the wrapped-SOL account — defaults to the legacy SPL Token
   *  program (the common case: the native mint `So111...112`). Pass the Token-2022
   *  program id only if syncing a Token-2022 native-mint account. */
  tokenProgram?: string
}

export interface SyncNativeOutput {
  instruction: FlowInstruction
}

const SYNC_NATIVE_DISCRIMINATOR = 17 // SPL Token `SyncNative` instruction index — single byte, no args, stable across SPL Token and Token-2022.

export const syncNativeNode: NodeImplementation<SyncNativeInput, SyncNativeOutput> = {
  type: 'solana.sync_native',
  major: 1,
  effect: 'pure',
  async run(input: SyncNativeInput): Promise<SyncNativeOutput> {
    const account = new PublicKey(input.account)
    const tokenProgram = input.tokenProgram ? new PublicKey(input.tokenProgram) : TOKEN_PROGRAM_ID
    return {
      instruction: {
        programId: tokenProgram.toBase58(),
        keys: [{ pubkey: account.toBase58(), isSigner: false, isWritable: true }],
        data: Buffer.from([SYNC_NATIVE_DISCRIMINATOR]).toString('base64'),
      },
    }
  },
}

registerNode(syncNativeNode as unknown as NodeImplementation)
