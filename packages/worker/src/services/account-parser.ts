/**
 * Account Parser Service
 * Detects Anchor account types from raw on-chain data and deserializes them
 * using the project's IDL field definitions.
 *
 * Pure Web Crypto + BigInt — no Node.js deps, Workers-compatible.
 */

import type { AnchorIDL, AnchorAccount, AnchorType, CodamaIDL, CodamaTypeNode } from './idl-parser'
import { normalizeField, lookupType, getDefinedTypeName } from './idl-parser'

// ────────────────────────────────────────────────────────
// Base58 helpers (self-contained, mirrors pda.ts)
// ────────────────────────────────────────────────────────

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function base58Encode(bytes: Uint8Array): string {
  let leadingZeros = 0
  for (const b of bytes) {
    if (b !== 0) break
    leadingZeros++
  }
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
  let result = '1'.repeat(leadingZeros)
  for (let i = digits.length - 1; i >= 0; i--) result += B58[digits[i]]
  return result
}

// ────────────────────────────────────────────────────────
// Discriminator helpers
// ────────────────────────────────────────────────────────

/**
 * Compute the Anchor account discriminator.
 * = first 8 bytes of SHA-256("account:<AccountName>")
 */
export async function computeAccountDiscriminator(name: string): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const data = encoder.encode(`account:${name}`)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return new Uint8Array(hashBuffer).slice(0, 8)
}

function discriminatorsMatch(a: Uint8Array | number[], b: Uint8Array): boolean {
  if (a.length < 8 || b.length < 8) return false
  for (let i = 0; i < 8; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

// ────────────────────────────────────────────────────────
// Account type detection
// ────────────────────────────────────────────────────────

/**
 * Detect the Anchor account type for raw on-chain data.
 * Checks the first 8 bytes against all account discriminators in the IDL.
 * Uses `acc.discriminator` array if present (new IDL format), else computes from name.
 * Returns the matching AnchorAccount or null if unknown.
 */
export async function detectAccountType(
  rawData: Uint8Array,
  idl: AnchorIDL,
): Promise<AnchorAccount | null> {
  if (!idl.accounts?.length || rawData.length < 8) return null

  const dataDisc = rawData.slice(0, 8)

  for (const account of idl.accounts) {
    if (account.discriminator && account.discriminator.length >= 8) {
      if (discriminatorsMatch(account.discriminator, dataDisc)) {
        return account
      }
    } else {
      // Compute discriminator from name
      const computed = await computeAccountDiscriminator(account.name)
      if (discriminatorsMatch(computed, dataDisc)) {
        return account
      }
    }
  }

  return null
}

// ────────────────────────────────────────────────────────
// Borsh deserialization cursor
// ────────────────────────────────────────────────────────

class BorshReader {
  private view: DataView
  public offset: number

  constructor(data: Uint8Array, startOffset = 0) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    this.offset = startOffset
  }

  remaining(): number {
    return this.view.byteLength - this.offset
  }

  readU8(): number {
    const v = this.view.getUint8(this.offset)
    this.offset += 1
    return v
  }

  readU16(): number {
    const v = this.view.getUint16(this.offset, true)
    this.offset += 2
    return v
  }

  readU32(): number {
    const v = this.view.getUint32(this.offset, true)
    this.offset += 4
    return v
  }

  readU64(): bigint {
    const lo = BigInt(this.view.getUint32(this.offset, true))
    const hi = BigInt(this.view.getUint32(this.offset + 4, true))
    this.offset += 8
    return lo | (hi << 32n)
  }

  readU128(): bigint {
    const lo = this.readU64()
    const hi = this.readU64()
    return lo | (hi << 64n)
  }

  readI8(): number {
    const v = this.view.getInt8(this.offset)
    this.offset += 1
    return v
  }

  readI16(): number {
    const v = this.view.getInt16(this.offset, true)
    this.offset += 2
    return v
  }

  readI32(): number {
    const v = this.view.getInt32(this.offset, true)
    this.offset += 4
    return v
  }

  readI64(): bigint {
    const lo = BigInt(this.view.getUint32(this.offset, true))
    const hi = BigInt(this.view.getInt32(this.offset + 4, true))
    this.offset += 8
    return lo | (hi << 32n)
  }

  readI128(): bigint {
    const lo = this.readU64()
    const hi = BigInt(this.view.getInt32(this.offset, true))
    // reconstruct signed 128 bit
    const hiWord = BigInt(this.view.getUint32(this.offset, true))
    const hiSignedWord = BigInt(this.view.getInt32(this.offset + 4, true))
    this.offset += 8
    return lo | (hiWord << 64n) | (hiSignedWord << 96n)
  }

  readF32(): number {
    const v = this.view.getFloat32(this.offset, true)
    this.offset += 4
    return v
  }

  readF64(): number {
    const v = this.view.getFloat64(this.offset, true)
    this.offset += 8
    return v
  }

  readBool(): boolean {
    return this.readU8() !== 0
  }

  readBytes(n: number): Uint8Array {
    const slice = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, n)
    this.offset += n
    return slice
  }

  readString(): string {
    const len = this.readU32()
    const bytes = this.readBytes(len)
    return new TextDecoder().decode(bytes)
  }

  readByteVec(): Uint8Array {
    const len = this.readU32()
    return this.readBytes(len)
  }

  readPublicKey(): string {
    const bytes = this.readBytes(32)
    return base58Encode(bytes)
  }
}

