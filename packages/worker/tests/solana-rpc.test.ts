import { describe, test, expect } from 'bun:test'
import { resolveSolanaRpcUrl, rpcUrlHost, RpcUrlNotAllowedError } from '../src/utils/solana-rpc'

describe('resolveSolanaRpcUrl', () => {
  const env = {
    SOLANA_RPC_URL: 'https://env-main.example.com',
    SOLANA_MAINNET_RPC_URL: 'https://env-mainnet.example.com',
    SOLANA_DEVNET_RPC_URL: 'https://env-dev.example.com',
    SOLANA_TESTNET_RPC_URL: 'https://env-test.example.com',
  }

  test('rpcUrlOverride wins', () => {
    const r = resolveSolanaRpcUrl({
      network: 'devnet',
      rpcUrlOverride: 'https://mainnet.helius-rpc.com/?api-key=x',
      env,
    })
    expect(r.rpcUrl).toBe('https://mainnet.helius-rpc.com/?api-key=x')
    expect(r.cluster).toBe('custom')
  })

  test('https network string is custom cluster', () => {
    const r = resolveSolanaRpcUrl({
      network: 'https://devnet.helius-rpc.com/?api-key=x',
      rpcUrlOverride: null,
      env,
    })
    expect(r.cluster).toBe('custom')
    expect(r.rpcUrl).toContain('helius')
  })

  test('devnet uses env or public', () => {
    const r = resolveSolanaRpcUrl({ network: 'devnet', env })
    expect(r.cluster).toBe('devnet')
    expect(r.rpcUrl).toBe('https://env-dev.example.com')
  })

  test('testnet', () => {
    const r = resolveSolanaRpcUrl({ network: 'testnet', env: {} })
    expect(r.cluster).toBe('testnet')
    expect(r.rpcUrl).toBe('https://api.testnet.solana.com')
  })

  test('default mainnet-beta', () => {
    const r = resolveSolanaRpcUrl({ network: 'mainnet', env: {} })
    expect(r.cluster).toBe('mainnet-beta')
    expect(r.rpcUrl).toBe('https://api.mainnet-beta.solana.com')
  })
})

describe('resolveSolanaRpcUrl SSRF allowlist', () => {
  // Enforcing env — production runs log-only first, then flips this on.
  const env = {
    SOLANA_MAINNET_RPC_URL: 'https://env-mainnet.example.com',
    SOLANA_DEVNET_RPC_URL: 'https://env-dev.example.com',
    RPC_ALLOWLIST_ENFORCE: '1',
  }

  const rejects = (opts: { network?: string; rpcUrlOverride?: string }) =>
    expect(() => resolveSolanaRpcUrl({ ...opts, env })).toThrow(RpcUrlNotAllowedError)

  test('accepts allowlisted public Solana endpoints', () => {
    expect(resolveSolanaRpcUrl({ rpcUrlOverride: 'https://api.devnet.solana.com', env }).rpcUrl)
      .toBe('https://api.devnet.solana.com')
  })

  test('accepts a per-customer provider subdomain', () => {
    expect(resolveSolanaRpcUrl({ rpcUrlOverride: 'https://foo.solana-mainnet.quiknode.pro/abc/', env }).cluster)
      .toBe('custom')
  })

  test('rejects a lookalike of a subdomain-enabled host', () => {
    // `evil-quiknode.pro` must not match the `quiknode.pro` entry — the suffix
    // test requires a leading dot.
    rejects({ rpcUrlOverride: 'https://evil-quiknode.pro/rpc' })
  })

  test('rejects an arbitrary public host', () => {
    rejects({ rpcUrlOverride: 'https://custom.example.com/rpc' })
  })

  test('rejects plaintext http even on an allowlisted host', () => {
    rejects({ rpcUrlOverride: 'http://api.devnet.solana.com' })
  })

  test('rejects cloud metadata and private-range targets', () => {
    rejects({ rpcUrlOverride: 'http://169.254.169.254/latest/meta-data/' })
    rejects({ rpcUrlOverride: 'http://10.0.0.5:8080/admin' })
    rejects({ rpcUrlOverride: 'http://127.0.0.1:9999/' })
  })

  test('rejects a URL-valued network, the second injection path', () => {
    rejects({ network: 'http://169.254.169.254/latest/meta-data/' })
    rejects({ network: 'https://custom.example.com/rpc' })
  })

  test('never validates env-derived URLs — their hosts are secrets', () => {
    // `env-mainnet.example.com` is not allowlisted, but it must still resolve:
    // running the allowlist over env values would take production down.
    expect(resolveSolanaRpcUrl({ network: 'mainnet', env }).rpcUrl).toBe('https://env-mainnet.example.com')
    expect(resolveSolanaRpcUrl({ network: 'devnet', env }).rpcUrl).toBe('https://env-dev.example.com')
  })

  test('the rejection message carries the host but never the full URL', () => {
    try {
      resolveSolanaRpcUrl({ rpcUrlOverride: 'https://custom.example.com/rpc?api-key=SECRET', env })
      throw new Error('expected a rejection')
    } catch (err) {
      expect(err).toBeInstanceOf(RpcUrlNotAllowedError)
      expect((err as Error).message).toContain('custom.example.com')
      expect((err as Error).message).not.toContain('SECRET')
    }
  })

  test('log-only mode allows through so rollout can observe first', () => {
    const logOnly = { ...env, RPC_ALLOWLIST_ENFORCE: undefined }
    expect(resolveSolanaRpcUrl({ rpcUrlOverride: 'https://custom.example.com/rpc', env: logOnly }).rpcUrl)
      .toBe('https://custom.example.com/rpc')
  })

  test('operator-supplied extra hosts are honored', () => {
    const extended = { ...env, SOLANA_RPC_ALLOWLIST_EXTRA: 'self-hosted.internal.example.com' }
    expect(resolveSolanaRpcUrl({ rpcUrlOverride: 'https://self-hosted.internal.example.com', env: extended }).cluster)
      .toBe('custom')
  })
})

describe('rpcUrlHost', () => {
  test('extracts hostname', () => {
    expect(rpcUrlHost('https://api.devnet.solana.com')).toBe('api.devnet.solana.com')
  })
})
