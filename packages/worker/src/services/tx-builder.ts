/**
 * Transaction Builder Service
 * Constructs Solana transactions from IDL instructions
 * Works in Cloudflare Workers environment (no Node.js dependencies)
 *
 * Wire format: responses use **legacy** Solana transactions (not v0 / versioned messages).
 * Deserialize with `@solana/web3.js` `Transaction.from(bytes)` after `bs58.decode(serializedTransaction)`.
 * `VersionedTransaction.deserialize` will not work on these bytes until a v0 builder exists.
 */

import type { AnchorIDL, AnchorInstruction, AnchorAccountMeta, AnchorType, AnchorError, CodamaIDL, CodamaTypeNode, CodamaInstructionArgument, CodamaValueNode } from './idl-parser'
import { getInstruction, resolveType, getDefinedTypeName, lookupType, normalizeAccountMeta, normalizeField, getIDLProgramName, detectIDLFormat, getCodamaInstruction, getCodamaDiscriminatorBytes, getCodamaUserArgs } from './idl-parser'
import type { ResolvedCluster } from '../utils/solana-rpc'
import { rpcFetch, RPC_TIMEOUTS } from '../utils/solana-rpc'
import { MemoCache } from '../utils/memo-cache'
import { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, Connection, type AddressLookupTableAccount } from '@solana/web3.js'
// Flow Engine (Orquestra Flow Engine / OFE) instruction shape — authored by the flow-engine
// module in a parallel workstream. Only the type is consumed here; composeTransaction() below
// is additive and does not touch the legacy single-instruction buildTransaction() path above.
import type { FlowInstruction } from '../flow-engine/types'

export type RiskLevel = 'low' | 'medium' | 'high'

export interface DecodedAnchorError {
  code: number
  name: string
  msg: string
}

export interface SimulationResult {
  success: boolean
  /** Compute units consumed during simulation, if returned by the RPC. */
  computeUnits: number | null
  logs: string[]
  err: unknown | null
  /** Set when err matched an Anchor error code via the IDL `errors[]` table. */
  decodedError: DecodedAnchorError | null
  /** Echoed for traceability — same shape as build_instruction. */
  build: BuildTransactionResponse
}

export interface RemainingAccount {
  pubkey: string
  isSigner?: boolean
  isWritable?: boolean
}

export interface BuildTransactionRequest {
  accounts: Record<string, string>  // account name -> public key (base58)
  args: Record<string, any>         // arg name -> value
  feePayer: string                  // base58 public key
  recentBlockhash?: string          // optional, will fetch if not provided
  network?: 'mainnet-beta' | 'devnet' | 'testnet'
  /** When true, runs JSON-RPC simulateTransaction on the same RPC (unsigned wire bytes). No wallet required. */
  simulate?: boolean
  /** Encoding for serializedTransaction in the response. Defaults to 'base58'. Use 'base64' for the modern Solana standard. */
  encoding?: 'base58' | 'base64'
  /**
   * Extra account metas appended after the IDL's named accounts, in the order given —
   * Anchor's `remaining_accounts` mechanism. Some instructions read a caller-chosen,
   * variable-length tail of accounts (e.g. a whitelist entry, a dynamic fee recipient)
   * that the IDL cannot name individually. Not validated against the IDL (there is
   * nothing to validate against); the caller is responsible for supplying the right
   * accounts in the right order for whatever remaining_accounts logic the program expects.
   */
  remainingAccounts?: RemainingAccount[]
}

export interface BuildTransactionResponse {
  transaction: string               // serialized transaction message (encoding matches the request; default base58)
  serializedTransaction: string     // Solana legacy wire transaction (encoding matches the request; default base58)
  /** Encoding used for transaction and serializedTransaction fields. */
  encoding: 'base58' | 'base64'
  message: string                   // human-readable description
  accounts: AccountInfo[]           // account details used
  instruction: InstructionInfo      // instruction info
  estimatedFee: number              // estimated fee in lamports
  /** Normalized cluster used for RPC (blockhash / simulate). */
  network: ResolvedCluster
  /** RPC hostname only (no path/query — avoids leaking API keys in logs). */
  rpcUrlHost: string
  /** Blockhash embedded in the serialized transaction. */
  recentBlockhash: string
  /** Present when the server fetched the blockhash via getLatestBlockhash. */
  lastValidBlockHeight?: number
  blockhashSource: 'client' | 'rpc'
  /**
   * Wire format: legacy Solana message (not versioned / v0).
   * Consumers that only call VersionedTransaction.deserialize should try legacy Transaction.from after failure.
   */
  wireFormat: 'legacy'
  /** Set when `simulate: true` was requested. Null err means simulation succeeded at RPC preflight. */
  simulationError: unknown | null
  simulationLogs: string[] | null
  /**
   * Heuristic risk assessment for the instruction. `high` when a writable signer is mutated
   * or when the instruction touches transfer-shaped fields. Used by signer flows for the
   * approval summary required by SKILLS.md.
   */
  riskLevel: RiskLevel
  /** Reasons the heuristic produced its riskLevel. Useful for showing the user "why". */
  riskReasons: string[]
  /** Anchor `errors[]` decoded from preflight simulation logs, when applicable. */
  decodedError: DecodedAnchorError | null
}

export interface AccountInfo {
  name: string
  pubkey: string
  isSigner: boolean
  isWritable: boolean
}

export interface InstructionInfo {
  name: string
  programId: string
  data: string                      // hex-encoded instruction data
  accounts: AccountInfo[]
}

// Anchor instruction discriminator: first 8 bytes of SHA-256("global:<instruction_name>")
// Also supports custom formats:
//   - number[] of any length (e.g. 1-byte programs that use a u8 discriminator)
//   - { type: "u8" | "u16" | "u32", value: number | number[] } object format
function getExplicitInstructionDiscriminator(instruction: AnchorInstruction): Uint8Array | null {
  const disc = instruction.discriminator as any
  if (!disc) return null

  // Object format: { type: "u8", value: 6 } or { type: "u16", value: 300 } or { type: "u8", value: [6] }
  if (typeof disc === 'object' && !Array.isArray(disc)) {
    if (Array.isArray(disc.value)) {
      // { type: "u8", value: [6, 0, ...] } — explicit byte array
      const all = (disc.value as any[]).every((b) => typeof b === 'number' && b >= 0 && b <= 255)
      if (!all) return null
      return new Uint8Array(disc.value as number[])
    }
    if (typeof disc.value === 'number') {
      const sizes: Record<string, number> = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, u64: 8, i64: 8 }
      const size = sizes[disc.type as string] ?? 1
      const v = disc.value as number
      const buf = new Uint8Array(size)
      for (let i = 0; i < size; i++) buf[i] = (v >> (i * 8)) & 0xff
      return buf
    }
    return null
  }

  // Array format: any length (1-byte, 8-byte Anchor standard, or custom)
  if (Array.isArray(disc) && disc.length > 0) {
    const allBytes = (disc as any[]).every(
      (value) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255,
    )
    if (!allBytes) return null
    return new Uint8Array(disc as number[])
  }

  return null
}

