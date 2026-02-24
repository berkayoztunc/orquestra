/**
 * PDA (Program Derived Address) Service
 * Derives Solana PDAs from IDL seed definitions.
 * Pure Web Crypto + BigInt — no Node.js deps, Workers-compatible.
 */

import type { AnchorIDL, AnchorInstruction } from './idl-parser'
import { getInstruction } from './idl-parser'

// ────────────────────────────────────────────────────────
// Ed25519 curve check  (GF(2^255 − 19))
// ────────────────────────────────────────────────────────

const ED25519_P = 57896044618658097711785492504343953926634992332820282019728792003956564819949n // 2^255 - 19
const ED25519_D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n // -121665/121666 mod P

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n
  base = ((base % mod) + mod) % mod
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod
    exp >>= 1n
    base = (base * base) % mod
  }
  return result
}

/**
 * Check whether a 32-byte value is a valid ed25519 curve point.
 * PDA addresses must NOT be on the curve.
 */
function isOnCurve(point: Uint8Array): boolean {
  if (point.length !== 32) return false

  // Decode y (little-endian, lower 255 bits)
  const yBytes = new Uint8Array(point)
  const signBit = (yBytes[31] >> 7) & 1
  yBytes[31] &= 0x7f
  let y = 0n
  for (let i = 0; i < 32; i++) y |= BigInt(yBytes[i]) << BigInt(i * 8)
  if (y >= ED25519_P) return false

  // x² = (y² − 1) / (d·y² + 1)  mod p
  const y2 = (y * y) % ED25519_P
  const num = (y2 - 1n + ED25519_P) % ED25519_P
  const den = ((ED25519_D * y2) % ED25519_P + 1n) % ED25519_P
  const denInv = modPow(den, ED25519_P - 2n, ED25519_P)
  const x2 = (num * denInv) % ED25519_P

  if (x2 === 0n) return signBit === 0

  // Euler criterion: QR iff x2^((p-1)/2) ≡ 1
  return modPow(x2, (ED25519_P - 1n) / 2n, ED25519_P) === 1n
}

// ────────────────────────────────────────────────────────
// createProgramAddress / findProgramAddress
// ────────────────────────────────────────────────────────

const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress')

async function createProgramAddress(
  seeds: Uint8Array[],
  programId: Uint8Array,
): Promise<Uint8Array> {
  for (const seed of seeds) {
    if (seed.length > 32) throw new Error(`Seed exceeds 32 bytes (got ${seed.length})`)
  }

  let totalLen = 0
  for (const s of seeds) totalLen += s.length
  totalLen += programId.length + PDA_MARKER.length

  const buf = new Uint8Array(totalLen)
  let off = 0
  for (const s of seeds) { buf.set(s, off); off += s.length }
  buf.set(programId, off); off += programId.length
  buf.set(PDA_MARKER, off)

  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buf))
  if (isOnCurve(hash)) throw new Error('Point is on the ed25519 curve')
  return hash
}

async function findProgramAddress(
  seeds: Uint8Array[],
  programId: Uint8Array,
): Promise<[Uint8Array, number]> {
  for (let bump = 255; bump >= 0; bump--) {
    try {
      const addr = await createProgramAddress(
        [...seeds, new Uint8Array([bump])],
        programId,
      )
      return [addr, bump]
    } catch {
      continue
    }
  }
  throw new Error('Could not find a valid PDA (exhausted all 256 bumps)')
}

// ────────────────────────────────────────────────────────
// Base58 helpers  (self-contained, no external deps)
// ────────────────────────────────────────────────────────

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function base58Decode(str: string): Uint8Array {
  const bytes: number[] = []
  for (const c of str) {
    const idx = B58.indexOf(c)
    if (idx === -1) throw new Error(`Invalid base58 character: ${c}`)
    let carry = idx
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58
      bytes[j] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8 }
  }
  for (const c of str) { if (c !== '1') break; bytes.push(0) }
  return new Uint8Array(bytes.reverse())
}

