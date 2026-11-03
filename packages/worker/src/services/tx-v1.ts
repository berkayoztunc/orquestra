/**
 * Solana Transaction v1 (SIMD-0385 + SIMD-0296) support.
 *
 * v1 is strictly OPT-IN everywhere in Orquestra: callers pass `txVersion: 'v1'`.
 * Without it the builders behave exactly as before (buildTransaction → legacy,
 * composeTransaction / flows → v0).
 *
 * What differs from legacy/v0 (and why this module exists):
 *  - size limit 4096 bytes (vs 1232), up to 64 inline accounts, NO address lookup tables
 *  - compute-unit limit, priority fee (TOTAL lamports, not micro-lamports/CU) and
 *    loaded-accounts limit live in the message `config`, never in ComputeBudget
 *    instructions (those are no-ops on v1). Unset limits default to ZERO on v1, so
 *    they must always be written — see finalizeV1Transaction().
 *
 * Serialization uses the official `@solana/kit` v8 codecs (loaded lazily so the
 * legacy/v0 paths never pay for it).
 */

export type TxVersion = 'legacy' | 'v0' | 'v1'
export const TX_VERSIONS: readonly TxVersion[] = ['legacy', 'v0', 'v1']

/** SIMD-0385 "Transaction Constraints" table. */
export const V1_MAX_TX_BYTES = 4096
export const V1_MAX_ACCOUNTS = 64
export const V1_MAX_INSTRUCTIONS = 64
export const V1_MAX_SIGNATURES = 12
export const V1_MAX_ACCOUNTS_PER_INSTRUCTION = 255

/** Packet limit for legacy / v0 transactions (and for base58-encoded payloads on RPC). */
export const LEGACY_MAX_TX_BYTES = 1232

/** Protocol maxima — used when limits cannot be measured. */
export const MAX_COMPUTE_UNIT_LIMIT = 1_400_000
export const MAX_LOADED_ACCOUNTS_DATA_SIZE = 64 * 1024 * 1024

const MIN_HEAP_SIZE = 32 * 1024
const MAX_HEAP_SIZE = 256 * 1024
const U64_MAX = (1n << 64n) - 1n
const U32_MAX = 0xffff_ffff

/** +10% safety margin on measured usage (integer math — avoids float drift like 200000 * 1.1 = 220000.00000000003). */
const withMargin = (n: number): number => Math.ceil((n * 11) / 10)

export interface TxV1Config {
  /** TOTAL priority fee in lamports (not a per-CU price). Omit for 0. */
  priorityFeeLamports?: number | string | bigint
  computeUnitLimit?: number
  loadedAccountsDataSizeLimit?: number
  /** Multiple of 1024 between 32 KiB and 256 KiB. */
  heapSize?: number
}

/** Neutral instruction shape (decoupled from web3.js / kit). */
export interface GenericInstruction {
  programId: string
  keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>
  data: Uint8Array
}

/** Bad `txVersion` / `txConfig` input. Routes map this to HTTP 400, MCP tools to an error result. */
export class TxOptionError extends Error {
  readonly code = 'TX_OPTION_INVALID'
  constructor(message: string) {
    super(message)
    this.name = 'TxOptionError'
  }
}

// ─── Option validation (shared by MCP / REST / Flow Engine) ───────────────────

export function isTxV1Disabled(env: { TX_V1_DISABLED?: string } | undefined | null): boolean {
  return env?.TX_V1_DISABLED === '1'
}

/** Parses a caller-supplied version. `undefined`/`null` → undefined (caller applies its own default). */
export function parseTxVersion(raw: unknown): TxVersion | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'string' && (TX_VERSIONS as readonly string[]).includes(raw)) return raw as TxVersion
  throw new TxOptionError(`Invalid txVersion ${JSON.stringify(raw)} — expected one of: ${TX_VERSIONS.join(', ')}`)
}

const TX_CONFIG_KEYS = ['priorityFeeLamports', 'computeUnitLimit', 'loadedAccountsDataSizeLimit', 'heapSize'] as const

function assertIntInRange(name: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new TxOptionError(`txConfig.${name} must be an integer between ${min} and ${max} (got ${JSON.stringify(value)})`)
  }
  return value
}