async function getInstructionDiscriminator(instruction: AnchorInstruction): Promise<Uint8Array> {
  const explicit = getExplicitInstructionDiscriminator(instruction)
  if (explicit) {
    return explicit
  }

  const encoder = new TextEncoder()
  const data = encoder.encode(`global:${instruction.name}`)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return new Uint8Array(hashBuffer).slice(0, 8)
}

/**
 * Encode arguments based on IDL types using Borsh-like serialization
 * This is a simplified serialization for common types
 */
function encodeArgs(args: Record<string, any>, argDefs: Array<{ name: string; type: any }>, types?: AnchorType[]): Uint8Array {
  const buffers: number[] = []

  for (const argDef of argDefs) {
    const value = args[argDef.name]
    const encoded = encodeValue(value, argDef.type, types)
    buffers.push(...encoded)
  }

  return new Uint8Array(buffers)
}

function encodeValue(value: any, type: any, types?: AnchorType[]): number[] {
  if (typeof type === 'string') {
    switch (type) {
      case 'u8':
        return [Number(value) & 0xff]
      case 'u16': {
        const v = Number(value)
        return [v & 0xff, (v >> 8) & 0xff]
      }
      case 'u32': {
        const v = Number(value)
        return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]
      }
      case 'u64': case 'i64': {
        const v = BigInt(value)
        const bytes: number[] = []
        for (let i = 0; i < 8; i++) {
          bytes.push(Number((v >> BigInt(i * 8)) & BigInt(0xff)))
        }
        return bytes
      }
      case 'u128': case 'i128': {
        const v = BigInt(value)
        const bytes: number[] = []
        for (let i = 0; i < 16; i++) {
          bytes.push(Number((v >> BigInt(i * 8)) & BigInt(0xff)))
        }
        return bytes
      }
      case 'i8':
        return [Number(value) & 0xff]
      case 'i16': {
        const v = Number(value)
        return [v & 0xff, (v >> 8) & 0xff]
      }
      case 'i32': {
        const v = Number(value)
        return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]
      }
      case 'f32': {
        const buf = new ArrayBuffer(4)
        new DataView(buf).setFloat32(0, Number(value), true)
        return [...new Uint8Array(buf)]
      }
      case 'f64': {
        const buf = new ArrayBuffer(8)
        new DataView(buf).setFloat64(0, Number(value), true)
        return [...new Uint8Array(buf)]
      }
      case 'bool':
        return [value ? 1 : 0]
      case 'string': {
        const encoder = new TextEncoder()
        const strBytes = encoder.encode(String(value))
        // Length prefix (u32 LE) + data
        const len = strBytes.length
        return [
          len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff, (len >> 24) & 0xff,
          ...strBytes,
        ]
      }
      case 'publicKey':
      case 'pubkey': {
        return [...base58Decode(String(value))]
      }
      case 'bytes': {
        const bytes = Array.isArray(value) ? value : []
        const len = bytes.length
        return [
          len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff, (len >> 24) & 0xff,
          ...bytes,
        ]
      }
      default:
        return []
    }
  }

  // Option type
  if (type.option) {
    if (value === null || value === undefined) {
      return [0] // None
    }
    return [1, ...encodeValue(value, type.option, types)] // Some
  }

  // Vec type
  if (type.vec) {
    const arr = Array.isArray(value) ? value : []
    const len = arr.length
    const result = [len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff, (len >> 24) & 0xff]
    for (const item of arr) {
      result.push(...encodeValue(item, type.vec, types))
    }
    return result
  }

  // Array type (fixed size)
  if (type.array) {
    const [innerType, size] = type.array
    const arr = Array.isArray(value) ? value : []
    const result: number[] = []
    for (let i = 0; i < size; i++) {
      result.push(...encodeValue(arr[i] || 0, innerType, types))
    }
    return result
  }

  // Defined type (struct) — look up in IDL types and encode each field in order
  const definedName = getDefinedTypeName(type)
  if (definedName && types) {
    const typeDef = types.find((t) => t.name === definedName)
    if (typeDef && typeDef.type?.kind === 'struct' && typeDef.type?.fields) {
      const obj = (typeof value === 'object' && value !== null) ? value : {}
      const result: number[] = []
      for (let i = 0; i < typeDef.type.fields.length; i++) {
        const field = normalizeField(typeDef.type.fields[i], i)
        const fieldValue = obj[field.name]
        result.push(...encodeValue(fieldValue, field.type, types))
      }
      return result
    }
  }

  return []
}

function listInstructionNames(idl: AnchorIDL): string {
  return (idl.instructions ?? []).map((ix) => ix.name).join(', ')
}

// ─── Codama encoding helpers ──────────────────────────────────────────────────

function encodeCodamaValue(value: any, type: CodamaTypeNode, idl?: CodamaIDL): number[] {
  switch (type.kind) {
    case 'numberTypeNode': {
      switch (type.format) {
        case 'u8': case 'i8': return [Number(value) & 0xff]
        case 'u16': case 'i16': { const v = Number(value); return [v & 0xff, (v >> 8) & 0xff] }
        case 'u32': case 'i32': { const v = Number(value); return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff] }
        case 'u64': case 'i64': {
          const v = BigInt(value)
          const bytes: number[] = []
          for (let i = 0; i < 8; i++) bytes.push(Number((v >> BigInt(i * 8)) & BigInt(0xff)))
          return bytes
        }
        case 'u128': case 'i128': {
          const v = BigInt(value)
          const bytes: number[] = []
          for (let i = 0; i < 16; i++) bytes.push(Number((v >> BigInt(i * 8)) & BigInt(0xff)))
          return bytes
        }
        case 'f32': { const buf = new ArrayBuffer(4); new DataView(buf).setFloat32(0, Number(value), true); return [...new Uint8Array(buf)] }
        case 'f64': { const buf = new ArrayBuffer(8); new DataView(buf).setFloat64(0, Number(value), true); return [...new Uint8Array(buf)] }
        default: return []
      }
    }
    case 'booleanTypeNode': return [value ? 1 : 0]
    case 'publicKeyTypeNode': return [...base58Decode(String(value))]
    case 'stringTypeNode': {
      const enc = new TextEncoder()
      const strBytes = enc.encode(String(value))
      const len = strBytes.length
      return [len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff, (len >> 24) & 0xff, ...strBytes]
    }
    case 'bytesTypeNode': {
      const bytes = Array.isArray(value) ? value : []
      const len = bytes.length
      return [len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff, (len >> 24) & 0xff, ...bytes]
    }
    case 'fixedSizeTypeNode': {
      const size = type.size
      const inner = type.type
      if (inner.kind === 'stringTypeNode') {
        const enc = new TextEncoder()
        const strBytes = enc.encode(String(value ?? ''))
        const out = new Uint8Array(size)
        out.set(strBytes.slice(0, size))
        return [...out]
      }
      // Generic: encode inner value, zero-pad or truncate to fixed size
      const innerBytes = new Uint8Array(encodeCodamaValue(value, inner))
      const out = new Uint8Array(size)
      out.set(innerBytes.slice(0, size))
      return [...out]
    }
    case 'optionTypeNode':
    case 'zeroableOptionTypeNode': {
      if (value === null || value === undefined) return [0]
      return [1, ...encodeCodamaValue(value, type.item, idl)]
    }
    case 'arrayTypeNode': {
      const arr = Array.isArray(value) ? value : []
      if (type.count.kind === 'fixedCountNode') {
        const result: number[] = []
        for (let i = 0; i < type.count.value; i++) result.push(...encodeCodamaValue(arr[i] ?? 0, type.item, idl))
        return result
      }
      // prefixed / remainder → length-prefixed vec
      const len = arr.length
      const result = [len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff, (len >> 24) & 0xff]
      for (const item of arr) result.push(...encodeCodamaValue(item, type.item, idl))
      return result
    }
    case 'tupleTypeNode': {
      const arr = Array.isArray(value) ? value : []
      const result: number[] = []
      type.items.forEach((t: CodamaTypeNode, i: number) => result.push(...encodeCodamaValue(arr[i], t, idl)))
      return result
    }
    case 'structTypeNode': {
      const obj = (typeof value === 'object' && value !== null) ? value : {}
      const result: number[] = []
      for (const field of type.fields) result.push(...encodeCodamaValue(obj[field.name], field.type, idl))
      return result
    }
    default: return []
  }
}

