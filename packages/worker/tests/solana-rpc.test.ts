import { describe, test, expect } from 'bun:test'
import { resolveSolanaRpcUrl, rpcUrlHost } from '../src/utils/solana-rpc'

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
      rpcUrlOverride: 'https://custom.example.com/rpc',
      env,
    })
    expect(r.rpcUrl).toBe('https://custom.example.com/rpc')
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

describe('rpcUrlHost', () => {
  test('extracts hostname', () => {
    expect(rpcUrlHost('https://api.devnet.solana.com')).toBe('api.devnet.solana.com')
  })
})