/** Strict validation of a v1 config object. Unknown keys are rejected rather than silently ignored. */
export function normalizeTxConfig(raw: unknown): TxV1Config {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new TxOptionError('txConfig must be an object')
  const input = raw as Record<string, unknown>
  for (const key of Object.keys(input)) {
    if (!(TX_CONFIG_KEYS as readonly string[]).includes(key)) {
      throw new TxOptionError(`Unknown txConfig field "${key}" — allowed: ${TX_CONFIG_KEYS.join(', ')}`)
    }
  }

  const out: TxV1Config = {}
  if (input.priorityFeeLamports !== undefined) {
    let fee: bigint
    try {
      const v = input.priorityFeeLamports
      if (typeof v === 'number' && !Number.isSafeInteger(v)) throw new Error('not a safe integer')
      fee = BigInt(v as number | string | bigint)
    } catch {
      throw new TxOptionError(`txConfig.priorityFeeLamports must be a non-negative integer (got ${JSON.stringify(String(input.priorityFeeLamports))})`)
    }
    if (fee < 0n || fee > U64_MAX) throw new TxOptionError('txConfig.priorityFeeLamports must fit in an unsigned 64-bit integer')
    out.priorityFeeLamports = fee
  }
  if (input.computeUnitLimit !== undefined) {
    out.computeUnitLimit = assertIntInRange('computeUnitLimit', input.computeUnitLimit, 0, MAX_COMPUTE_UNIT_LIMIT)
  }
  if (input.loadedAccountsDataSizeLimit !== undefined) {
    out.loadedAccountsDataSizeLimit = assertIntInRange('loadedAccountsDataSizeLimit', input.loadedAccountsDataSizeLimit, 0, U32_MAX)
  }
  if (input.heapSize !== undefined) {
    const heap = assertIntInRange('heapSize', input.heapSize, MIN_HEAP_SIZE, MAX_HEAP_SIZE)
    // Out-of-range / unaligned heap is a sanitization failure: the tx never lands and shows no program error.
    if (heap % 1024 !== 0) throw new TxOptionError('txConfig.heapSize must be a multiple of 1024')
    out.heapSize = heap
  }
  return out
}

export interface ResolvedTxOptions {
  /** Version requested by the caller; undefined = caller did not ask (use the path's default). */
  txVersion?: TxVersion
  txConfig?: TxV1Config
}

/**
 * Single source of truth for txVersion / txConfig rules. Throws TxOptionError.
 *  - txConfig without txVersion 'v1' is an error (never silently ignored)
 *  - txVersion 'v1' is rejected while the TX_V1_DISABLED kill switch is on
 */
export function validateTxOptions(opts: {
  txVersion?: unknown
  txConfig?: unknown
  env?: { TX_V1_DISABLED?: string } | null
}): ResolvedTxOptions {
  const txVersion = parseTxVersion(opts.txVersion)
  const hasConfig = opts.txConfig !== undefined && opts.txConfig !== null

  if (hasConfig && txVersion !== 'v1') {
    throw new TxOptionError(
      'txConfig only applies to txVersion "v1" (legacy/v0 carry limits in ComputeBudget instructions, which Orquestra does not add) — set txVersion to "v1" or remove txConfig',
    )
  }
  if (txVersion === 'v1' && isTxV1Disabled(opts.env)) {
    throw new TxOptionError('txVersion "v1" is temporarily disabled on this server (TX_V1_DISABLED) — omit txVersion or use "v0"')
  }
  return { txVersion, txConfig: hasConfig ? normalizeTxConfig(opts.txConfig) : undefined }
}

// ─── Encoding helpers ─────────────────────────────────────────────────────────

/**
 * RPC providers reject base58 payloads over 1232 bytes. Returns the encoding to use
 * (v1 defaults to base64) or throws a clear error for an explicit-but-impossible choice.
 */
export function resolveWireEncoding(
  requested: 'base58' | 'base64' | undefined,
  version: TxVersion,
  byteLength: number,
): 'base58' | 'base64' {
  if (requested === 'base58' && byteLength > LEGACY_MAX_TX_BYTES) {
    throw new TxOptionError(
      `This ${version} transaction is ${byteLength} bytes; base58 is limited to ${LEGACY_MAX_TX_BYTES} bytes by RPC providers — request encoding "base64"`,
    )
  }
  if (requested) return requested
  return version === 'v1' ? 'base64' : 'base58'
}

// ─── Building ────────────────────────────────────────────────────────────────

export interface BuiltV1Transaction {
  /** Unsigned wire transaction (signature slots zero-filled), base64. */
  base64: string
  bytes: Uint8Array
  /** Number of distinct accounts in the message. */
  accountCount: number
  signerCount: number
}

/** Distinct account addresses a message over these instructions would carry. */
export function countV1Accounts(feePayer: string, instructions: GenericInstruction[]): { accounts: number; signers: number } {
  const all = new Set<string>([feePayer])
  const signers = new Set<string>([feePayer])
  for (const ix of instructions) {
    all.add(ix.programId)
    for (const k of ix.keys) {
      all.add(k.pubkey)
      if (k.isSigner) signers.add(k.pubkey)
    }
  }
  return { accounts: all.size, signers: signers.size }
}