function encodeCodamaArgs(
  args: Record<string, any>,
  argDefs: CodamaInstructionArgument[],
  idl: CodamaIDL,
): Uint8Array {
  const buffers: number[] = []
  for (const argDef of argDefs) {
    buffers.push(...encodeCodamaValue(args[argDef.name], argDef.type, idl))
  }
  return new Uint8Array(buffers)
}

// ─── Risk + Anchor error helpers ──────────────────────────────────────────────

/**
 * Heuristic risk score for an instruction call, based on IDL metadata + the
 * caller-supplied accounts/args. Pure function — same input → same output.
 *
 * - `high`: a writable signer is being mutated, or transfer-shaped args present.
 * - `medium`: any writable account besides the fee payer.
 * - `low`: read-only or no writable accounts.
 */
function assessRiskLevelAnchor(
  instruction: AnchorInstruction,
  accounts: Record<string, string>,
  args: Record<string, any>,
): { level: RiskLevel; reasons: string[] } {
  const reasons: string[] = []
  let level: RiskLevel = 'low'

  const writableSigners = instruction.accounts.filter((a) => {
    const n = normalizeAccountMeta(a)
    return n.isMut && n.isSigner
  })
  if (writableSigners.length > 0) {
    level = 'high'
    reasons.push(
      `${writableSigners.length} writable signer(s): ${writableSigners.map((a) => a.name).join(', ')}`,
    )
  }

  const writables = instruction.accounts.filter((a) => normalizeAccountMeta(a).isMut)
  if (level !== 'high' && writables.length > 0) {
    level = 'medium'
    reasons.push(`${writables.length} writable account(s)`)
  }

  const transferKeywords = /(transfer|withdraw|deposit|mint|burn|stake|unstake|swap|close|fund)/i
  if (transferKeywords.test(instruction.name)) {
    level = 'high'
    reasons.push(`instruction name "${instruction.name}" matches value-transfer keyword`)
  }
  for (const k of Object.keys(args || {})) {
    if (/(amount|lamports|sol|usd|value)/i.test(k)) {
      reasons.push(`arg "${k}" looks like a value/amount`)
      if (level === 'low') level = 'medium'
    }
  }

  // No writables at all → low confidence read-only.
  if (reasons.length === 0) reasons.push('no writable accounts and no value-transfer keywords')

  return { level, reasons }
}

function assessRiskLevelCodama(
  instructionName: string,
  accounts: Array<{ name: string; isWritable: boolean; isSigner: boolean | 'either' | undefined }>,
  args: Record<string, any>,
): { level: RiskLevel; reasons: string[] } {
  const reasons: string[] = []
  let level: RiskLevel = 'low'
  const writableSigners = accounts.filter((a) => a.isWritable && (a.isSigner === true || a.isSigner === 'either'))
  if (writableSigners.length > 0) {
    level = 'high'
    reasons.push(`${writableSigners.length} writable signer(s): ${writableSigners.map((a) => a.name).join(', ')}`)
  }
  const writables = accounts.filter((a) => a.isWritable)
  if (level !== 'high' && writables.length > 0) {
    level = 'medium'
    reasons.push(`${writables.length} writable account(s)`)
  }
  if (/(transfer|withdraw|deposit|mint|burn|stake|unstake|swap|close|fund)/i.test(instructionName)) {
    level = 'high'
    reasons.push(`instruction name "${instructionName}" matches value-transfer keyword`)
  }
  for (const k of Object.keys(args || {})) {
    if (/(amount|lamports|sol|usd|value)/i.test(k)) {
      reasons.push(`arg "${k}" looks like a value/amount`)
      if (level === 'low') level = 'medium'
    }
  }
  if (reasons.length === 0) reasons.push('no writable accounts and no value-transfer keywords')
  return { level, reasons }
}

/**
 * Match `Custom program error: 0x<hex>` (and Anchor's `Error Number: <decimal>`)
 * patterns in simulation logs against the IDL `errors[]` table.
 */
export function decodeAnchorErrorFromLogs(
  logs: string[] | null | undefined,
  errors: AnchorError[] | undefined,
): DecodedAnchorError | null {
  if (!logs || !errors || errors.length === 0) return null
  const codes: number[] = []
  for (const line of logs) {
    const hex = line.match(/custom program error:\s*0x([0-9a-fA-F]+)/i)
    if (hex && hex[1]) codes.push(parseInt(hex[1], 16))
    const dec = line.match(/Error\s+Number:\s*(\d+)/i)
    if (dec && dec[1]) codes.push(parseInt(dec[1], 10))
    const anchorMsg = line.match(/AnchorError\b.*?Error Code:\s*([A-Za-z0-9_]+)/)
    if (anchorMsg && anchorMsg[1]) {
      const named = errors.find((e) => e.name === anchorMsg[1])
      if (named) return { code: named.code, name: named.name, msg: named.msg }
    }
  }
  for (const c of codes) {
    const found = errors.find((e) => e.code === c)
    if (found) return { code: found.code, name: found.name, msg: found.msg }
  }
  return null
}

/** Extract `Program X consumed N of M compute units` from logs. */
export function extractComputeUnits(logs: string[] | null | undefined): number | null {
  if (!logs) return null
  for (const line of logs) {
    const m = line.match(/consumed\s+(\d+)\s+of\s+\d+\s+compute units/)
    if (m && m[1]) return parseInt(m[1], 10)
  }
  return null
}

// ─── Codama native tx builder ─────────────────────────────────────────────────

