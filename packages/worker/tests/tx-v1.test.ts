import { describe, test, expect } from 'bun:test'
import {
  buildUnsignedV1Transaction,
  finalizeV1Transaction,
  fitsInOneV1Transaction,
  normalizeTxConfig,
  validateTxOptions,
  parseTxVersion,
  resolveWireEncoding,
  assertV1StructuralLimits,
  TxOptionError,
  MAX_COMPUTE_UNIT_LIMIT,
  MAX_LOADED_ACCOUNTS_DATA_SIZE,
  type GenericInstruction,
} from '../src/services/tx-v1'

const PAYER = '11111111111111111111111111111111'
const PROGRAM = 'ComputeBudget111111111111111111111111111111' // any valid program-id-shaped address
const BLOCKHASH = '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM'

function ix(accounts = 1, data = [1, 2, 3]): GenericInstruction {
  return {
    programId: PROGRAM,
    keys: [
      { pubkey: PAYER, isSigner: true, isWritable: true },
      ...Array.from({ length: accounts }, (_, i) => ({ pubkey: fakeKey(i), isSigner: false, isWritable: false })),
    ],
    data: Uint8Array.from(data),
  }
}

/** Deterministic distinct valid base58 32-byte keys. */
function fakeKey(i: number): string {
  // Sysvar-like addresses are fixed; derive distinct valid keys by using known-good ones first, then PDAs-shaped strings.
  const known = [
    'SysvarRent111111111111111111111111111111111',
    'SysvarC1ock11111111111111111111111111111111',
    'SysvarRecentB1ockHashes11111111111111111111',
    'SysvarS1otHashes111111111111111111111111111',
    'Sysvar1nstructions1111111111111111111111111',
  ]
  if (i < known.length) return known[i]!
  // base58 of a 32-byte buffer with index in the last bytes
  const bytes = new Uint8Array(32)
  bytes[0] = 1
  bytes[30] = (i >> 8) & 0xff
  bytes[31] = i & 0xff
  return b58(bytes)
}

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function b58(bytes: Uint8Array): string {
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  let out = ''
  while (n > 0n) { out = ALPHABET[Number(n % 58n)]! + out; n /= 58n }
  for (const b of bytes) { if (b === 0) out = '1' + out; else break }
  return out
}

async function decode(bytes: Uint8Array) {
  const kit = await import('@solana/kit')
  const tx = kit.getTransactionDecoder().decode(bytes)
  const msg: any = kit.getCompiledTransactionMessageDecoder().decode(tx.messageBytes)
  return { tx, msg }
}

describe('buildUnsignedV1Transaction', () => {
  test('emits a v1 wire transaction (version byte 0x81, config mask + values, blockhash lifetime)', async () => {
    const built = await buildUnsignedV1Transaction({
      feePayer: PAYER,
      instructions: [ix()],
      blockhash: BLOCKHASH,
      config: { priorityFeeLamports: 5000n, computeUnitLimit: 20_000, loadedAccountsDataSizeLimit: 65_536 },
    })
    expect(built.bytes[0]).toBe(0x81)
    expect(built.signerCount).toBe(1)

    const { msg } = await decode(built.bytes)
    expect(msg.configMask).toBe(0b1111) // priority fee (bits 0-1) + CU limit (bit 2) + loaded accounts (bit 3)
    expect(msg.configValues.map((v: any) => v.kind)).toEqual(['u64', 'u32', 'u32'])
    expect(msg.lifetimeToken).toBe(BLOCKHASH)
    expect(msg.header.numSignerAccounts).toBe(1)
  })

  test('never emits ComputeBudget instructions of its own', async () => {
    const built = await buildUnsignedV1Transaction({
      feePayer: PAYER,
      instructions: [ix()],
      blockhash: BLOCKHASH,
      config: { computeUnitLimit: 1000, loadedAccountsDataSizeLimit: 1000 },
    })
    const { msg } = await decode(built.bytes)
    expect(msg.numInstructions).toBe(1) // only the caller's instruction, no injected budget ix
  })

  test('rejects more than 64 inline accounts with an actionable ALT hint', async () => {
    await expect(
      buildUnsignedV1Transaction({ feePayer: PAYER, instructions: [ix(70)], blockhash: BLOCKHASH }),
    ).rejects.toThrow(/at most 64 inline accounts.*txVersion "v0"/s)
  })

  test('rejects a transaction over 4096 bytes', async () => {
    await expect(
      buildUnsignedV1Transaction({
        feePayer: PAYER,
        instructions: [ix(1, Array.from({ length: 4200 }, () => 7))],
        blockhash: BLOCKHASH,
      }),
    ).rejects.toThrow(/over the 4096-byte limit/)
  })

  test('accepts a payload between 1232 and 4096 bytes (the point of v1)', async () => {
    const built = await buildUnsignedV1Transaction({
      feePayer: PAYER,
      instructions: [ix(1, Array.from({ length: 3000 }, () => 7))],
      blockhash: BLOCKHASH,
    })
    expect(built.bytes.length).toBeGreaterThan(1232)
    expect(built.bytes.length).toBeLessThanOrEqual(4096)
  })

  test('rejects zero instructions and >64 instructions', async () => {
    await expect(buildUnsignedV1Transaction({ feePayer: PAYER, instructions: [], blockhash: BLOCKHASH })).rejects.toThrow(TxOptionError)
    expect(() => assertV1StructuralLimits(PAYER, Array.from({ length: 65 }, () => ix()))).toThrow(/at most 64 instructions/)
  })
})

describe('fitsInOneV1Transaction', () => {
  test('true for a small tx, false for an oversized one', async () => {
    expect(await fitsInOneV1Transaction({ feePayer: PAYER, instructions: [ix()], blockhash: BLOCKHASH })).toBe(true)
    expect(
      await fitsInOneV1Transaction({ feePayer: PAYER, instructions: [ix(1, Array.from({ length: 4200 }, () => 1))], blockhash: BLOCKHASH }),
    ).toBe(false)
  })
})

