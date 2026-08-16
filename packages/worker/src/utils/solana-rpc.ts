/**
 * Solana RPC URL resolution — shared by REST /api and MCP build_instruction.
 * Aligns cluster selection so blockhash fetch uses the same chain as the client's intent.
 */

export type ResolvedCluster = 'mainnet-beta' | 'devnet' | 'testnet' | 'custom'

export type SolanaRpcEnv = {
  SOLANA_RPC_URL?: string
  SOLANA_MAINNET_RPC_URL?: string
  SOLANA_FALLBACK_RPC_URLS?: string
  SOLANA_MAINNET_FALLBACK_RPC_URLS?: string
  SOLANA_DEVNET_RPC_URL?: string
  SOLANA_TESTNET_RPC_URL?: string
}

export function parseRpcUrlList(raw?: string | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

export function buildMainnetRpcUrlList(env: SolanaRpcEnv): string[] {
  const urls = [
    env.SOLANA_MAINNET_RPC_URL,
    env.SOLANA_RPC_URL,
    ...parseRpcUrlList(env.SOLANA_MAINNET_FALLBACK_RPC_URLS),
    ...parseRpcUrlList(env.SOLANA_FALLBACK_RPC_URLS),
    'https://api.mainnet-beta.solana.com',
  ].filter((value): value is string => Boolean(value && value.trim()))

  return [...new Set(urls)]
}

/**
 * Resolve which RPC endpoint to use for getLatestBlockhash / simulateTransaction.
 *
 * Precedence:
 * 1. `rpcUrlOverride` — explicit URL (e.g. Helius devnet with API key)
 * 2. `network` starting with http(s) — treated as custom RPC URL (same as REST body.network)
 * 3. Named clusters: devnet, testnet, mainnet / mainnet-beta
 * 4. Default: mainnet-beta public RPC (or env overrides)
 */
export function resolveSolanaRpcUrl(opts: {
  network?: string | null
  rpcUrlOverride?: string | null
  env: SolanaRpcEnv
}): { rpcUrl: string; cluster: ResolvedCluster } {
  const trimmedOverride = opts.rpcUrlOverride?.trim()
  if (trimmedOverride) {
    return { rpcUrl: trimmedOverride, cluster: 'custom' }
  }

  const raw = (opts.network ?? 'mainnet').trim()
  const lower = raw.toLowerCase()

  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    return { rpcUrl: raw, cluster: 'custom' }
  }

  switch (lower) {
    case 'devnet':
      return {
        rpcUrl: opts.env.SOLANA_DEVNET_RPC_URL || 'https://api.devnet.solana.com',
        cluster: 'devnet',
      }
    case 'testnet':
      return {
        rpcUrl: opts.env.SOLANA_TESTNET_RPC_URL || 'https://api.testnet.solana.com',
        cluster: 'testnet',
      }
    case 'mainnet':
    case 'mainnet-beta':
      return {
        rpcUrl:
          opts.env.SOLANA_MAINNET_RPC_URL ||
          opts.env.SOLANA_RPC_URL ||
          'https://api.mainnet-beta.solana.com',
        cluster: 'mainnet-beta',
      }
    default:
      return {
        rpcUrl:
          opts.env.SOLANA_MAINNET_RPC_URL ||
          opts.env.SOLANA_RPC_URL ||
          'https://api.mainnet-beta.solana.com',
        cluster: 'mainnet-beta',
      }
  }
}

// ────────────────────────────────────────────────────────
// Fetch with timeout + failover
// ────────────────────────────────────────────────────────

export const RPC_TIMEOUTS = {
  /** getLatestBlockhash and other light lookups */
  blockhash: 5_000,
  /** getAccountInfo */
  accountInfo: 8_000,
  /** simulateTransaction */
  simulate: 15_000,
  /** getProgramAccounts — can return large payloads */
  programAccounts: 20_000,
  /** getSignaturesForAddress — lightweight, but can page */
  signatures: 10_000,
  /** getTransaction — full transaction payload */
  transaction: 12_000,
  /** generic third-party HTTP calls */
  thirdParty: 10_000,
} as const