async function buildCodamaTx(
  idl: CodamaIDL,
  instructionName: string,
  request: BuildTransactionRequest,
  programId: string,
  rpcUrl: string,
  meta: { cluster: ResolvedCluster; rpcUrlHost: string },
): Promise<BuildTransactionResponse> {
  const instruction = getCodamaInstruction(idl, instructionName)
  if (!instruction) {
    const available = idl.program.instructions.map((ix: { name: string }) => ix.name).join(', ')
    throw new Error(`Instruction "${instructionName}" not found in Codama IDL. Available: ${available}`)
  }

  // Discriminator — Codama uses a 1-byte field discriminator
  const discriminatorBytes = getCodamaDiscriminatorBytes(instruction)
  const discriminator = discriminatorBytes ?? new Uint8Array(0)

  // User args — exclude discriminator-only/omitted args
  const userArgs = getCodamaUserArgs(instruction)
  const missingArgs = userArgs.filter((a) => request.args[a.name] === undefined)
  if (missingArgs.length > 0) {
    throw new Error(`Missing required arguments: ${missingArgs.map((a) => a.name).join(', ')}`)
  }

  // Accounts — auto-fill from Codama defaultValue where not provided
  const accountInfos: AccountInfo[] = []
  const missingRequired: string[] = []
  for (const acc of instruction.accounts) {
    let pubkey = request.accounts[acc.name]
    if (!pubkey && acc.defaultValue?.kind === 'publicKeyValueNode') {
      pubkey = acc.defaultValue.publicKey  // auto-fill (e.g. systemProgram, tokenProgram)
    }
    if (!pubkey && !acc.isOptional) {
      missingRequired.push(acc.name)
    }
    if (pubkey) {
      accountInfos.push({
        name: acc.name,
        pubkey,
        isSigner: acc.isSigner === true || acc.isSigner === 'either',
        isWritable: acc.isWritable,
      })
    }
  }
  if (missingRequired.length > 0) {
    throw new Error(`Missing required accounts: ${missingRequired.join(', ')}`)
  }

  for (const acc of request.remainingAccounts ?? []) {
    accountInfos.push({
      name: `remaining[${accountInfos.length}]`,
      pubkey: acc.pubkey,
      isSigner: acc.isSigner ?? false,
      isWritable: acc.isWritable ?? false,
    })
  }

  // Encode args
  const encodedArgs = encodeCodamaArgs(request.args, userArgs, idl)

  // Combine discriminator + args
  const instructionData = new Uint8Array(discriminator.length + encodedArgs.length)
  instructionData.set(discriminator, 0)
  instructionData.set(encodedArgs, discriminator.length)

  // Blockhash
  let blockhash = request.recentBlockhash
  let lastValidBlockHeight: number | undefined
  const blockhashSource: 'client' | 'rpc' = blockhash ? 'client' : 'rpc'
  if (!blockhash) {
    const latest = await fetchLatestBlockhash(rpcUrl)
    blockhash = latest.blockhash
    lastValidBlockHeight = latest.lastValidBlockHeight
  }

  // Build tx
  const txData = {
    feePayer: request.feePayer,
    recentBlockhash: blockhash,
    instructions: [{
      programId,
      keys: accountInfos.map((acc) => ({ pubkey: acc.pubkey, isSigner: acc.isSigner, isWritable: acc.isWritable })),
      data: arrayToBase58(instructionData),
    }],
  }
  const txRawBytes = new TextEncoder().encode(JSON.stringify(txData))
  const encoding = request.encoding === 'base64' ? 'base64' : 'base58'

  const msgBytes = buildSolanaMessage(request.feePayer, accountInfos, programId, instructionData, blockhash)
  const sigCountBytes = encodeCompactU16(1)
  const wireBytes = new Uint8Array(sigCountBytes.length + 64 + msgBytes.length)
  wireBytes.set(sigCountBytes, 0)
  wireBytes.set(msgBytes, sigCountBytes.length + 64)

  const txBase58 = encoding === 'base64' ? uint8ArrayToBase64(txRawBytes) : base58Encode(txRawBytes)
  const serializedTransaction = encoding === 'base64' ? uint8ArrayToBase64(wireBytes) : base58Encode(wireBytes)

  let simulationError: unknown | null = null
  let simulationLogs: string[] | null = null
  if (request.simulate) {
    const sim = await simulateTransactionRpc(rpcUrl, wireBytes)
    simulationError = sim.err
    simulationLogs = sim.logs
  }

  const codamaRisk = assessRiskLevelCodama(
    instructionName,
    instruction.accounts.map((a: any) => ({ name: a.name, isWritable: a.isWritable, isSigner: a.isSigner })),
    request.args || {},
  )

  return {
    transaction: txBase58,
    serializedTransaction,
    encoding,
    message: `Transaction for ${idl.program.name}.${instructionName}`,
    accounts: accountInfos,
    instruction: { name: instructionName, programId, data: arrayToHex(instructionData), accounts: accountInfos },
    estimatedFee: 5000,
    network: meta.cluster,
    rpcUrlHost: meta.rpcUrlHost,
    recentBlockhash: blockhash,
    lastValidBlockHeight,
    blockhashSource,
    wireFormat: 'legacy',
    simulationError,
    simulationLogs,
    riskLevel: codamaRisk.level,
    riskReasons: codamaRisk.reasons,
    decodedError: null, // Codama IDLs don't surface Anchor-style errors[]
  }
}

/**
 * Build a transaction from IDL instruction.
 * Dispatches to Anchor or Codama path based on the raw IDL format.
 */