// ────────────────────────────────────────────────────────
// Borsh value decoder
// ────────────────────────────────────────────────────────

function decodeValue(
  reader: BorshReader,
  type: any,
  idl: AnchorIDL,
  depth = 0,
): unknown {
  if (depth > 10) throw new Error('Maximum recursion depth exceeded in account deserialization')

  if (typeof type === 'string') {
    switch (type) {
      case 'u8':    return reader.readU8()
      case 'u16':   return reader.readU16()
      case 'u32':   return reader.readU32()
      case 'u64': {
        const v = reader.readU64()
        return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString()
      }
      case 'u128': {
        const v = reader.readU128()
        return v.toString()
      }
      case 'i8':    return reader.readI8()
      case 'i16':   return reader.readI16()
      case 'i32':   return reader.readI32()
      case 'i64': {
        const v = reader.readI64()
        const abs = v < 0n ? -v : v
        return abs <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString()
      }
      case 'i128': {
        return reader.readI128().toString()
      }
      case 'f32':   return reader.readF32()
      case 'f64':   return reader.readF64()
      case 'bool':  return reader.readBool()
      case 'publicKey':
      case 'pubkey': return reader.readPublicKey()
      case 'string': return reader.readString()
      case 'bytes': {
        const raw = reader.readByteVec()
        return btoa(String.fromCharCode(...raw))
      }
      default:
        throw new Error(`Unsupported primitive type: ${type}`)
    }
  }

  // Option<T>
  if (type.option !== undefined) {
    const tag = reader.readU8()
    if (tag === 0) return null
    return decodeValue(reader, type.option, idl, depth + 1)
  }

  // Vec<T>
  if (type.vec !== undefined) {
    const len = reader.readU32()
    const result: unknown[] = []
    for (let i = 0; i < len; i++) {
      result.push(decodeValue(reader, type.vec, idl, depth + 1))
    }
    return result
  }

  // [T; N] fixed-size array
  if (type.array !== undefined) {
    const [innerType, size] = type.array as [any, number]
    const result: unknown[] = []
    for (let i = 0; i < size; i++) {
      result.push(decodeValue(reader, innerType, idl, depth + 1))
    }
    return result
  }

  // Defined type (struct / enum)
  const definedName = getDefinedTypeName(type)
  if (definedName) {
    return decodeDefinedType(reader, definedName, idl, depth + 1)
  }

  throw new Error(`Unknown type shape: ${JSON.stringify(type)}`)
}

function decodeDefinedType(
  reader: BorshReader,
  typeName: string,
  idl: AnchorIDL,
  depth = 0,
): unknown {
  const typeDef: AnchorType | undefined = lookupType(idl, typeName)
  if (!typeDef) throw new Error(`Type "${typeName}" not found in IDL`)

  const kind = typeDef.type?.kind || 'struct'

  if (kind === 'struct') {
    const fields = typeDef.type?.fields || []
    const result: Record<string, unknown> = {}
    for (let i = 0; i < fields.length; i++) {
      const normalized = normalizeField(fields[i], i)
      result[normalized.name] = decodeValue(reader, normalized.type, idl, depth + 1)
    }
    return result
  }

  if (kind === 'enum') {
    const variantIndex = reader.readU8()
    const variants = typeDef.type?.variants || []
    if (variantIndex >= variants.length) {
      throw new Error(`Enum variant index ${variantIndex} out of range for type "${typeName}"`)
    }
    const variant = variants[variantIndex]
    if (!variant.fields || variant.fields.length === 0) {
      return { [variant.name]: null }
    }
    // Tuple variant or struct variant
    if (Array.isArray(variant.fields)) {
      const variantData: unknown[] = []
      for (const field of variant.fields) {
        variantData.push(decodeValue(reader, field, idl, depth + 1))
      }
      return { [variant.name]: variantData.length === 1 ? variantData[0] : variantData }
    }
    return { [variant.name]: null }
  }

  throw new Error(`Unsupported type kind "${kind}" for type "${typeName}"`)
}