describe('finalizeV1Transaction (resource limits are never left unset)', () => {
  test('measures limits via simulation, adds a 10% margin and rebuilds', async () => {
    const calls: string[] = []
    const out = await finalizeV1Transaction({
      feePayer: PAYER,
      instructions: [ix()],
      blockhash: BLOCKHASH,
      simulate: async (b64) => {
        calls.push(b64)
        return { err: null, logs: [], unitsConsumed: 10_000, loadedAccountsDataSize: 200_000 }
      },
    })
    expect(calls).toHaveLength(1)
    expect(out.config.computeUnitLimit).toBe(11_000)
    expect(out.config.loadedAccountsDataSizeLimit).toBe(229_376) // 220_000 (+10%) rounded up to a 32 KiB page
    const { msg } = await decode(out.bytes)
    const values = msg.configValues.map((v: any) => Number(v.value))
    expect(values).toContain(11_000)
    expect(values).toContain(229_376)
  })

  test('falls back to protocol maxima when simulation fails or is unavailable', async () => {
    const failing = await finalizeV1Transaction({
      feePayer: PAYER, instructions: [ix()], blockhash: BLOCKHASH,
      simulate: async () => ({ err: 'boom', logs: [] }),
    })
    expect(failing.config.computeUnitLimit).toBe(MAX_COMPUTE_UNIT_LIMIT)
    expect(failing.config.loadedAccountsDataSizeLimit).toBe(MAX_LOADED_ACCOUNTS_DATA_SIZE)
    expect(failing.notes.join(' ')).toMatch(/protocol maximum/)

    const noSim = await finalizeV1Transaction({ feePayer: PAYER, instructions: [ix()], blockhash: BLOCKHASH })
    expect(noSim.config.computeUnitLimit).toBe(MAX_COMPUTE_UNIT_LIMIT)
  })

  test('honours caller-supplied limits and skips measuring when both are given', async () => {
    let simulated = false
    const out = await finalizeV1Transaction({
      feePayer: PAYER, instructions: [ix()], blockhash: BLOCKHASH,
      config: { computeUnitLimit: 30_000, loadedAccountsDataSizeLimit: 100_000, priorityFeeLamports: 7n },
      simulate: async () => { simulated = true; return { err: null, logs: [] } },
    })
    expect(simulated).toBe(false)
    expect(out.config.computeUnitLimit).toBe(30_000)
  })
})

describe('txVersion / txConfig validation', () => {
  test('parseTxVersion accepts the three versions, undefined, and rejects the rest', () => {
    expect(parseTxVersion(undefined)).toBeUndefined()
    expect(parseTxVersion('v1')).toBe('v1')
    expect(parseTxVersion('legacy')).toBe('legacy')
    expect(() => parseTxVersion('v2')).toThrow(TxOptionError)
    expect(() => parseTxVersion(1)).toThrow(TxOptionError)
  })

  test('txConfig without txVersion v1 is an error, never silently ignored', () => {
    expect(() => validateTxOptions({ txConfig: { computeUnitLimit: 1 } })).toThrow(/only applies to txVersion "v1"/)
    expect(() => validateTxOptions({ txVersion: 'v0', txConfig: { computeUnitLimit: 1 } })).toThrow(TxOptionError)
  })

  test('no options → no opinion (callers keep their defaults)', () => {
    expect(validateTxOptions({})).toEqual({ txVersion: undefined, txConfig: undefined })
  })

  test('TX_V1_DISABLED kill switch rejects v1 only', () => {
    expect(() => validateTxOptions({ txVersion: 'v1', env: { TX_V1_DISABLED: '1' } })).toThrow(/disabled/)
    expect(validateTxOptions({ txVersion: 'v0', env: { TX_V1_DISABLED: '1' } }).txVersion).toBe('v0')
    expect(validateTxOptions({ txVersion: 'v1', env: { TX_V1_DISABLED: '0' } }).txVersion).toBe('v1')
  })

  test('normalizeTxConfig is strict', () => {
    expect(normalizeTxConfig({ priorityFeeLamports: '5000', heapSize: 65_536 })).toEqual({ priorityFeeLamports: 5000n, heapSize: 65_536 })
    expect(() => normalizeTxConfig({ heapSize: 1000 })).toThrow(TxOptionError)
    expect(() => normalizeTxConfig({ heapSize: 32 * 1024 + 1 })).toThrow(/multiple of 1024/)
    expect(() => normalizeTxConfig({ computeUnitLimit: 2_000_000 })).toThrow(TxOptionError)
    expect(() => normalizeTxConfig({ priorityFeeLamports: -1 })).toThrow(TxOptionError)
    expect(() => normalizeTxConfig({ microLamports: 1 })).toThrow(/Unknown txConfig field/)
  })
})

describe('resolveWireEncoding', () => {
  test('v1 defaults to base64, legacy/v0 keep base58', () => {
    expect(resolveWireEncoding(undefined, 'v1', 2000)).toBe('base64')
    expect(resolveWireEncoding(undefined, 'legacy', 400)).toBe('base58')
    expect(resolveWireEncoding(undefined, 'v0', 400)).toBe('base58')
  })
  test('explicit base58 over 1232 bytes is rejected; explicit choices are honoured otherwise', () => {
    expect(() => resolveWireEncoding('base58', 'v1', 2000)).toThrow(/limited to 1232 bytes/)
    expect(resolveWireEncoding('base58', 'v1', 1000)).toBe('base58')
    expect(resolveWireEncoding('base64', 'v1', 2000)).toBe('base64')
  })
})
