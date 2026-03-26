/**
 * On-chain Anchor IDL Fetcher
 * Fetches Anchor IDL from Solana on-chain accounts.
 * Pure Web Crypto — no Node.js deps, Workers-compatible.
 */

import { validateIDL } from './idl-parser'

// ── Base58 helpers (self-contained) ──────────────────

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

// ── Ed25519 curve check (needed for PDA derivation) ──

const ED25519_P = 57896044618658097711785492504343953926634992332820282019728792003956564819949n
const ED25519_D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n

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

function isOnCurve(point: Uint8Array): boolean {
  if (point.length !== 32) return false
  const yBytes = new Uint8Array(point)
  const signBit = (yBytes[31] >> 7) & 1
  yBytes[31] &= 0x7f
  let y = 0n
  for (let i = 0; i < 32; i++) y |= BigInt(yBytes[i]) << BigInt(i * 8)
  if (y >= ED25519_P) return false
  const y2 = (y * y) % ED25519_P
  const num = (y2 - 1n + ED25519_P) % ED25519_P
  const den = ((ED25519_D * y2) % ED25519_P + 1n) % ED25519_P
  const denInv = modPow(den, ED25519_P - 2n, ED25519_P)
  const x2 = (num * denInv) % ED25519_P
  if (x2 === 0n) return signBit === 0
  return modPow(x2, (ED25519_P - 1n) / 2n, ED25519_P) === 1n
}

const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress')

async function createProgramAddress(
  seeds: Uint8Array[],
  programId: Uint8Array,
): Promise<Uint8Array> {
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
  throw new Error('Could not find a valid PDA')
}

// ── createWithSeed (for Anchor IDL account address) ──

async function createWithSeed(
  base: Uint8Array,
  seed: string,
  programId: Uint8Array,
): Promise<Uint8Array> {
  const seedBytes = new TextEncoder().encode(seed)
  const buf = new Uint8Array(base.length + seedBytes.length + programId.length)
  buf.set(base, 0)
  buf.set(seedBytes, base.length)
  buf.set(programId, base.length + seedBytes.length)
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf))
}

// ── Anchor IDL account address derivation ──

async function getIdlAccountAddress(programIdStr: string): Promise<string> {
  const programIdBytes = base58Decode(programIdStr)

  // base = findProgramAddress([], programId)
  const [base] = await findProgramAddress([], programIdBytes)

  // idlAddress = createWithSeed(base, "anchor:idl", programId)
  const idlAddress = await createWithSeed(base, 'anchor:idl', programIdBytes)

  return base58Encode(idlAddress)
}

// ── Decompress on-chain IDL data ──

async function decompressData(data: Uint8Array): Promise<string> {
  // Try inflate (zlib raw) first — most common in Anchor on-chain IDLs
  try {
    const ds = new DecompressionStream('deflate-raw')
    const writer = ds.writable.getWriter()
    const reader = ds.readable.getReader()

    const writePromise = writer.write(data as unknown as BufferSource).then(() => writer.close())
    const chunks: Uint8Array[] = []
    let totalLen = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      totalLen += value.length
    }

    await writePromise

    const result = new Uint8Array(totalLen)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }

    return new TextDecoder().decode(result)
  } catch {
    // Fallback: try deflate (with zlib header)
    try {
      const ds = new DecompressionStream('deflate')
      const writer = ds.writable.getWriter()
      const reader = ds.readable.getReader()

      const writePromise = writer.write(data as unknown as BufferSource).then(() => writer.close())
      const chunks: Uint8Array[] = []
      let totalLen = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        totalLen += value.length
      }

      await writePromise

      const result = new Uint8Array(totalLen)
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.length
      }

      return new TextDecoder().decode(result)
    } catch {
      // Fallback: try gzip
      try {
        const ds = new DecompressionStream('gzip')
        const writer = ds.writable.getWriter()
        const reader = ds.readable.getReader()

        const writePromise = writer.write(data as unknown as BufferSource).then(() => writer.close())
        const chunks: Uint8Array[] = []
        let totalLen = 0

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          totalLen += value.length
        }

        await writePromise

        const result = new Uint8Array(totalLen)
        let offset = 0
        for (const chunk of chunks) {
          result.set(chunk, offset)
          offset += chunk.length
        }

        return new TextDecoder().decode(result)
      } catch {
        // Last resort: maybe it's not compressed at all
        return new TextDecoder().decode(data)
      }
    }
  }
}

// ── Main: fetch Anchor IDL from on-chain ──

export async function fetchAnchorIDLFromChain(
  programId: string,
  rpcUrl: string,
): Promise<{ idl: any; idlJson: string } | null> {
  try {
    // 1. Compute IDL account address
    const idlAddress = await getIdlAccountAddress(programId)

    // 2. Fetch account data via RPC
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [
          idlAddress,
          { encoding: 'base64', commitment: 'confirmed' },
        ],
      }),
    })

    const rpcResult = await response.json() as any

    if (!rpcResult.result?.value?.data) {
      return null // No IDL account found
    }

    // 3. Decode base64 account data
    const base64Data = rpcResult.result.value.data[0]
    const rawBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))

    // 4. Skip Anchor discriminator (8 bytes) + authority pubkey (32 bytes)
    //    Then read u32 LE data length
    if (rawBytes.length < 44) {
      return null // Too short to be a valid IDL account
    }

    const dataOffset = 8 + 32 // discriminator + authority
    const dataLength = rawBytes[dataOffset] |
      (rawBytes[dataOffset + 1] << 8) |
      (rawBytes[dataOffset + 2] << 16) |
      (rawBytes[dataOffset + 3] << 24)

    const compressedData = rawBytes.slice(dataOffset + 4, dataOffset + 4 + dataLength)

    // 5. Decompress
    const idlJson = await decompressData(compressedData)

    // 6. Parse and validate
    let idl: any
    try {
      idl = JSON.parse(idlJson)
    } catch {
      return null // Invalid JSON
    }

    const validation = validateIDL(idl)
    if (!validation.valid) {
      return null // Invalid IDL structure
    }

    return { idl, idlJson: JSON.stringify(idl) }
  } catch {
    return null
  }
}
