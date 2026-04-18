/**
 * Solana RPC URL resolution — shared by REST /api and MCP build_instruction.
 * Aligns cluster selection so blockhash fetch uses the same chain as the client's intent.
 */

export type ResolvedCluster = 'mainnet-beta' | 'devnet' | 'testnet' | 'custom'

export type SolanaRpcEnv = {
  SOLANA_RPC_URL?: string
  SOLANA_MAINNET_RPC_URL?: string
  SOLANA_DEVNET_RPC_URL?: string
  SOLANA_TESTNET_RPC_URL?: string
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

/** Hostname only — avoids logging full URLs with API keys. */
export function rpcUrlHost(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).hostname
  } catch {
    return 'unknown'
  }
}