export async function buildTransaction(
  idl: AnchorIDL | CodamaIDL,
  instructionName: string,
  request: BuildTransactionRequest,
  programId: string,
  rpcUrl: string,
  meta: { cluster: ResolvedCluster; rpcUrlHost: string },
): Promise<BuildTransactionResponse> {
  if (detectIDLFormat(idl) === 'codama') {
    return buildCodamaTx(idl as CodamaIDL, instructionName, request, programId, rpcUrl, meta)
  }

  const anchorIdl = idl as AnchorIDL
  const instruction = getInstruction(anchorIdl, instructionName)
  if (!instruction) {
    throw new Error(
      `Instruction "${instructionName}" not found in IDL. Available: ${listInstructionNames(anchorIdl)}`,
    )
  }

  // Validate required accounts
  const missingAccounts: string[] = []
  for (const acc of instruction.accounts) {
    const norm = normalizeAccountMeta(acc)
    if (!norm.isOptional && !request.accounts[norm.name]) {
      missingAccounts.push(norm.name)
    }
  }
  if (missingAccounts.length > 0) {
    throw new Error(`Missing required accounts: ${missingAccounts.join(', ')}`)
  }

  // Validate required args
  const missingArgs: string[] = []
  for (const arg of instruction.args) {
    if (request.args[arg.name] === undefined) {
      missingArgs.push(arg.name)
    }
  }
  if (missingArgs.length > 0) {
    throw new Error(`Missing required arguments: ${missingArgs.join(', ')}`)
  }

  // Get instruction discriminator
  const discriminator = await getInstructionDiscriminator(instruction)

  // Encode arguments (pass IDL types for defined type resolution)
  const encodedArgs = encodeArgs(request.args, instruction.args, anchorIdl.types)

  // Combine discriminator + args
  const instructionData = new Uint8Array(discriminator.length + encodedArgs.length)
  instructionData.set(discriminator, 0)
  instructionData.set(encodedArgs, discriminator.length)

  // Build account list
  const accountInfos: AccountInfo[] = instruction.accounts.map((acc: AnchorAccountMeta) => {
    const norm = normalizeAccountMeta(acc)
    return {
      name: norm.name,
      pubkey: request.accounts[norm.name] || '',
      isSigner: norm.isSigner,
      isWritable: norm.isMut,
    }
  })

  for (const acc of request.remainingAccounts ?? []) {
    accountInfos.push({
      name: `remaining[${accountInfos.length}]`,
      pubkey: acc.pubkey,
      isSigner: acc.isSigner ?? false,
      isWritable: acc.isWritable ?? false,
    })
  }

  // Fetch recent blockhash if not provided (must use same RPC as cluster intent — see resolveSolanaRpcUrl at call sites)
  let blockhash = request.recentBlockhash
  let lastValidBlockHeight: number | undefined
  const blockhashSource: 'client' | 'rpc' = blockhash ? 'client' : 'rpc'
  if (!blockhash) {
    const latest = await fetchLatestBlockhash(rpcUrl)
    blockhash = latest.blockhash
    lastValidBlockHeight = latest.lastValidBlockHeight
  }

  // Build serialized transaction data (simplified format for API response)
  const txData = {
    feePayer: request.feePayer,
    recentBlockhash: blockhash,
    instructions: [{
      programId,
      keys: accountInfos.map((acc) => ({
        pubkey: acc.pubkey,
        isSigner: acc.isSigner,
        isWritable: acc.isWritable,
      })),
      data: arrayToBase58(instructionData),
    }],
  }

  const txRawBytes = new TextEncoder().encode(JSON.stringify(txData))
  const encoding = request.encoding === 'base64' ? 'base64' : 'base58'

  // Build real Solana wire-format transaction (compatible with Transaction.from())
  const msgBytes = buildSolanaMessage(request.feePayer, accountInfos, programId, instructionData, blockhash)
  const sigCountBytes = encodeCompactU16(1)
  const wireBytes = new Uint8Array(sigCountBytes.length + 64 + msgBytes.length)
  wireBytes.set(sigCountBytes, 0)
  // bytes [sigCountBytes.length .. sigCountBytes.length+63] stay zero (empty signature slot)
  wireBytes.set(msgBytes, sigCountBytes.length + 64)

  const txBase58 = encoding === 'base64' ? uint8ArrayToBase64(txRawBytes) : base58Encode(txRawBytes)
  const serializedTransaction = encoding === 'base64' ? uint8ArrayToBase64(wireBytes) : base58Encode(wireBytes)

  let simulationError: unknown | null = null
  let simulationLogs: string[] | null = null
  if (request.simulate) {
    const sim = await simulateTransactionRpc(rpcUrl, wireBytes)
    simulationError = sim.err
    simulationLogs = sim.logs
  }

  const anchorRisk = assessRiskLevelAnchor(instruction, request.accounts || {}, request.args || {})
  const decodedError = simulationError
    ? decodeAnchorErrorFromLogs(simulationLogs, anchorIdl.errors)
    : null

  return {
    transaction: txBase58,
    serializedTransaction,
    encoding,
    message: `Transaction for ${(getIDLProgramName(anchorIdl) || 'program')}.${instructionName}`,
    accounts: accountInfos,
    instruction: {
      name: instructionName,
      programId,
      data: arrayToHex(instructionData),
      accounts: accountInfos,
    },
    estimatedFee: 5000, // base fee in lamports
    network: meta.cluster,
    rpcUrlHost: meta.rpcUrlHost,
    recentBlockhash: blockhash,
    lastValidBlockHeight,
    blockhashSource,
    wireFormat: 'legacy',
    simulationError,
    simulationLogs,
    riskLevel: anchorRisk.level,
    riskReasons: anchorRisk.reasons,
    decodedError,
  }
}

// ─── Standalone simulator (used by MCP simulate_instruction) ──────────────────

/**
 * Build + simulate an instruction. Reuses the same wire bytes as buildTransaction
 * but always sets `simulate: true`, decodes Anchor errors, and extracts compute units.
 *
 * No-signer pre-flight: the wire bytes are unsigned and the RPC request uses
 * `sigVerify: false` (see simulateTransactionRpc).
 */
export async function simulateInstruction(
  idl: AnchorIDL | CodamaIDL,
  instructionName: string,
  request: BuildTransactionRequest,
  programId: string,
  rpcUrl: string,
  meta: { cluster: ResolvedCluster; rpcUrlHost: string },
): Promise<SimulationResult> {
  const build = await buildTransaction(
    idl,
    instructionName,
    { ...request, simulate: true },
    programId,
    rpcUrl,
    meta,
  )
  const logs = build.simulationLogs ?? []
  const computeUnits = extractComputeUnits(logs)
  return {
    success: build.simulationError == null,
    computeUnits,
    logs,
    err: build.simulationError,
    decodedError: build.decodedError,
    build,
  }
}

/**
 * Simulate a raw pre-built Solana transaction (base64 or base58 wire bytes).
 * Useful when the transaction was built externally — e.g. with a custom discriminator
 * that Orquestra cannot reproduce — and you still want preflight RPC validation.
 *
 * `sigVerify` is always false so no wallet or signature is required.
 */
export async function simulateRawTransaction(
  serializedTx: string,
  encoding: 'base64' | 'base58',
  rpcUrl: string,
): Promise<{ success: boolean; computeUnits: number | null; logs: string[]; err: unknown | null }> {
  let wireBytes: Uint8Array
  if (encoding === 'base64') {
    const binary = atob(serializedTx)
    wireBytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) wireBytes[i] = binary.charCodeAt(i)
  } else {
    wireBytes = base58Decode(serializedTx)
  }
  const { err, logs } = await simulateTransactionRpc(rpcUrl, wireBytes)
  return {
    success: err === null,
    computeUnits: extractComputeUnits(logs),
    logs,
    err,
  }
}

// ─── Flow Engine: multi-instruction v0 transaction composer ───────────────────
//
// composeTransaction() is additive to this file: buildTransaction() above stays the
// single-Anchor/Codama-instruction, legacy-wire-format path. This is the Orquestra Flow
// Engine (OFE) path — it takes N already-resolved FlowInstruction entries (no IDL lookup,
// no arg encoding) and compiles them into one v0 (VersionedTransaction) message, since a
// flow's compiled DAG output can span more accounts/instructions than a legacy message's
// single-byte account-count header comfortably supports.

/**
 * Heuristic risk score for a composed multi-instruction flow transaction. Mirrors the
 * assessRiskLevelAnchor/assessRiskLevelCodama pattern above (writable-signer → high,
 * writable-account → medium, otherwise low, via direct `level = ...` assignment) but
 * aggregates across every instruction in the flow and adds one flow-specific signal: a
 * signer other than the fee payer, which composeTransaction cannot satisfy on its own
 * (only feePayer will ultimately sign).
 */