// ────────────────────────────────────────────────────────
// Resolve account fields (handles old & new IDL formats)
// ────────────────────────────────────────────────────────

function resolveFields(
  idl: AnchorIDL,
  account: AnchorAccount,
): Array<{ name: string; type: any }> {
  // Old format: account has inline type.fields
  if (account.type?.fields?.length) {
    return account.type.fields.map((f, i) => {
      const normalized = normalizeField(f as any, i)
      return { name: normalized.name, type: normalized.type }
    })
  }

  // New format: look up by account name in idl.types
  const typeDef = idl.types?.find((t) => t.name === account.name)
  if (typeDef?.type?.fields?.length) {
    return typeDef.type.fields.map((f, i) => {
      const normalized = normalizeField(f as any, i)
      return { name: normalized.name, type: normalized.type }
    })
  }

  return []
}

// ────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────

/**
 * Deserialize raw account bytes (after the 8-byte discriminator) into a JSON object.
 * Returns a Record of field name → decoded value.
 * Throws on format mismatch or truncated data.
 */
export function deserializeAccountData(
  rawData: Uint8Array,
  accountDef: AnchorAccount,
  idl: AnchorIDL,
): Record<string, unknown> {
  // Skip the 8-byte Anchor discriminator
  const reader = new BorshReader(rawData, 8)
  const fields = resolveFields(idl, accountDef)

  const result: Record<string, unknown> = {}
  for (const field of fields) {
    result[field.name] = decodeValue(reader, field.type, idl, 0)
  }
  return result
}

// ────────────────────────────────────────────────────────
// Codama account detection & deserialization
// ────────────────────────────────────────────────────────

/** Result of Codama account type detection, including the data start offset. */
export interface CodamaAccountMatch {
  name: string
  data: CodamaTypeNode
  /**
   * Byte offset where serialized field data begins.
   * - 0  for sizeDiscriminatorNode / fieldDiscriminatorNode (no prefix bytes)
   * - 8  for Anchor-style SHA-256 discriminators or byte-based constant discriminators
   */
  startOffset: number
}

/**
 * Find a matching Codama account in the IDL for the given raw on-chain data.
 *
 * Discriminator strategy (in priority order for each account):
 *   1. sizeDiscriminatorNode — match by exact data length; startOffset = 0
 *   2. Explicit byte discriminators — match first N bytes; startOffset = N
 *   3. Anchor-compatible SHA-256("account:<Name>")[:8]; startOffset = 8
 *
 * fieldDiscriminatorNode accounts are skipped for automated detection because
 * verifying the field value requires partial deserialization.
 */
export async function detectCodamaAccountType(
  rawData: Uint8Array,
  idl: CodamaIDL,
): Promise<CodamaAccountMatch | null> {
  const accounts = idl.program.accounts || []
  if (!accounts.length) return null

  for (const account of accounts) {
    const discs = (account.discriminators || []) as Array<Record<string, any>>

    // 1. sizeDiscriminatorNode — match by exact data length, no prefix consumed
    const sizeDisc = discs.find((d) => d.kind === 'sizeDiscriminatorNode')
    if (sizeDisc) {
      if (rawData.length === sizeDisc.size) {
        return { name: account.name, data: account.data, startOffset: 0 }
      }
      // Size discriminator present but doesn't match — skip to next account
      continue
    }

    // 2. fieldDiscriminatorNode — data also starts at 0 but we can't safely detect
    //    without knowing the field type; skip automated detection for this kind
    if (discs.some((d) => d.kind === 'fieldDiscriminatorNode')) continue

    // 3. Explicit constant bytes (e.g., constantDiscriminatorNode with a bytes payload)
    const explicitBytes = discs.flatMap((d) => d.bytes || [])
    if (explicitBytes.length >= 8) {
      if (rawData.length >= 8 && discriminatorsMatch(explicitBytes, rawData.slice(0, 8))) {
        return { name: account.name, data: account.data, startOffset: 8 }
      }
      continue
    }

    // 4. Anchor-compatible fallback: SHA-256("account:<Name>")[:8]
    if (rawData.length >= 8) {
      const computed = await computeAccountDiscriminator(account.name)
      if (discriminatorsMatch(computed, rawData.slice(0, 8))) {
        return { name: account.name, data: account.data, startOffset: 8 }
      }
    }
  }

  return null
}

