/**
 * PDA / ATA resolver nodes.
 *
 * `resolve.pda@1` derives a PDA from a raw list of seeds against a program ID.
 * This is intentionally NOT routed through `services/pda.ts`'s `derivePda`/`deriveCodamaPda`
 * helpers — those operate on IDL account/instruction names and resolve seed values by
 * looking them up against an `AnchorIDL`/`CodamaIDL` + on-chain account fields. The flow
 * engine's `resolve.pda@1` node instead receives fully-resolved raw seed values directly
 * (string / pubkey / bytes) with no IDL in scope, so `PublicKey.findProgramAddressSync`
 * from `@solana/web3.js` is the more direct fit.
 *
 * `resolve.ata@1` derives an SPL associated-token-account address and, if it doesn't
 * exist on-chain yet, builds the creation instruction (using `owner` as payer for MVP).
 */

import { Connection, PublicKey } from '@solana/web3.js'
import { createAssociatedTokenAccountInstruction, getAssociatedTokenAddress } from '@solana/spl-token'
import type { FlowInstruction, NodeContext, NodeImplementation } from '../types'
import { registerNode } from '../node-registry'

// ────────────────────────────────────────────────────────
// resolve.pda@1
// ────────────────────────────────────────────────────────

export type PdaSeedEntry =
  | string
  | { kind: 'pubkey' | 'string' | 'bytes'; value: string }

export interface ResolvePdaInput {
  program: string
  seeds: PdaSeedEntry[]
}

export interface ResolvePdaOutput {
  address: string
  bump: number
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

function encodeSeedEntry(entry: PdaSeedEntry): Uint8Array {
  if (typeof entry === 'string') {
    return new TextEncoder().encode(entry)
  }
  switch (entry.kind) {
    case 'pubkey':
      return new PublicKey(entry.value).toBytes()
    case 'string':
      return new TextEncoder().encode(entry.value)
    case 'bytes':
      return base64ToBytes(entry.value)
    default: {
      const exhaustive: never = entry.kind
      throw new Error(`resolve.pda@1: unknown seed kind "${exhaustive as string}"`)
    }
  }
}

export const resolvePdaNode: NodeImplementation<ResolvePdaInput, ResolvePdaOutput> = {
  type: 'resolve.pda',
  major: 1,
  effect: 'pure',
  async run(input: ResolvePdaInput): Promise<ResolvePdaOutput> {
    const programId = new PublicKey(input.program)
    const seedBytes = input.seeds.map(encodeSeedEntry)
    const [pda, bump] = PublicKey.findProgramAddressSync(seedBytes, programId)
    return { address: pda.toBase58(), bump }
  },
}

registerNode(resolvePdaNode as unknown as NodeImplementation)

// ────────────────────────────────────────────────────────
// resolve.ata@1
// ────────────────────────────────────────────────────────

export interface ResolveAtaInput {
  owner: string
  mint: string
}

export interface ResolveAtaOutput {
  address: string
  exists: boolean
  createIx: FlowInstruction | null
}

export const resolveAtaNode: NodeImplementation<ResolveAtaInput, ResolveAtaOutput> = {
  type: 'resolve.ata',
  major: 1,
  effect: 'read',
  async run(input: ResolveAtaInput, ctx: NodeContext): Promise<ResolveAtaOutput> {
    const owner = new PublicKey(input.owner)
    const mint = new PublicKey(input.mint)
    const ata = await getAssociatedTokenAddress(mint, owner)

    const connection = new Connection(ctx.rpcUrl)
    const accountInfo = await connection.getAccountInfo(ata)

    if (accountInfo !== null) {
      return { address: ata.toBase58(), exists: true, createIx: null }
    }

    // MVP: `owner` also acts as the fee payer. A real flow would take a dedicated
    // fee-payer input — out of scope here.
    const ix = createAssociatedTokenAccountInstruction(owner, ata, owner, mint)
    const createIx: FlowInstruction = {
      programId: ix.programId.toBase58(),
      keys: ix.keys.map((k) => ({
        pubkey: k.pubkey.toBase58(),
        isSigner: k.isSigner,
        isWritable: k.isWritable,
      })),
      data: Buffer.from(ix.data).toString('base64'),
    }

    return { address: ata.toBase58(), exists: false, createIx }
  },
}

registerNode(resolveAtaNode as unknown as NodeImplementation)