function assessRiskLevelFlow(
  instructions: FlowInstruction[],
  feePayer: string,
): { level: RiskLevel; reasons: string[] } {
  const reasons: string[] = []
  let level: RiskLevel = 'low'

  let totalWritable = 0
  const writableSigners = new Set<string>()
  const foreignSigners = new Set<string>()

  for (const ix of instructions) {
    for (const key of ix.keys) {
      if (key.isWritable) totalWritable++
      if (key.isSigner && key.isWritable) writableSigners.add(key.pubkey)
      if (key.isSigner && key.pubkey !== feePayer) foreignSigners.add(key.pubkey)
    }
  }

  if (writableSigners.size > 0) {
    level = 'high'
    reasons.push(`${writableSigners.size} writable signer(s) across instructions: ${[...writableSigners].join(', ')}`)
  }

  if (foreignSigners.size > 0) {
    level = 'high'
    reasons.push(
      `${foreignSigners.size} signer(s) other than the fee payer are required: ${[...foreignSigners].join(', ')} — composeTransaction only accounts for feePayer's signature`,
    )
  }

  if (level !== 'high' && totalWritable > 0) {
    level = 'medium'
    reasons.push(`${totalWritable} writable account(s) across ${instructions.length} instruction(s)`)
  }

  if (level !== 'high' && instructions.length > 8) {
    level = 'medium'
    reasons.push(`${instructions.length} instructions composed into a single transaction`)
  }

  if (reasons.length === 0) reasons.push('no writable accounts and no non-feePayer signers')

  return { level, reasons }
}

export interface ComposeTransactionRequest {
  /** base58 pubkey that pays fees and is assumed to be the sole signer. */
  feePayer: string
  instructions: FlowInstruction[]
  rpcUrl: string
  /** Runs preflight simulateTransaction (sigVerify: false) against rpcUrl, per transaction. Default true. */
  simulate?: boolean
  /**
   * Addresses of EXISTING, already-created-and-extended Address Lookup Tables to
   * compile the message(s) against. Real ALT usage — reduces per-account bytes in
   * the compiled message, which can both avoid a multi-transaction split and let
   * more accounts fit in one transaction. Fetched via RPC and passed to
   * `compileToV0Message`. Creating/extending a NEW lookup table is out of scope
   * here (that's its own multi-step on-chain process — a table must land and be
   * confirmed before anything can reference it — not something a single
   * composeTransaction call can do): pass addresses of tables that already exist.
   * An address that doesn't resolve to a real lookup table account is dropped
   * with a note in `risk.reasons`, not a hard failure.
   */
  lookupTableAddresses?: string[]
  /** @deprecated Use `lookupTableAddresses` — a boolean can't create or reference a table by itself. Kept for backward compatibility: true with no `lookupTableAddresses` still just notes the limitation in `risk.reasons`. */
  useALT?: boolean
}

export interface ComposedTransaction {
  /** base64-encoded, v0 (VersionedTransaction) wire format, unsigned. */
  unsignedTransaction: string
  /** How many of the request's instructions landed in this transaction. */
  instructionCount: number
  /**
   * Present only when request.simulate !== false. Simulated independently per
   * transaction — see the ComposeTransactionResponse doc comment for why this
   * is a subset of the full SimulationResult shape.
   */
  simulation?: Pick<SimulationResult, 'success' | 'computeUnits' | 'logs' | 'err'>
}

export interface ComposeTransactionResponse {
  /**
   * One or more unsigned v0 transactions, in the order they must land on-chain
   * (later transactions may depend on state written by earlier ones — e.g. an
   * ATA-create in transaction 1 that transaction 2's transfer instruction reads).
   * Almost always length 1; only splits into more when the instruction set
   * doesn't fit a single 1232-byte packet (see packInstructionsIntoBatches).
   * NOTE: this is a subset of the existing SimulationResult shape (success/computeUnits/logs/err) —
   * SimulationResult.decodedError requires an IDL errors[] table and SimulationResult.build requires
   * a single-instruction BuildTransactionResponse, neither of which exists for a multi-instruction,
   * IDL-less composed flow transaction. See simulateRawTransaction(), which this reuses verbatim.
   */
  transactions: ComposedTransaction[]
  risk: { level: RiskLevel; reasons: string[] }
}

/**
 * Fetches existing Address Lookup Table accounts by address. Skips (does not
 * throw for) any address that doesn't resolve to a real ALT account — those
 * are reported back separately so the caller can note them in `risk.reasons`
 * rather than failing the whole compose over one bad address.
 */
export async function fetchLookupTables(
  addresses: string[],
  rpcUrl: string,
): Promise<{ tables: AddressLookupTableAccount[]; missing: string[] }> {
  const connection = new Connection(rpcUrl)
  const tables: AddressLookupTableAccount[] = []
  const missing: string[] = []

  await Promise.all(
    addresses.map(async (address) => {
      try {
        const result = await connection.getAddressLookupTable(new PublicKey(address))
        if (result.value) {
          tables.push(result.value)
        } else {
          missing.push(address)
        }
      } catch {
        missing.push(address)
      }
    }),
  )

  return { tables, missing }
}

/**
 * Greedily packs instructions (in order — order is preserved both within and
 * across batches, since later instructions may depend on earlier ones, e.g.
 * "create ATA" before "transfer") into the fewest v0 transactions that each
 * fit the 1232-byte packet limit. Pure — takes an already-fetched blockhash
 * and already-fetched lookup tables, does no RPC itself, fully unit-testable
 * without a network. Passing real `lookupTables` lets more instructions (or
 * more distinct accounts) fit per transaction, since accounts present in a
 * lookup table compile to a 1-byte index instead of a 32-byte pubkey.
 *
 * Throws if a SINGLE instruction alone cannot fit in one transaction even
 * with every provided lookup table applied.
 */
export function packInstructionsIntoBatches(
  instructions: TransactionInstruction[],
  payerKey: PublicKey,
  blockhash: string,
  lookupTables: AddressLookupTableAccount[] = [],
): TransactionInstruction[][] {
  if (instructions.length === 0) {
    throw new Error('packInstructionsIntoBatches requires at least one instruction')
  }

  const fitsInOneTransaction = (batch: TransactionInstruction[]): boolean => {
    try {
      const message = new TransactionMessage({ payerKey, recentBlockhash: blockhash, instructions: batch }).compileToV0Message(lookupTables)
      return new VersionedTransaction(message).serialize().length <= 1232
    } catch {
      return false
    }
  }

  const batches: TransactionInstruction[][] = []
  let current: TransactionInstruction[] = []

  for (const ix of instructions) {
    const attempt = [...current, ix]
    if (fitsInOneTransaction(attempt)) {
      current = attempt
      continue
    }

    if (current.length === 0) {
      throw new Error('a single instruction exceeds the 1232 byte packet limit and cannot be split across transactions')
    }
    batches.push(current)
    if (!fitsInOneTransaction([ix])) {
      throw new Error('a single instruction exceeds the 1232 byte packet limit and cannot be split across transactions')
    }
    current = [ix]
  }
  if (current.length > 0) batches.push(current)

  return batches
}

/**
 * Compose N pre-resolved FlowInstruction entries (Orquestra Flow Engine DAG output) into
 * one or more unsigned v0 transactions (see packInstructionsIntoBatches — splits only when
 * needed). Unlike buildTransaction(), there is no IDL lookup or Borsh arg encoding here —
 * instructions arrive fully formed (programId/keys/data already resolved by the flow engine)
 * and this only handles: instruction conversion, blockhash, batching, message compilation,
 * risk heuristics, and optional per-transaction preflight simulation.
 */