/** Static (config-independent) v1 limits. Throws TxOptionError with an actionable message. */
export function assertV1StructuralLimits(feePayer: string, instructions: GenericInstruction[]): { accounts: number; signers: number } {
  if (instructions.length === 0) throw new TxOptionError('A v1 transaction needs at least one instruction')
  if (instructions.length > V1_MAX_INSTRUCTIONS) {
    throw new TxOptionError(`v1 allows at most ${V1_MAX_INSTRUCTIONS} instructions per transaction (got ${instructions.length})`)
  }
  instructions.forEach((ix, i) => {
    if (ix.keys.length > V1_MAX_ACCOUNTS_PER_INSTRUCTION) {
      throw new TxOptionError(`instruction[${i}] has ${ix.keys.length} accounts; v1 allows at most ${V1_MAX_ACCOUNTS_PER_INSTRUCTION} per instruction`)
    }
  })
  const counts = countV1Accounts(feePayer, instructions)
  if (counts.accounts > V1_MAX_ACCOUNTS) {
    throw new TxOptionError(
      `v1 transactions carry at most ${V1_MAX_ACCOUNTS} inline accounts and cannot use address lookup tables (this one needs ${counts.accounts}) — use txVersion "v0" with lookupTableAddresses instead`,
    )
  }
  if (counts.signers > V1_MAX_SIGNATURES) {
    throw new TxOptionError(`v1 allows at most ${V1_MAX_SIGNATURES} signatures (this transaction needs ${counts.signers})`)
  }
  return counts
}

function toKitConfig(config: TxV1Config | undefined, lamports: (n: bigint) => unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!config) return out
  if (config.priorityFeeLamports !== undefined) out.priorityFeeLamports = lamports(BigInt(config.priorityFeeLamports))
  if (config.computeUnitLimit !== undefined) out.computeUnitLimit = config.computeUnitLimit
  if (config.loadedAccountsDataSizeLimit !== undefined) out.loadedAccountsDataSizeLimit = config.loadedAccountsDataSizeLimit
  if (config.heapSize !== undefined) out.heapSize = config.heapSize
  return out
}

/**
 * Compiles an UNSIGNED v1 transaction. Does not add ComputeBudget instructions (they are
 * ignored by v1). Enforces the SIMD-0385 structural limits and the 4096-byte size cap.
 */
export async function buildUnsignedV1Transaction(args: {
  feePayer: string
  instructions: GenericInstruction[]
  blockhash: string
  lastValidBlockHeight?: number | bigint
  config?: TxV1Config
}): Promise<BuiltV1Transaction> {
  const { feePayer, instructions, blockhash, config } = args
  const counts = assertV1StructuralLimits(feePayer, instructions)

  const kit = await import('@solana/kit')
  const { AccountRole } = kit

  let message: any = kit.createTransactionMessage({ version: 1 })
  message = kit.setTransactionMessageFeePayer(kit.address(feePayer), message)
  message = kit.setTransactionMessageLifetimeUsingBlockhash(
    { blockhash: blockhash as any, lastValidBlockHeight: BigInt(args.lastValidBlockHeight ?? 0) },
    message,
  )
  const kitConfig = toKitConfig(config, (n) => kit.lamports(n))
  if (Object.keys(kitConfig).length > 0) {
    try {
      message = kit.setTransactionMessageConfig(kitConfig as any, message)
    } catch (err) {
      throw new TxOptionError(`Invalid txConfig: ${(err as Error).message}`)
    }
  }
  message = kit.appendTransactionMessageInstructions(
    instructions.map((ix) => ({
      programAddress: kit.address(ix.programId),
      accounts: ix.keys.map((k) => ({
        address: kit.address(k.pubkey),
        role:
          k.isSigner && k.isWritable
            ? AccountRole.WRITABLE_SIGNER
            : k.isSigner
              ? AccountRole.READONLY_SIGNER
              : k.isWritable
                ? AccountRole.WRITABLE
                : AccountRole.READONLY,
      })),
      data: ix.data,
    })),
    message,
  )

  const transaction = kit.compileTransaction(message)
  const base64 = kit.getBase64EncodedWireTransaction(transaction)
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))

  if (bytes.length > V1_MAX_TX_BYTES) {
    throw new TxOptionError(`This v1 transaction is ${bytes.length} bytes, over the ${V1_MAX_TX_BYTES}-byte limit — split the instructions across transactions`)
  }
  return { base64, bytes, accountCount: counts.accounts, signerCount: counts.signers }
}