function base58Encode(bytes: Uint8Array): string {
  let leadingZeros = 0
  for (const b of bytes) { if (b !== 0) break; leadingZeros++ }
  const digits: number[] = []
  for (const byte of bytes) {
    let carry = byte
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0
    }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0 }
  }
  let result = '1'.repeat(leadingZeros)
  for (let i = digits.length - 1; i >= 0; i--) result += B58[digits[i]]
  return result
}

function isValidBase58Pubkey(str: string): boolean {
  if (!str || str.length < 32 || str.length > 44) return false
  for (const c of str) { if (B58.indexOf(c) === -1) return false }
  return true
}

function toHex(arr: Uint8Array): string {
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ────────────────────────────────────────────────────────
// Seed resolution from IDL
// ────────────────────────────────────────────────────────

/** Unified seed descriptor from both old and new Anchor IDL formats. */
interface RawSeed {
  kind: string
  value?: any       // byte[] (new) or string (old) for const; string for old arg/account
  path?: string     // new format arg/account name
}

/** Encode seed bytes from a const IDL seed. */
function constSeedToBytes(seed: RawSeed): { bytes: Uint8Array; description: string } {
  if (Array.isArray(seed.value)) {
    const bytes = new Uint8Array(seed.value)
    let desc: string
    try { desc = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { desc = `0x${toHex(bytes)}` }
    return { bytes, description: desc }
  }
  // Old format: value is a string
  const str = String(seed.value ?? '')
  return { bytes: new TextEncoder().encode(str), description: str }
}

/** Get the name / path for an arg or account seed (works with both IDL formats). */
function seedName(seed: RawSeed): string {
  return seed.path || (typeof seed.value === 'string' ? seed.value : '') || ''
}

/**
 * Encode a user-supplied value into seed bytes based on arg type.
 * For PDA seeds, strings are raw UTF-8 (no length prefix) and
 * numbers are LE with the same width as the type.
 */
function encodeSeedValue(value: any, argType: any): Uint8Array {
  const t = typeof argType === 'string' ? argType : ''

  // String → raw UTF-8
  if (t === 'string') return new TextEncoder().encode(String(value))

  // Public key
  if (t === 'publicKey' || t === 'pubkey') return base58Decode(String(value))

  // Unsigned / signed integers
  const intTypes: Record<string, number> = {
    u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4,
    u64: 8, i64: 8, u128: 16, i128: 16,
  }
  if (intTypes[t]) {
    const size = intTypes[t]
    const v = BigInt(value)
    const buf = new Uint8Array(size)
    for (let i = 0; i < size; i++) buf[i] = Number((v >> BigInt(i * 8)) & 0xffn)
    return buf
  }

  // Bool
  if (t === 'bool') return new Uint8Array([value ? 1 : 0])

  // Fallback: treat as raw UTF-8
  return new TextEncoder().encode(String(value))
}

// ────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────

/** Describes one PDA-enabled account for the listing endpoint. */
export interface PdaAccountInfo {
  instruction: string
  account: string
  seeds: Array<{
    kind: string
    name?: string
    description?: string
    type?: string
  }>
  customProgram: string | null
}

/** Scan the IDL and return every account that has PDA seed metadata. */
export function listPdaAccounts(idl: AnchorIDL): PdaAccountInfo[] {
  const results: PdaAccountInfo[] = []

  for (const ix of idl.instructions) {
    for (const acc of ix.accounts as any[]) {
      if (!acc.pda?.seeds || acc.pda.seeds.length === 0) continue

      const seeds = (acc.pda.seeds as RawSeed[]).map((s) => {
        if (s.kind === 'const') {
          const { description } = constSeedToBytes(s)
          return { kind: 'const' as const, description }
        }
        if (s.kind === 'arg') {
          const name = seedName(s)
          const argDef = ix.args?.find((a: any) => a.name === name)
          const type = argDef ? (typeof argDef.type === 'string' ? argDef.type : JSON.stringify(argDef.type)) : undefined
          return { kind: 'arg' as const, name, type }
        }
        if (s.kind === 'account') {
          return { kind: 'account' as const, name: seedName(s) }
        }
        return { kind: s.kind }
      })

      // Custom program (cross-program PDA, e.g. ATA)
      let customProgram: string | null = null
      if (acc.pda.program) {
        const prog = acc.pda.program
        if (Array.isArray(prog.value)) {
          customProgram = base58Encode(new Uint8Array(prog.value))
        } else if (typeof prog.value === 'string') {
          customProgram = prog.value
        }
      }

      results.push({
        instruction: ix.name,
        account: acc.name,
        seeds,
        customProgram,
      })
    }
  }

  return results
}

/** Result from a PDA derivation. */
export interface PdaDerivationResult {
  pda: string
  bump: number
  programId: string
  seeds: Array<{
    kind: string
    name?: string
    description?: string
    value?: any
    hex: string
  }>
}

/**
 * Derive a PDA for a specific instruction account.
 *
 * @param idl           Parsed IDL
 * @param programId     Program address (base58)
 * @param instruction   Instruction name
 * @param accountName   Account name within the instruction
 * @param seedValues    User-supplied values keyed by arg/account name
 */
export async function derivePda(
  idl: AnchorIDL,
  programId: string,
  instruction: string,
  accountName: string,
  seedValues: Record<string, any>,
): Promise<PdaDerivationResult> {
  const ix = getInstruction(idl, instruction)
  if (!ix) throw new Error(`Instruction "${instruction}" not found in IDL`)

  const acc = (ix.accounts as any[]).find((a: any) => a.name === accountName)
  if (!acc) throw new Error(`Account "${accountName}" not found in instruction "${instruction}"`)
  if (!acc.pda?.seeds?.length) throw new Error(`Account "${accountName}" has no PDA seeds`)

  const rawSeeds: RawSeed[] = acc.pda.seeds
  const seedBuffers: Uint8Array[] = []
  const seedInfo: PdaDerivationResult['seeds'] = []

  for (const s of rawSeeds) {
    if (s.kind === 'const') {
      const { bytes, description } = constSeedToBytes(s)
      seedBuffers.push(bytes)
      seedInfo.push({ kind: 'const', description, hex: toHex(bytes) })
      continue
    }

    if (s.kind === 'arg') {
      const name = seedName(s)
      const val = seedValues[name]
      if (val === undefined || val === null || val === '') {
        throw new Error(`Missing seed value for arg "${name}"`)
      }
      const argDef = ix.args?.find((a: any) => a.name === name)
      const bytes = encodeSeedValue(val, argDef?.type)
      seedBuffers.push(bytes)
      seedInfo.push({ kind: 'arg', name, value: val, hex: toHex(bytes) })
      continue
    }

    if (s.kind === 'account') {
      const name = seedName(s)
      const val = seedValues[name]
      if (!val || typeof val !== 'string') {
        throw new Error(`Missing seed value for account "${name}" (expected base58 public key)`)
      }
      if (!isValidBase58Pubkey(val)) {
        throw new Error(`Invalid public key for account seed "${name}": ${val}`)
      }
      const bytes = base58Decode(val)
      seedBuffers.push(bytes)
      seedInfo.push({ kind: 'account', name, value: val, hex: toHex(bytes) })
      continue
    }

    throw new Error(`Unknown seed kind: ${s.kind}`)
  }

  // Determine the program to derive against
  let deriveProgramId = programId
  if (acc.pda.program) {
    const prog = acc.pda.program
    if (Array.isArray(prog.value)) {
      deriveProgramId = base58Encode(new Uint8Array(prog.value))
    } else if (typeof prog.value === 'string') {
      deriveProgramId = prog.value
    }
  }

  const programBytes = base58Decode(deriveProgramId)
  const [pdaBytes, bump] = await findProgramAddress(seedBuffers, programBytes)

  return {
    pda: base58Encode(pdaBytes),
    bump,
    programId: deriveProgramId,
    seeds: seedInfo,
  }
}