/**
 * fetch() with an AbortSignal timeout. Throws on timeout like any network error
 * so existing catch blocks keep producing the same error responses.
 */
export function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = RPC_TIMEOUTS.thirdParty,
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
}

/**
 * JSON-RPC POST with timeout and URL failover.
 * Tries each URL in order; advances on timeout, network error, or HTTP 5xx/429.
 * Non-retryable responses (4xx other than 429) are returned as-is so callers
 * keep their existing error handling.
 */
export async function rpcFetch(
  urls: string | string[],
  body: string,
  timeoutMs: number,
): Promise<Response> {
  const list = Array.isArray(urls) ? urls : [urls]
  let lastError: unknown

  for (const url of list) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        },
        timeoutMs,
      )
      if (response.status >= 500 || response.status === 429) {
        lastError = new Error(`RPC request failed: HTTP ${response.status}`)
        continue
      }
      return response
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('RPC request failed: all endpoints unreachable')
}

/** Hostname only — avoids logging full URLs with API keys. */
export function rpcUrlHost(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).hostname
  } catch {
    return 'unknown'
  }
}

// ────────────────────────────────────────────────────────
// On-chain account fetching
// ────────────────────────────────────────────────────────

export interface RawAccountInfo {
  /** Raw account data as a base64 string. */
  data: string
  executable: boolean
  lamports: number
  /** Owner program public key (base58). */
  owner: string
  rentEpoch: number
  /** Slot at which this snapshot was taken. */
  slot: number
}

/**
 * Fetch a Solana account via JSON-RPC getAccountInfo.
 * Returns null if the account does not exist.
 * Uses pure fetch() — Workers-compatible, no Node.js deps.
 */
export async function fetchAccountInfo(
  address: string,
  rpcUrl: string,
): Promise<RawAccountInfo | null> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getAccountInfo',
    params: [address, { encoding: 'base64', commitment: 'confirmed' }],
  })

  const response = await rpcFetch(rpcUrl, body, RPC_TIMEOUTS.accountInfo)

  if (!response.ok) {
    throw new Error(`RPC request failed: HTTP ${response.status}`)
  }

  const json = (await response.json()) as {
    result?: {
      context?: { slot?: number }
      value?: {
        data?: [string, string]
        executable?: boolean
        lamports?: number
        owner?: string
        rentEpoch?: number
      } | null
    }
    error?: { message?: string }
  }

  if (json.error) {
    throw new Error(`RPC error: ${json.error.message ?? JSON.stringify(json.error)}`)
  }

  const value = json.result?.value
  if (!value) return null

  const dataField = value.data
  const dataBase64 = Array.isArray(dataField) ? dataField[0] : ''

  return {
    data: dataBase64,
    executable: value.executable ?? false,
    lamports: value.lamports ?? 0,
    owner: value.owner ?? '',
    rentEpoch: value.rentEpoch ?? 0,
    slot: json.result?.context?.slot ?? 0,
  }
}

