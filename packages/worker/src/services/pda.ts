/**
 * PDA (Program Derived Address) Service
 * Derives Solana PDAs from IDL seed definitions.
 * Pure Web Crypto + BigInt — no Node.js deps, Workers-compatible.
 */

import type { AnchorIDL, AnchorInstruction, CodamaIDL, CodamaTypeNode } from './idl-parser'
import { getInstruction, resolveCodamaType } from './idl-parser'

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
          const type = (s as any).type
          return { kind: 'account' as const, name: seedName(s), type }
        }
        if (s.kind === 'account_field') {
          const name = seedName(s)
          const type = (s as any).type
          return { kind: 'account_field' as const, name, type }
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
      const seedType = (s as any).type
      const NUMERIC_TYPES = ['u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'u64', 'i64', 'u128', 'i128']
      if (seedType && NUMERIC_TYPES.includes(seedType)) {
        // Numeric account seed (e.g. { kind: 'account', path: 'round_id', type: 'u64' })
        if (val === undefined || val === null || val === '') {
          throw new Error(`Missing seed value for account "${name}" (expected ${seedType})`)
        }
        const bytes = encodeSeedValue(val, seedType)
        seedBuffers.push(bytes)
        seedInfo.push({ kind: 'account', name, value: val, hex: toHex(bytes) })
      } else {
        // Standard pubkey account seed
        if (!val || typeof val !== 'string') {
          throw new Error(`Missing seed value for account "${name}" (expected base58 public key)`)
        }
        if (!isValidBase58Pubkey(val)) {
          throw new Error(`Invalid public key for account seed "${name}": ${val}`)
        }
        const bytes = base58Decode(val)
        seedBuffers.push(bytes)
        seedInfo.push({ kind: 'account', name, value: val, hex: toHex(bytes) })
      }
      continue
    }

    // account_field: a field inside an account used as a seed (e.g. board.round_id as u64 LE).
    // Callers pass the field value directly; the `type` on the seed tells us how to encode it.
    if (s.kind === 'account_field') {
      const name = seedName(s)
      const val = seedValues[name]
      if (val === undefined || val === null || val === '') {
        throw new Error(`Missing seed value for account_field "${name}"`)
      }
      // `type` may live on the seed itself (new IDL) or be inferred from arg defs
      const seedType = (s as any).type ?? undefined
      const bytes = encodeSeedValue(val, seedType)
      seedBuffers.push(bytes)
      seedInfo.push({ kind: 'account_field', name, value: val, hex: toHex(bytes) })
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

// ────────────────────────────────────────────────────────
// Codama PDA support
// ────────────────────────────────────────────────────────

/**
 * Encode a Codama variable PDA seed value to bytes based on CodamaTypeNode.
 * Reuses encodeSeedValue for numeric/primitive types via the resolved type string.
 */
function encodeCodamaSeedValue(value: any, type: CodamaTypeNode | undefined): Uint8Array {
  if (!type) return new TextEncoder().encode(String(value))
  switch (type.kind) {
    case 'publicKeyTypeNode': return base58Decode(String(value))
    case 'stringTypeNode': return new TextEncoder().encode(String(value))
    case 'booleanTypeNode': return new Uint8Array([value ? 1 : 0])
    case 'numberTypeNode': return encodeSeedValue(value, type.format)
    case 'bytesTypeNode': {
      try { return Uint8Array.from(atob(String(value)), (c) => c.charCodeAt(0)) }
      catch { return new TextEncoder().encode(String(value)) }
    }
    default: return new TextEncoder().encode(String(value))
  }
}

/**
 * List all PDA definitions from a Codama IDL.
 * Collects from two sources:
 *   1. program.pdas — explicit top-level PDA definitions
 *   2. Instruction account nodes whose defaultValue is a pdaValueNode — these
 *      encode PDA-derivable accounts inline on the instruction (common in programs
 *      that omit program.pdas and rely on instruction-level PDA hints instead).
 */
export function listCodamaPdaAccounts(idl: CodamaIDL): PdaAccountInfo[] {
  const results: PdaAccountInfo[] = []

  // ── 1. Explicit program.pdas ───────────────────────────────────────────────
  for (const pda of (idl.program.pdas || [])) {
    const seeds: PdaAccountInfo['seeds'] = (pda.seeds || []).map((s) => {
      if (s.kind === 'constantPdaSeedNode') {
        let description = ''
        if (s.value) {
          const v = s.value as any
          if (v.kind === 'stringValueNode') description = v.string
          else if (v.kind === 'bytesValueNode') description = v.data || ''
          else description = JSON.stringify(v)
        } else if ((s as any).bytes) {
          description = (s as any).bytes
        }
        return { kind: 'const', description }
      }
      if (s.kind === 'variablePdaSeedNode') {
        return { kind: 'arg', name: s.name, type: s.type ? resolveCodamaType(s.type) : undefined }
      }
      if (s.kind === 'programIdPdaSeedNode') {
        return { kind: 'const', description: 'program_id' }
      }
      return { kind: s.kind, name: s.name }
    })
    results.push({ instruction: '', account: pda.name, seeds, customProgram: null })
  }

  // ── 2. Instruction accounts with pdaValueNode ──────────────────────────────
  for (const ix of (idl.program.instructions || [])) {
    for (const acc of (ix.accounts || [])) {
      if ((acc as any).defaultValue?.kind !== 'pdaValueNode') continue
      const pdaValue = (acc as any).defaultValue

      // Resolve the linked program.pdas entry if present
      const linkedPdaName = pdaValue.pda?.kind === 'pdaLinkNode' ? pdaValue.pda.name : null
      const linkedPdaDef = linkedPdaName
        ? (idl.program.pdas || []).find((p) => p.name === linkedPdaName)
        : null

      // Seeds come from the pdaValueNode overrides first, then the linked definition
      const rawSeeds: any[] = (pdaValue.seeds?.length ? pdaValue.seeds : null) || linkedPdaDef?.seeds || []
      const seeds: PdaAccountInfo['seeds'] = rawSeeds.map((s: any) => {
        if (s.kind === 'pdaSeedValueNode') {
          const argDef = (ix.arguments || []).find((a: any) => a.name === s.name)
          return {
            kind: argDef ? 'arg' : 'account',
            name: s.name as string,
            type: argDef ? resolveCodamaType(argDef.type) : undefined,
          }
        }
        if (s.kind === 'constantPdaSeedNode') {
          const v = s.value as any
          const description = v?.kind === 'stringValueNode' ? v.string : (v?.kind === 'bytesValueNode' ? v.data || '' : '')
          return { kind: 'const', description }
        }
        if (s.kind === 'variablePdaSeedNode') {
          const argDef = (ix.arguments || []).find((a: any) => a.name === s.name)
          return {
            kind: 'arg',
            name: s.name as string,
            type: s.type ? resolveCodamaType(s.type) : (argDef ? resolveCodamaType(argDef.type) : undefined),
          }
        }
        if (s.kind === 'programIdPdaSeedNode') {
          return { kind: 'const', description: 'program_id' }
        }
        return { kind: s.kind, name: s.name as string }
      })

      // Skip if already present from program.pdas (by account name + instruction)
      if (!results.some((r) => r.account === acc.name && r.instruction === ix.name)) {
        results.push({ instruction: ix.name, account: acc.name, seeds, customProgram: null })
      }
    }
  }

  return results
}

/** Encode a raw Codama seed entry (constantPdaSeedNode / variablePdaSeedNode / programIdPdaSeedNode)
 *  into a buffer and a description. Used by deriveCodamaPda for both program.pdas and pdaValueNode seeds. */
async function resolveCodamaSeedBuffers(
  seeds: any[],
  programId: string,
  seedValues: Record<string, any>,
  instructionArgs?: any[],
): Promise<{ buffers: Uint8Array[]; info: PdaDerivationResult['seeds'] }> {
  const buffers: Uint8Array[] = []
  const info: PdaDerivationResult['seeds'] = []

  for (const s of seeds) {
    // constantPdaSeedNode
    if (s.kind === 'constantPdaSeedNode') {
      let bytes: Uint8Array
      if (s.value) {
        const v = s.value as any
        if (v.kind === 'stringValueNode') bytes = new TextEncoder().encode(v.string)
        else if (v.kind === 'bytesValueNode') bytes = Uint8Array.from(atob(v.data || ''), (c) => c.charCodeAt(0))
        else bytes = new TextEncoder().encode('')
      } else if (s.bytes) {
        bytes = Uint8Array.from(atob(s.bytes), (c) => c.charCodeAt(0))
      } else {
        bytes = new Uint8Array(0)
      }
      let desc: string
      try { desc = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { desc = `0x${toHex(bytes)}` }
      buffers.push(bytes)
      info.push({ kind: 'const', description: desc, hex: toHex(bytes) })
      continue
    }

    // variablePdaSeedNode
    if (s.kind === 'variablePdaSeedNode') {
      const name = s.name || ''
      const val = seedValues[name]
      if (val === undefined || val === null || val === '') {
        throw new Error(`Missing seed value for "${name}"`)
      }
      const bytes = encodeCodamaSeedValue(val, s.type)
      buffers.push(bytes)
      info.push({ kind: 'arg', name, value: val, hex: toHex(bytes) })
      continue
    }

    // pdaSeedValueNode (from pdaValueNode.seeds — links a named seed to an account/arg value)
    if (s.kind === 'pdaSeedValueNode') {
      const name = s.name || ''
      const val = seedValues[name]
      if (val === undefined || val === null || val === '') {
        throw new Error(`Missing seed value for "${name}"`)
      }
      // Determine encoding from instruction argument type if available
      const argDef = (instructionArgs || []).find((a: any) => a.name === name)
      let bytes: Uint8Array
      if (argDef?.type) {
        bytes = encodeCodamaSeedValue(val, argDef.type)
      } else if (isValidBase58Pubkey(String(val))) {
        bytes = base58Decode(String(val))
      } else {
        bytes = new TextEncoder().encode(String(val))
      }
      buffers.push(bytes)
      info.push({ kind: 'arg', name, value: val, hex: toHex(bytes) })
      continue
    }

    // programIdPdaSeedNode
    if (s.kind === 'programIdPdaSeedNode') {
      const bytes = base58Decode(programId)
      buffers.push(bytes)
      info.push({ kind: 'const', description: 'program_id', hex: toHex(bytes) })
      continue
    }
    // Unknown seed kinds skipped
  }

  return { buffers, info }
}

/**
 * Derive a PDA from a Codama IDL.
 *
 * Lookup order for `pdaName`:
 *   1. program.pdas — explicit top-level PDA definitions
 *   2. Instruction account nodes with `defaultValue.kind === 'pdaValueNode'`
 *      where the account name matches `pdaName` (from any instruction)
 *
 * `seedValues` is a map of seed-name → value for all variable/arg seeds.
 */
export async function deriveCodamaPda(
  idl: CodamaIDL,
  programId: string,
  pdaName: string,
  seedValues: Record<string, any>,
): Promise<PdaDerivationResult> {
  // ── 1. program.pdas ──────────────────────────────────────────────────────
  const pdaDef = (idl.program.pdas || []).find((p) => p.name === pdaName)
  if (pdaDef) {
    const { buffers, info } = await resolveCodamaSeedBuffers(pdaDef.seeds || [], programId, seedValues)
    const [pdaBytes, bump] = await findProgramAddress(buffers, base58Decode(programId))
    return { pda: base58Encode(pdaBytes), bump, programId, seeds: info }
  }

  // ── 2. Instruction account pdaValueNode ───────────────────────────────────
  for (const ix of (idl.program.instructions || [])) {
    const acc = (ix.accounts || []).find(
      (a: any) => a.name === pdaName && a.defaultValue?.kind === 'pdaValueNode',
    )
    if (!acc) continue

    const pdaValue = (acc as any).defaultValue

    // Resolve linked program.pdas if referenced
    const linkedPdaName = pdaValue.pda?.kind === 'pdaLinkNode' ? pdaValue.pda.name : null
    const linkedPdaDef = linkedPdaName
      ? (idl.program.pdas || []).find((p) => p.name === linkedPdaName)
      : null

    const rawSeeds: any[] = (pdaValue.seeds?.length ? pdaValue.seeds : null) || linkedPdaDef?.seeds || []
    const { buffers, info } = await resolveCodamaSeedBuffers(
      rawSeeds,
      programId,
      seedValues,
      ix.arguments,
    )
    const [pdaBytes, bump] = await findProgramAddress(buffers, base58Decode(programId))
    return { pda: base58Encode(pdaBytes), bump, programId, seeds: info }
  }

  throw new Error(`PDA "${pdaName}" not found in IDL (checked program.pdas and instruction pdaValueNode accounts)`)
}