/**
 * Borsh-decode Codama account data starting at `startOffset`.
 * Use `startOffset = 0` for accounts with sizeDiscriminatorNode (no prefix bytes).
 * Use `startOffset = 8` for Anchor-style 8-byte discriminators (the default).
 */
export function deserializeCodamaAccountData(
  rawData: Uint8Array,
  accountData: CodamaTypeNode,
  idl: CodamaIDL,
  startOffset = 8,
): Record<string, unknown> {
  const reader = new BorshReader(rawData, startOffset)
  return decodeCodamaNode(reader, accountData, idl, 0) as Record<string, unknown>
}

function decodeCodamaNode(reader: BorshReader, type: CodamaTypeNode, idl: CodamaIDL, depth: number): unknown {
  if (depth > 12) throw new Error('Max recursion depth exceeded')
  switch (type.kind) {
    case 'numberTypeNode': {
      switch (type.format) {
        case 'u8':   return reader.readU8()
        case 'u16':  return reader.readU16()
        case 'u32':  return reader.readU32()
        case 'u64':  { const v = reader.readU64(); return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString() }
        case 'u128': return reader.readU128().toString()
        case 'i8':   return reader.readI8()
        case 'i16':  return reader.readI16()
        case 'i32':  return reader.readI32()
        case 'i64':  { const v = reader.readI64(); const abs = v < 0n ? -v : v; return abs <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString() }
        case 'i128': return reader.readI128().toString()
        case 'f32':  return reader.readF32()
        case 'f64':  return reader.readF64()
        default:     return null
      }
    }
    case 'publicKeyTypeNode': return reader.readPublicKey()
    case 'booleanTypeNode':  return reader.readBool()
    case 'stringTypeNode':   return reader.readString()
    case 'bytesTypeNode':    return btoa(String.fromCharCode(...reader.readByteVec()))
    case 'optionTypeNode': {
      const isFixed = (type as any).fixed === true
      const prefix = (type as any).prefix
      // Determine tag size: SPL Token uses u32 COption (4-byte tag), standard Borsh uses u8
      let tag: number
      if (prefix?.format === 'u32') tag = reader.readU32()
      else if (prefix?.format === 'u16') tag = reader.readU16()
      else tag = reader.readU8()
      if (isFixed) {
        // Fixed-size option (COption): item bytes are always present in the data layout.
        // Always decode the item — return null if tag=0, the decoded value if tag != 0.
        const decoded = decodeCodamaNode(reader, type.item, idl, depth + 1)
        return tag === 0 ? null : decoded
      }
      if (tag === 0) return null
      return decodeCodamaNode(reader, type.item, idl, depth + 1)
    }
    case 'zeroableOptionTypeNode': {
      return decodeCodamaNode(reader, type.item, idl, depth + 1)
    }
    case 'arrayTypeNode': {
      let count: number
      if (type.count.kind === 'fixedCountNode') {
        count = type.count.value
      } else if (type.count.kind === 'prefixedCountNode') {
        // Respect the actual prefix type (u8/u16/u32); default to u32 if not specified
        const prefixFormat = (type.count as any).prefix?.format
        if (prefixFormat === 'u8') count = reader.readU8()
        else if (prefixFormat === 'u16') count = reader.readU16()
        else count = reader.readU32()
      } else {
        count = 0 // remainderCountNode — consume remaining bytes as-is
      }
      const arr: unknown[] = []
      for (let i = 0; i < count; i++) arr.push(decodeCodamaNode(reader, type.item, idl, depth + 1))
      return arr
    }
    case 'structTypeNode': {
      const obj: Record<string, unknown> = {}
      for (const field of type.fields) {
        obj[field.name] = decodeCodamaNode(reader, field.type, idl, depth + 1)
      }
      return obj
    }
    case 'enumTypeNode': {
      const idx = reader.readU8()
      const variant = type.variants[idx]
      return variant ? variant.name : idx
    }
    case 'definedTypeLinkNode': {
      const typeDef = (idl.program.definedTypes || []).find((t) => t.name === type.name)
      if (!typeDef) throw new Error(`Type "${type.name}" not found in Codama IDL`)
      return decodeCodamaNode(reader, typeDef.type, idl, depth + 1)
    }
    case 'tupleTypeNode': {
      return type.items.map((item) => decodeCodamaNode(reader, item, idl, depth + 1))
    }
    default:
      return null
  }
}