// ────────────────────────────────────────────────────────
// Incremental on-chain discovery: signatures + transactions
// ────────────────────────────────────────────────────────

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** Minimal base58 decoder — only used to read instruction data discriminators. */
function base58Decode(str: string): Uint8Array {
  const bytes: number[] = []
  for (const c of str) {
    const idx = B58_ALPHABET.indexOf(c)
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

export interface SignatureInfo {
  signature: string
  slot: number
  /** null when the transaction succeeded; otherwise a JSON-serializable RPC error object. */
  err: string | null
}

/**
 * getSignaturesForAddress — lists transaction signatures involving `address`,
 * newest first. Cheap relative to getTransaction: no account/instruction data.
 */
export async function getSignaturesForAddress(
  rpcUrls: string | string[],
  address: string,
  opts: { until?: string; before?: string; limit?: number } = {},
): Promise<SignatureInfo[]> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getSignaturesForAddress',
    params: [
      address,
      {
        limit: opts.limit ?? 1000,
        ...(opts.until ? { until: opts.until } : {}),
        ...(opts.before ? { before: opts.before } : {}),
        commitment: 'confirmed',
      },
    ],
  })

  // Some providers return a normal 200 OK with a JSON-RPC-level error for
  // very high-traffic addresses (e.g. "Address is not supported" for the
  // BPF Loader Upgradeable account, which every program deploy touches) —
  // rpcFetch()'s failover only advances on transport-level failures
  // (network error, timeout, 5xx/429), so a provider-side restriction like
  // this would otherwise never reach the working fallback URLs. Loop over
  // the URLs ourselves so a JSON-RPC error also advances to the next one.
  const list = Array.isArray(rpcUrls) ? rpcUrls : [rpcUrls]
  let lastError: unknown

  for (const url of list) {
    try {
      const response = await rpcFetch(url, body, RPC_TIMEOUTS.signatures)
      if (!response.ok) {
        lastError = new Error(`RPC request failed: HTTP ${response.status}`)
        continue
      }

      const json = (await response.json()) as {
        result?: Array<{ signature: string; slot: number; err: unknown }>
        error?: { message?: string }
      }
      if (json.error) {
        lastError = new Error(`RPC error: ${json.error.message ?? JSON.stringify(json.error)}`)
        continue
      }

      return (json.result ?? []).map((r) => ({
        signature: r.signature,
        slot: r.slot,
        err: r.err ? JSON.stringify(r.err) : null,
      }))
    } catch (err) {
      lastError = err
    }
  }

  throw lastError instanceof Error ? lastError : new Error('RPC request failed: all endpoints unreachable')
}

export interface SignaturesSinceResult {
  /** Oldest-first — the order callers should process transactions in. */
  signatures: SignatureInfo[]
  /** Newest signature seen this call, or null if none — becomes the next cursor. */
  newCursor: string | null
  /** True when `maxPages` was hit before reaching `cursor.lastSignature` — more work remains. */
  truncated: boolean
}

/**
 * Pages backward from "now" via getSignaturesForAddress until `cursor.lastSignature`
 * is reached (exclusive, via `until`) or `maxPages` is hit. Bounds the RPC volume
 * of a single Workflow step — callers self-continue when `truncated` is true.
 */
export async function getSignaturesSince(
  rpcUrls: string | string[],
  address: string,
  cursor: { lastSignature?: string | null },
  opts: { pageLimit?: number; maxPages: number },
): Promise<SignaturesSinceResult> {
  const pageLimit = opts.pageLimit ?? 1000
  const pages: SignatureInfo[][] = []
  let before: string | undefined
  let truncated = false

  for (let page = 0; page < opts.maxPages; page++) {
    const batch = await getSignaturesForAddress(rpcUrls, address, {
      limit: pageLimit,
      until: cursor.lastSignature ?? undefined,
      before,
    })
    if (batch.length === 0) break

    pages.push(batch)
    before = batch[batch.length - 1].signature

    if (batch.length < pageLimit) break
    if (page === opts.maxPages - 1) truncated = true
  }

  const flat = pages.flat()
  // Newest-first per page; reverse to oldest-first for chronological processing.
  const oldestFirst = flat.slice().reverse()
  const newCursor = flat.length > 0 ? flat[0].signature : null

  return { signatures: oldestFirst, newCursor, truncated }
}

export interface ParsedTransaction {
  slot: number
  accountKeys: string[]
  instructions: Array<{ programIdIndex: number; accounts: number[]; data: string }>
}

/**
 * getTransaction (encoding: json) — fetches a full transaction so its
 * instructions can be parsed. This is the expensive call in the discovery
 * pipeline (one per new signature) — callers should cap how many they issue
 * per Workflow step/instance.
 */
