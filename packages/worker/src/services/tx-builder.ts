/**
 * Transaction Builder Service
 * Constructs Solana transactions from IDL instructions
 * Works in Cloudflare Workers environment (no Node.js dependencies)
 *
 * Wire format: responses use **legacy** Solana transactions (not v0 / versioned messages).
 * Deserialize with `@solana/web3.js` `Transaction.from(bytes)` after `bs58.decode(serializedTransaction)`.
 * `VersionedTransaction.deserialize` will not work on these bytes until a v0 builder exists.
 */

import type { AnchorIDL, AnchorInstruction, AnchorAccountMeta, AnchorType } from './idl-parser'
import { getInstruction, resolveType, getDefinedTypeName, lookupType, normalizeAccountMeta, normalizeField } from './idl-parser'
import type { ResolvedCluster } from '../utils/solana-rpc'

export interface BuildTransactionRequest {
  accounts: Record<string, string>  // account name -> public key (base58)
  args: Record<string, any>         // arg name -> value
  feePayer: string                  // base58 public key
  recentBlockhash?: string          // optional, will fetch if not provided
  network?: 'mainnet-beta' | 'devnet' | 'testnet'
  /** When true, runs JSON-RPC simulateTransaction on the same RPC (unsigned wire bytes). No wallet required. */
  simulate?: boolean
}

export interface BuildTransactionResponse {
  transaction: string               // base58 serialized transaction message
  serializedTransaction: string     // base58 Solana legacy wire transaction, compatible with Transaction.from(bs58.decode(...))
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
async function getInstructionDiscriminator(instructionName: string): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const data = encoder.encode(`global:${instructionName}`)
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

/**
 * Build a transaction from IDL instruction
 */
export async function buildTransaction(
  idl: AnchorIDL,
  instructionName: string,
  request: BuildTransactionRequest,
  programId: string,
  rpcUrl: string,
  meta: { cluster: ResolvedCluster; rpcUrlHost: string },
): Promise<BuildTransactionResponse> {
  const instruction = getInstruction(idl, instructionName)
  if (!instruction) {
    throw new Error(
      `Instruction "${instructionName}" not found in IDL. Available: ${listInstructionNames(idl)}`,
    )
  }

  // Validate required accounts
  const missingAccounts: string[] = []
  for (const acc of instruction.accounts) {
    if (!acc.isOptional && !request.accounts[acc.name]) {
      missingAccounts.push(acc.name)
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
  const discriminator = await getInstructionDiscriminator(instructionName)

  // Encode arguments (pass IDL types for defined type resolution)
  const encodedArgs = encodeArgs(request.args, instruction.args, idl.types)

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

  const txBytes = new TextEncoder().encode(JSON.stringify(txData))
  const txBase58 = base58Encode(txBytes)

  // Build real Solana wire-format transaction (compatible with Transaction.from())
  const msgBytes = buildSolanaMessage(request.feePayer, accountInfos, programId, instructionData, blockhash)
  const sigCountBytes = encodeCompactU16(1)
  const wireBytes = new Uint8Array(sigCountBytes.length + 64 + msgBytes.length)
  wireBytes.set(sigCountBytes, 0)
  // bytes [sigCountBytes.length .. sigCountBytes.length+63] stay zero (empty signature slot)
  wireBytes.set(msgBytes, sigCountBytes.length + 64)
  const serializedTransaction = base58Encode(wireBytes)

  let simulationError: unknown | null = null
  let simulationLogs: string[] | null = null
  if (request.simulate) {
    const sim = await simulateTransactionRpc(rpcUrl, wireBytes)
    simulationError = sim.err
    simulationLogs = sim.logs
  }

  return {
    transaction: txBase58,
    serializedTransaction,
    message: `Transaction for ${idl.metadata.name}.${instructionName}`,
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
  }
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

async function fetchLatestBlockhash(
  rpcUrl: string,
): Promise<{ blockhash: string; lastValidBlockHeight?: number }> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getLatestBlockhash',
        params: [{ commitment: 'finalized' }],
      }),
    })

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
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
    })
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
