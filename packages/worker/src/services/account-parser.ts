/**
 * Account Parser Service
 * Detects Anchor account types from raw on-chain data and deserializes them
 * using the project's IDL field definitions.
 *
 * Pure Web Crypto + BigInt — no Node.js deps, Workers-compatible.
 */

import type { AnchorIDL, AnchorAccount, AnchorType } from './idl-parser'
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
