import { describe, test, expect } from 'bun:test'
import { isUrlAllowlisted, EXTERNAL_HTTP_ALLOWLIST } from '../src/flow-engine/nodes/external-http'
import { buildJupiterQuoteUrl, parseJupiterQuoteResponse } from '../src/flow-engine/resolvers/quote'

describe('external.http@1 allowlist', () => {
  test('allows the exact allowlisted host + path prefix', () => {
    expect(isUrlAllowlisted('https://quote-api.jup.ag/v6/quote?inputMint=abc')).toBe(true)
  })

  test('rejects a different host', () => {
    expect(isUrlAllowlisted('https://evil.example.com/v6/quote')).toBe(false)
  })

  test('rejects http (non-https)', () => {
    expect(isUrlAllowlisted('http://quote-api.jup.ag/v6/quote')).toBe(false)
  })

  test('rejects a path outside the allowed prefix', () => {
    expect(isUrlAllowlisted('https://quote-api.jup.ag/v7/quote')).toBe(false)
  })

  test('rejects a malformed URL', () => {
    expect(isUrlAllowlisted('not a url')).toBe(false)
  })

  test('rejects an SSRF-style host that merely contains the allowlisted host as a substring', () => {
    expect(isUrlAllowlisted('https://quote-api.jup.ag.evil.com/v6/quote')).toBe(false)
    expect(isUrlAllowlisted('https://evilquote-api.jup.ag/v6/quote')).toBe(false)
  })

  test('custom allowlist parameter works independently of the default export', () => {
    expect(isUrlAllowlisted('https://internal.example.com/api/', [{ host: 'internal.example.com', pathPrefix: '/api/' }])).toBe(true)
    expect(isUrlAllowlisted('https://internal.example.com/api/', [])).toBe(false)
  })

  test('the default allowlist is exactly the documented Jupiter entry', () => {
    expect(EXTERNAL_HTTP_ALLOWLIST).toEqual([{ host: 'quote-api.jup.ag', pathPrefix: '/v6/' }])
  })
})

describe('resolve.quote@1 (Jupiter) — pure helpers, no network', () => {
  test('buildJupiterQuoteUrl produces a well-formed, allowlisted URL', () => {
    const url = buildJupiterQuoteUrl({ inputMint: 'MINT_A', outputMint: 'MINT_B', amount: '1000000', slippageBps: 100 })
    expect(url).toBe('https://quote-api.jup.ag/v6/quote?inputMint=MINT_A&outputMint=MINT_B&amount=1000000&slippageBps=100')
    expect(isUrlAllowlisted(url)).toBe(true)
  })

  test('buildJupiterQuoteUrl defaults slippageBps to 50', () => {
    const url = buildJupiterQuoteUrl({ inputMint: 'A', outputMint: 'B', amount: '1' })
    expect(url).toContain('slippageBps=50')
  })

  test('parseJupiterQuoteResponse extracts outAmount/minOutAmount/priceImpactPct', () => {
    const fixture = {
      inputMint: 'A',
      outAmount: '995000',
      otherAmountThreshold: '990000',
      outputMint: 'B',
      priceImpactPct: '0.01',
      routePlan: [{ swapInfo: { ammKey: 'pool1' } }],
    }
    const parsed = parseJupiterQuoteResponse(fixture)
    expect(parsed.outAmount).toBe('995000')
    expect(parsed.minOutAmount).toBe('990000')
    expect(parsed.priceImpactPct).toBe('0.01')
    expect(parsed.route).toEqual(fixture)
  })

  test('parseJupiterQuoteResponse handles a missing priceImpactPct gracefully', () => {
    const parsed = parseJupiterQuoteResponse({ outAmount: '100', otherAmountThreshold: '99' })
    expect(parsed.priceImpactPct).toBeNull()
  })

  test('parseJupiterQuoteResponse throws on an unexpected shape', () => {
    expect(() => parseJupiterQuoteResponse({ error: 'no route found' })).toThrow(/unexpected Jupiter response shape/)
  })
})