export async function getTransaction(
  rpcUrls: string | string[],
  signature: string,
): Promise<ParsedTransaction | null> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getTransaction',
    params: [signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }],
  })

  const response = await rpcFetch(rpcUrls, body, RPC_TIMEOUTS.transaction)
  if (!response.ok) throw new Error(`RPC request failed: HTTP ${response.status}`)

  const json = (await response.json()) as {
    result?: {
      slot?: number
      transaction?: {
        message?: {
          accountKeys?: string[]
          instructions?: Array<{ programIdIndex: number; accounts: number[]; data: string }>
        }
      }
      meta?: {
        loadedAddresses?: { writable?: string[]; readonly?: string[] }
        innerInstructions?: Array<{ index: number; instructions: Array<{ programIdIndex: number; accounts: number[]; data: string }> }>
      }
    }
    error?: { message?: string }
  }
  if (json.error) throw new Error(`RPC error: ${json.error.message ?? JSON.stringify(json.error)}`)

  const result = json.result
  if (!result?.transaction?.message) return null

  const staticKeys = result.transaction.message.accountKeys ?? []
  const loaded = result.meta?.loadedAddresses
  // Versioned (v0) transactions resolve ALT-loaded accounts after the static keys.
  const accountKeys = [...staticKeys, ...(loaded?.writable ?? []), ...(loaded?.readonly ?? [])]

  const topLevel = result.transaction.message.instructions ?? []
  const inner = (result.meta?.innerInstructions ?? []).flatMap((i) => i.instructions)

  return {
    slot: result.slot ?? 0,
    accountKeys,
    instructions: [...topLevel, ...inner],
  }
}

/** BPF Loader Upgradeable instruction discriminators (bincode-encoded, LE u32, only first byte varies here). */
const UPGRADEABLE_LOADER_DISCRIMINATOR = {
  INITIALIZE_BUFFER: 0,
  WRITE: 1,
  DEPLOY_WITH_MAX_DATA_LEN: 2,
  UPGRADE: 3,
  SET_AUTHORITY: 4,
  CLOSE: 5,
  EXTEND_PROGRAM: 6,
  SET_AUTHORITY_CHECKED: 7,
} as const

/**
 * Extracts the newly-deployed program's address from a parsed transaction,
 * or null if the transaction doesn't contain a DeployWithMaxDataLen
 * instruction against `loaderAddress`.
 *
 * Account order for DeployWithMaxDataLen (verified against solana-labs/solana
 * sdk/program/src/bpf_loader_upgradeable.rs `deploy_with_max_program_len`):
 *   0 payer (signer)  1 programdata  2 program (NEW PROGRAM — this is what we want)
 *   3 buffer  4 rent sysvar  5 clock sysvar  6 system_program  7 upgrade_authority (signer)
 *
 * `Upgrade` (discriminator 3) is deliberately excluded — it re-deploys an
 * EXISTING program, not a new one.
 */
export function extractDeployedProgramId(
  tx: ParsedTransaction,
  loaderAddress: string,
): string | null {
  const loaderIndex = tx.accountKeys.indexOf(loaderAddress)
  if (loaderIndex === -1) return null

  for (const ix of tx.instructions) {
    if (ix.programIdIndex !== loaderIndex) continue

    let discriminator: number
    try {
      const dataBytes = base58Decode(ix.data)
      if (dataBytes.length < 1) continue
      discriminator = dataBytes[0]
    } catch {
      continue
    }

    if (discriminator !== UPGRADEABLE_LOADER_DISCRIMINATOR.DEPLOY_WITH_MAX_DATA_LEN) continue

    const programAccountIndex = ix.accounts[2]
    if (programAccountIndex === undefined) continue

    const programId = tx.accountKeys[programAccountIndex]
    if (programId) return programId
  }

  return null
}