/**
 * Whether these instructions fit one v1 transaction. Sized with the WORST-CASE config
 * (every optional field present) so a later-added config can never push it over 4096.
 */
export async function fitsInOneV1Transaction(args: {
  feePayer: string
  instructions: GenericInstruction[]
  blockhash: string
}): Promise<boolean> {
  try {
    await buildUnsignedV1Transaction({
      ...args,
      config: {
        priorityFeeLamports: U64_MAX,
        computeUnitLimit: MAX_COMPUTE_UNIT_LIMIT,
        loadedAccountsDataSizeLimit: MAX_LOADED_ACCOUNTS_DATA_SIZE,
        heapSize: MIN_HEAP_SIZE,
      },
    })
    return true
  } catch {
    return false
  }
}

// ─── Resource-limit estimation ────────────────────────────────────────────────

export interface V1SimulationProbe {
  err: unknown | null
  logs: string[]
  unitsConsumed?: number | null
  loadedAccountsDataSize?: number | null
}

export interface FinalizedV1Transaction extends BuiltV1Transaction {
  /** The config actually written into the message (limits are never left unset). */
  config: TxV1Config
  /** Human-readable notes (how limits were chosen / why a fallback was used) for `riskReasons`. */
  notes: string[]
}

/**
 * Builds the final v1 transaction with resource limits ALWAYS set. An unset v1 limit is zero
 * (not a default) and would make the transaction fail, so for any limit the caller did not
 * provide we measure it with one preflight simulation at the protocol maxima, add a 10%
 * margin, and rebuild. If simulation is unavailable or fails we fall back to the maxima.
 */
export async function finalizeV1Transaction(args: {
  feePayer: string
  instructions: GenericInstruction[]
  blockhash: string
  lastValidBlockHeight?: number | bigint
  config?: TxV1Config
  /** Preflight simulator for the measuring pass; omit to skip measuring (maxima are used). */
  simulate?: (wireBase64: string) => Promise<V1SimulationProbe>
}): Promise<FinalizedV1Transaction> {
  const notes: string[] = []
  const config: TxV1Config = { ...(args.config ?? {}) }
  const needCu = config.computeUnitLimit === undefined
  const needLoaded = config.loadedAccountsDataSizeLimit === undefined

  if (needCu || needLoaded) {
    let measured: V1SimulationProbe | null = null
    if (args.simulate) {
      const probe = await buildUnsignedV1Transaction({
        ...args,
        config: {
          ...config,
          computeUnitLimit: config.computeUnitLimit ?? MAX_COMPUTE_UNIT_LIMIT,
          loadedAccountsDataSizeLimit: config.loadedAccountsDataSizeLimit ?? MAX_LOADED_ACCOUNTS_DATA_SIZE,
        },
      })
      try {
        measured = await args.simulate(probe.base64)
      } catch (err) {
        notes.push(`v1 limit measurement failed (${(err as Error).message}); using protocol maximum limits`)
      }
    }

    if (needCu) {
      const units = measured && measured.err === null ? measured.unitsConsumed : null
      if (typeof units === 'number' && units > 0) {
        config.computeUnitLimit = Math.min(MAX_COMPUTE_UNIT_LIMIT, withMargin(units))
        notes.push(`v1 computeUnitLimit=${config.computeUnitLimit} (measured ${units} CU + 10% margin)`)
      } else {
        config.computeUnitLimit = MAX_COMPUTE_UNIT_LIMIT
        notes.push(`v1 computeUnitLimit set to the protocol maximum (${MAX_COMPUTE_UNIT_LIMIT}) — could not be measured; pass txConfig.computeUnitLimit to tighten`)
      }
    }
    if (needLoaded) {
      const size = measured && measured.err === null ? measured.loadedAccountsDataSize : null
      if (typeof size === 'number' && size > 0) {
        config.loadedAccountsDataSizeLimit = Math.min(MAX_LOADED_ACCOUNTS_DATA_SIZE, withMargin(size))
        notes.push(`v1 loadedAccountsDataSizeLimit=${config.loadedAccountsDataSizeLimit} (measured ${size} + 10% margin)`)
      } else {
        config.loadedAccountsDataSizeLimit = MAX_LOADED_ACCOUNTS_DATA_SIZE
        notes.push('v1 loadedAccountsDataSizeLimit set to the protocol maximum (64 MiB) — could not be measured; pass txConfig.loadedAccountsDataSizeLimit to tighten')
      }
    }
  }

  const built = await buildUnsignedV1Transaction({ ...args, config })
  return { ...built, config, notes }
}
