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