export async function composeTransaction(request: ComposeTransactionRequest): Promise<ComposeTransactionResponse> {
  if (!request.instructions || request.instructions.length === 0) {
    throw new Error('composeTransaction requires at least one instruction')
  }
  if (!isValidBase58(request.feePayer)) {
    throw new Error(`Invalid fee payer public key: ${request.feePayer}`)
  }

  let payerKey: PublicKey
  try {
    payerKey = new PublicKey(request.feePayer)
  } catch (err) {
    throw new Error(`Invalid fee payer public key "${request.feePayer}": ${(err as Error).message}`)
  }

  const txInstructions: TransactionInstruction[] = request.instructions.map((ix, i) => {
    try {
      return new TransactionInstruction({
        programId: new PublicKey(ix.programId),
        keys: ix.keys.map((k) => ({
          pubkey: new PublicKey(k.pubkey),
          isSigner: k.isSigner,
          isWritable: k.isWritable,
        })),
        data: Buffer.from(ix.data, 'base64'),
      })
    } catch (err) {
      throw new Error(`Failed to decode instruction[${i}] (programId=${ix.programId}): ${(err as Error).message}`)
    }
  })

  const risk = assessRiskLevelFlow(request.instructions, request.feePayer)

  let lookupTables: AddressLookupTableAccount[] = []
  if (request.lookupTableAddresses && request.lookupTableAddresses.length > 0) {
    const { tables, missing } = await fetchLookupTables(request.lookupTableAddresses, request.rpcUrl)
    lookupTables = tables
    if (tables.length > 0) {
      risk.reasons.push(`using ${tables.length} address lookup table(s): ${tables.map((t) => t.key.toBase58()).join(', ')}`)
    }
    if (missing.length > 0) {
      risk.reasons.push(`${missing.length} requested lookup table address(es) did not resolve to a real ALT and were skipped: ${missing.join(', ')}`)
    }
  } else if (request.useALT) {
    risk.reasons.push('useALT was set but no lookupTableAddresses were provided — nothing to reference (this option cannot create a new table)')
  }

  // Reuse the same warm-isolate blockhash cache as buildTransaction/fetchLatestBlockhash —
  // no separate cache or Connection object needed for a fresh (unsigned) message. One
  // blockhash is shared across every split transaction (they're meant to land together).
  const { blockhash } = await fetchLatestBlockhash(request.rpcUrl)

  const batches = packInstructionsIntoBatches(txInstructions, payerKey, blockhash, lookupTables)
  if (batches.length > 1) {
    risk.reasons.push(
      `${request.instructions.length} instructions did not fit one 1232-byte packet — split into ${batches.length} transactions that must be submitted in order`,
    )
  }

  // Each transaction is simulated independently against CURRENT on-chain state — not the
  // hypothetical state after earlier transactions in this batch have landed. A later
  // transaction that depends on an account created by an earlier one (e.g. transferring
  // from an ATA the first transaction creates) may report a false simulation failure here;
  // that is expected when batches.length > 1 and does not mean the sequence is wrong, only
  // that this preflight can't see forward. The risk reason above already flags a multi-tx
  // split so callers know to treat simulation results on transaction 2+ with that caveat.
  const transactions: ComposedTransaction[] = []
  for (const batch of batches) {
    const message = new TransactionMessage({ payerKey, recentBlockhash: blockhash, instructions: batch }).compileToV0Message(lookupTables)
    const versionedTx = new VersionedTransaction(message)
    const unsignedTransaction = uint8ArrayToBase64(versionedTx.serialize())

    const entry: ComposedTransaction = { unsignedTransaction, instructionCount: batch.length }
    if (request.simulate !== false) {
      entry.simulation = await simulateRawTransaction(unsignedTransaction, 'base64', request.rpcUrl)
    }
    transactions.push(entry)
  }

  return { transactions, risk }
}

/**
 * Validate a build request against IDL instruction definition.
 * Pass idlTypes to validate fields inside defined (struct) types.
 */
