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
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token'
import type { FlowInstruction, NodeContext, NodeImplementation } from '../types'
import { registerNode } from '../node-registry'

// ────────────────────────────────────────────────────────
// resolve.pda@1
// ────────────────────────────────────────────────────────

type IntSeedKind = 'u8' | 'u16' | 'u32' | 'u64' | 'u128' | 'i8' | 'i16' | 'i32' | 'i64' | 'i128'

export type PdaSeedEntry =
  | string
  | { kind: 'pubkey' | 'string' | 'bytes' | IntSeedKind; value: string }

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

// Byte width per numeric seed kind. Little-endian encoding, same convention
// Anchor/Codama seed schemas use for numeric seed components (matches
// `encodeSeedValue` in `services/pda.ts`, which this file otherwise
// deliberately avoids importing — see the header comment above).
const INT_SEED_SIZES: Record<IntSeedKind, number> = {
  u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, u64: 8, i64: 8, u128: 16, i128: 16,
}

function encodeIntSeed(value: string, size: number): Uint8Array {
  const v = BigInt(value)
  const buf = new Uint8Array(size)
  for (let i = 0; i < size; i++) buf[i] = Number((v >> BigInt(i * 8)) & 0xffn)
  return buf
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
    case 'u8':
    case 'u16':
    case 'u32':
    case 'u64':
    case 'u128':
    case 'i8':
    case 'i16':
    case 'i32':
    case 'i64':
    case 'i128':
      return encodeIntSeed(entry.value, INT_SEED_SIZES[entry.kind])
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
  /** Token program that owns `mint`. Optional — if omitted, auto-detected from
   *  the mint account's own on-chain owner (legacy SPL Token vs Token-2022),
   *  the same "token interface" pattern many programs support per-mint. Pass
   *  this explicitly only to override auto-detection or to skip the extra
   *  RPC read when the token program is already known. */
  tokenProgram?: string
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
    const connection = new Connection(ctx.rpcUrl)

    let tokenProgram: PublicKey
    if (input.tokenProgram) {
      tokenProgram = new PublicKey(input.tokenProgram)
    } else {
      // Auto-detect which token program owns this mint (legacy SPL Token vs
      // Token-2022) from the mint account's own on-chain owner, instead of
      // requiring the caller to know/pass it — this is exactly the
      // "either program, per-mint" interface many programs already support.
      // Falls back to legacy Token program if the mint account can't be
      // fetched (e.g. it doesn't exist yet), matching prior behavior.
      const mintInfo = await connection.getAccountInfo(mint)
      tokenProgram = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
    }

    // allowOwnerOffCurve: true — `owner` is frequently a PDA (a fee-recipient
    // vault, a program-owned vault authority, etc.), which is always off the
    // ed25519 curve by construction. The spl-token default (false) exists to
    // catch a genuine wallet typo, but it also blocks every legitimate
    // PDA-owned ATA — a very common real-world pattern this resolver needs
    // to support.
    const ata = await getAssociatedTokenAddress(mint, owner, true, tokenProgram)

    const accountInfo = await connection.getAccountInfo(ata)

    if (accountInfo !== null) {
      return { address: ata.toBase58(), exists: true, createIx: null }
    }

    // MVP: `owner` also acts as the fee payer. A real flow would take a dedicated
    // fee-payer input — out of scope here.
    const ix = createAssociatedTokenAccountInstruction(owner, ata, owner, mint, tokenProgram)
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