export function validateBuildRequest(
  instruction: AnchorInstruction,
  accounts: Record<string, string>,
  args: Record<string, any>,
  idlTypes?: AnchorType[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // Check required accounts
  for (const acc of instruction.accounts) {
    const norm = normalizeAccountMeta(acc)
    if (!norm.isOptional && !accounts[acc.name]) {
      errors.push(`Missing required account: ${acc.name}`)
    }
    // Validate pubkey format
    if (accounts[acc.name] && !isValidBase58(accounts[acc.name])) {
      errors.push(`Invalid public key for account "${acc.name}": ${accounts[acc.name]}`)
    }
  }

  // Check unknown accounts
  const knownAccounts = new Set(instruction.accounts.map((a) => a.name))
  for (const name of Object.keys(accounts)) {
    if (!knownAccounts.has(name)) {
      errors.push(`Unknown account: ${name}`)
    }
  }

  // Check required args (with defined type struct validation)
  for (const arg of instruction.args) {
    if (args[arg.name] === undefined) {
      errors.push(`Missing required argument: ${arg.name}`)
    } else {
      // Validate defined type struct fields
      const definedName = getDefinedTypeName(arg.type)
      if (definedName && idlTypes) {
        const typeDef = idlTypes.find((t) => t.name === definedName)
        if (typeDef && typeDef.type?.kind === 'struct' && typeDef.type?.fields) {
          const val = args[arg.name]
          if (typeof val !== 'object' || val === null) {
            errors.push(`Argument "${arg.name}" must be an object matching struct ${definedName}`)
          } else {
            for (let i = 0; i < typeDef.type.fields.length; i++) {
              const field = normalizeField(typeDef.type.fields[i], i)
              if (val[field.name] === undefined) {
                errors.push(`Missing field "${field.name}" in argument "${arg.name}" (struct ${definedName})`)
              }
            }
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

// Warm-isolate blockhash cache. Blockhashes stay valid ~60–90s on-chain; reusing
// one for ≤15s trims an RPC round trip per build/simulate while leaving clients a
// wide signing window. Kill switch: setBlockhashCacheDisabled(true) (env-driven).
const blockhashCache = new MemoCache<{ blockhash: string; lastValidBlockHeight?: number }>(8, 15_000)
let blockhashCacheDisabled = false

export function setBlockhashCacheDisabled(disabled: boolean): void {
  blockhashCacheDisabled = disabled
}

async function fetchLatestBlockhash(
  rpcUrl: string,
): Promise<{ blockhash: string; lastValidBlockHeight?: number }> {
  if (!blockhashCacheDisabled) {
    const cached = blockhashCache.get(rpcUrl)
    if (cached) return cached
  }
  try {
    const response = await rpcFetch(
      rpcUrl,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getLatestBlockhash',
        params: [{ commitment: 'finalized' }],
      }),
      RPC_TIMEOUTS.blockhash,
    )

    const data = (await response.json()) as {
      result?: { value?: { blockhash: string; lastValidBlockHeight?: number } }
      error?: { message?: string }
    }
    const value = data.result?.value
    if (value?.blockhash) {
      const out: { blockhash: string; lastValidBlockHeight?: number } = {
        blockhash: value.blockhash,
      }
      if (typeof value.lastValidBlockHeight === 'number') {
        out.lastValidBlockHeight = value.lastValidBlockHeight
      }
      if (!blockhashCacheDisabled) {
        blockhashCache.set(rpcUrl, out)
      }
      return out
    }
    throw new Error(data.error?.message || 'Failed to get blockhash from RPC')
  } catch (err) {
    throw new Error(`Failed to fetch recent blockhash: ${(err as Error).message}`)
  }
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

/** Preflight simulation of unsigned legacy transaction bytes (same RPC as build). */
async function simulateTransactionRpc(
  rpcUrl: string,
  wireBytes: Uint8Array,
): Promise<{ err: unknown | null; logs: string[] }> {
  const base64 = uint8ArrayToBase64(wireBytes)
  try {
    const response = await rpcFetch(
      rpcUrl,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'simulateTransaction',
        params: [
          base64,
          {
            encoding: 'base64',
            sigVerify: false,
            commitment: 'processed',
          },
        ],
      }),
      RPC_TIMEOUTS.simulate,
    )
    const data = (await response.json()) as {
      result?: { value?: { err: unknown; logs?: string[] } }
      error?: { message?: string }
    }
    const value = data.result?.value
    if (!value) {
      return { err: data.error?.message ?? 'simulateTransaction RPC error', logs: [] }
    }
    return { err: value.err ?? null, logs: value.logs ?? [] }
  } catch (err) {
    return { err: (err as Error).message, logs: [] }
  }
}

// Utility: Base58 decode (simplified)
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function base58Decode(str: string): Uint8Array {
  const bytes: number[] = []
  for (const c of str) {
    const idx = BASE58_ALPHABET.indexOf(c)
    if (idx === -1) throw new Error(`Invalid base58 character: ${c}`)
    let carry = idx
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58
      bytes[j] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  // Handle leading zeros
  for (const c of str) {
    if (c !== '1') break
    bytes.push(0)
  }
  return new Uint8Array(bytes.reverse())
}

function base58Encode(bytes: Uint8Array): string {
  // Count leading zeros
  let leadingZeros = 0
  for (const b of bytes) {
    if (b !== 0) break
    leadingZeros++
  }

  // Convert to base58
  const digits: number[] = []
  for (const byte of bytes) {
    let carry = byte
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8
      digits[j] = carry % 58
      carry = (carry / 58) | 0
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = (carry / 58) | 0
    }
  }

  // Leading '1's for each leading zero byte
  let result = '1'.repeat(leadingZeros)
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]]
  }
  return result
}

function isValidBase58(str: string): boolean {
  if (!str || str.length < 32 || str.length > 44) return false
  for (const c of str) {
    if (BASE58_ALPHABET.indexOf(c) === -1) return false
  }
  return true
}

function arrayToHex(arr: Uint8Array): string {
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function arrayToBase58(arr: Uint8Array): string {
  return base58Encode(arr)
}

// compact-u16 / shortvec encoding used in Solana message wire format (LEB128 variant)
function encodeCompactU16(n: number): number[] {
  const out: number[] = []
  let rem = n
  for (;;) {
    const b = rem & 0x7f
    rem >>= 7
    if (rem === 0) {
      out.push(b)
      break
    }
    out.push(b | 0x80)
  }
  return out
}

interface KeyMeta {
  pubkey: string
  writableSigner: boolean
  readonlySigner: boolean
  writableNonSigner: boolean
  readonlyNonSigner: boolean
}

/**
 * Build a Solana **legacy** message in binary wire format (not v0 / versioned).
 * Returns the raw message bytes (not the full transaction — no signature prefix).
 * @see BuildTransactionResponse.wireFormat
 */
function buildSolanaMessage(
  feePayer: string,
  accountInfos: AccountInfo[],
  programId: string,
  instructionData: Uint8Array,
  blockhash: string,
): Uint8Array {
  // Collect all keys, merging flags if the same pubkey appears multiple times
  const keyMap = new Map<string, KeyMeta>()

  function upsert(pubkey: string, isSigner: boolean, isWritable: boolean) {
    if (!pubkey) return
    const existing = keyMap.get(pubkey)
    if (!existing) {
      keyMap.set(pubkey, {
        pubkey,
        writableSigner: isSigner && isWritable,
        readonlySigner: isSigner && !isWritable,
        writableNonSigner: !isSigner && isWritable,
        readonlyNonSigner: !isSigner && !isWritable,
      })
    } else {
      // Promote flags: writable > readonly, signer > non-signer
      if (isSigner && isWritable) existing.writableSigner = true
      else if (isSigner && !isWritable) existing.readonlySigner = true
      else if (!isSigner && isWritable) existing.writableNonSigner = true
      else existing.readonlyNonSigner = true
    }
  }

  // fee payer is always writable signer at index 0
  upsert(feePayer, true, true)
  for (const acc of accountInfos) {
    upsert(acc.pubkey, acc.isSigner, acc.isWritable)
  }
  // program id is readonly non-signer
  upsert(programId, false, false)

  // Determine effective role per key (most privileged wins)
  function bucket(m: KeyMeta): 0 | 1 | 2 | 3 {
    if (m.writableSigner) return 0
    if (m.readonlySigner) return 1
    if (m.writableNonSigner) return 2
    return 3
  }

  const sorted = Array.from(keyMap.values()).sort((a, b) => {
    const ba = bucket(a), bb = bucket(b)
    if (ba !== bb) return ba - bb
    // fee payer must be first within bucket 0
    if (a.pubkey === feePayer) return -1
    if (b.pubkey === feePayer) return 1
    return 0
  })

  // Header counts
  const numWritableSigners = sorted.filter((k) => bucket(k) === 0).length
  const numReadonlySigners = sorted.filter((k) => bucket(k) === 1).length
  const numReadonlyNonSigners = sorted.filter((k) => bucket(k) === 3).length
  const numRequiredSignatures = numWritableSigners + numReadonlySigners

  const keyIndex = new Map<string, number>(sorted.map((k, i) => [k.pubkey, i]))

  // Encode instruction
  const programIdIdx = keyIndex.get(programId)!
  const accountIndices = accountInfos
    .filter((a) => a.pubkey)
    .map((a) => keyIndex.get(a.pubkey)!)

  const ixBytes: number[] = [
    programIdIdx,
    ...encodeCompactU16(accountIndices.length),
    ...accountIndices,
    ...encodeCompactU16(instructionData.length),
    ...instructionData,
  ]

  // Assemble message
  const out: number[] = []

  // Header (3 bytes)
  out.push(numRequiredSignatures, numReadonlySigners, numReadonlyNonSigners)

  // Account keys
  out.push(...encodeCompactU16(sorted.length))
  for (const k of sorted) {
    out.push(...base58Decode(k.pubkey))
  }

  // Recent blockhash (32 bytes)
  out.push(...base58Decode(blockhash))

  // Instructions (always 1 here)
  out.push(...encodeCompactU16(1))
  out.push(...ixBytes)

  return new Uint8Array(out)
}
