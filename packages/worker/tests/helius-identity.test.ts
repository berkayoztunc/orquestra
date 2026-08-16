import { describe, test, expect, mock, afterEach } from 'bun:test'
import { lookupProgramIdentity, batchLookupProgramIdentity, mapHeliusCategory } from '../src/services/helius-identity'
import { identifyProgram } from '../src/services/ai-categorization'
import { CATEGORY_TAXONOMY } from '../src/services/ai-categorization'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('mapHeliusCategory', () => {
  test('maps known Helius categories onto our taxonomy', () => {
    expect(mapHeliusCategory('Swap')).toBe('dex-amm')
    expect(mapHeliusCategory('Aggregator')).toBe('dex-amm')
    expect(mapHeliusCategory('Borrow Lend')).toBe('lending')
    expect(mapHeliusCategory('NFT')).toBe('nft-marketplace')
    expect(mapHeliusCategory('Game or Casino')).toBe('gaming')
    expect(mapHeliusCategory('Launchpad')).toBe('token-launch')
  })

  test('falls back to "other" for an unmapped or unknown category', () => {
    expect(mapHeliusCategory('Spam')).toBe('other')
    expect(mapHeliusCategory('Something Helius Invents Later')).toBe('other')
  })

  test('every mapped value is a real entry in our taxonomy', () => {
    const heliusCategories = ['Swap', 'DeFi', 'Borrow Lend', 'NFT', 'Staking', 'Bridge', 'Aggregator', 'Perpetuals', 'Oracle', 'Launchpad', 'Governance', 'Game or Casino', 'Prediction Market', 'Payments', 'Privacy', 'Compression', 'Infrastructure', 'Tools', 'RWA', 'DePIN', 'DeSci', 'Airdrop', 'Web3', 'Native', 'Proprietary AMM', 'Trading Sniper', 'Arbitrage or Sandwich Bot', 'Spam', 'Other']
    for (const c of heliusCategories) {
      expect((CATEGORY_TAXONOMY as readonly string[])).toContain(mapHeliusCategory(c))
    }
  })
})

describe('lookupProgramIdentity', () => {
  test('returns null when no API key is configured', async () => {
    const result = await lookupProgramIdentity('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', {})
    expect(result).toBeNull()
  })

  test('returns null on 404 (program not in the Helius DB — the normal case)', async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify({ error: 'not found', code: 404 }), { status: 404 })) as any
    const result = await lookupProgramIdentity('SomeUnknownProgram', { HELIUS_API_KEY: 'test-key' })
    expect(result).toBeNull()
  })

  test('returns null and does not throw on a network error', async () => {
    globalThis.fetch = mock(async () => { throw new Error('network down') }) as any
    const result = await lookupProgramIdentity('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', { HELIUS_API_KEY: 'test-key' })
    expect(result).toBeNull()
  })

  test('parses a real program response shape (Jupiter, matches a live API check)', async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          address: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
          type: 'program',
          name: 'Jupiter Aggregator V6',
          category: 'Aggregator',
          tags: [],
          icon: 'jupiterIcon.svg',
          website: 'https://jup.ag/',
          twitter: 'https://x.com/JupiterExchange',
          discord: 'https://discord.gg/jup',
        }),
        { status: 200 },
      ),
    ) as any
    const result = await lookupProgramIdentity('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', { HELIUS_API_KEY: 'test-key' })
    expect(result).toEqual({
      address: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
      name: 'Jupiter Aggregator V6',
      category: 'Aggregator',
      iconUrl: 'https://orbmarkets.io/api/icons/jupiterIcon.svg',
      website: 'https://jup.ag/',
      twitter: 'https://x.com/JupiterExchange',
      discord: 'https://discord.gg/jup',
    })
  })

  test('returns null for a non-program identity (type=wallet)', async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ address: 'x', type: 'wallet', name: 'toly', category: 'Key Opinion Leader' }), { status: 200 }),
    ) as any
    const result = await lookupProgramIdentity('x', { HELIUS_API_KEY: 'test-key' })
    expect(result).toBeNull()
  })

  test('resolves the bare icon filename into a real, directly-fetchable URL', async () => {
    // Helius returns a bare filename ("jupiterIcon.svg"), not a URL — this is
    // undocumented; the real endpoint (orbmarkets.io/api/icons/<filename>,
    // confirmed live: 200, correct image/* content-type, no auth) was found
    // by inspecting Orb's own network traffic, not from any API docs.
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ address: 'x', type: 'program', name: 'Orca Whirlpool Program', category: 'Swap', icon: 'orca.png' }), { status: 200 }),
    ) as any
    const result = await lookupProgramIdentity('x', { HELIUS_API_KEY: 'test-key' })
    expect(result?.iconUrl).toBe('https://orbmarkets.io/api/icons/orca.png')
  })

  test('leaves iconUrl undefined when Helius returns no icon', async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ address: 'x', type: 'program', name: 'No Logo Program', category: 'Other' }), { status: 200 }),
    ) as any
    const result = await lookupProgramIdentity('x', { HELIUS_API_KEY: 'test-key' })
    expect(result?.iconUrl).toBeUndefined()
  })
})

describe('batchLookupProgramIdentity', () => {
  test('returns an empty map when no API key is configured', async () => {
    const result = await batchLookupProgramIdentity(['a', 'b'], {})
    expect(result.size).toBe(0)
  })

  test('returns an empty map for an empty input without making a request', async () => {
    const fetchSpy = mock(async () => new Response('[]'))
    globalThis.fetch = fetchSpy as any
    const result = await batchLookupProgramIdentity([], { HELIUS_API_KEY: 'test-key' })
    expect(result.size).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('parses a real batch response shape (matches a live API check) and skips misses', async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify([
          { address: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', type: 'program', name: 'Jupiter Aggregator V6', category: 'Aggregator', icon: 'jupiterIcon.svg', website: 'https://jup.ag/' },
          { address: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', type: 'program', name: 'Orca Whirlpool Program', category: 'Swap', icon: 'orca.png' },
          // A third address Helius doesn't recognize simply isn't present in
          // the array at all — no error entry, no null placeholder.
        ]),
        { status: 200 },
      ),
    ) as any
    const result = await batchLookupProgramIdentity(
      ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', 'SomeUnknownProgram'],
      { HELIUS_API_KEY: 'test-key' },
    )
    expect(result.size).toBe(2)
    expect(result.get('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')).toEqual({
      address: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
      name: 'Jupiter Aggregator V6',
      category: 'Aggregator',
      iconUrl: 'https://orbmarkets.io/api/icons/jupiterIcon.svg',
      website: 'https://jup.ag/',
      twitter: undefined,
      discord: undefined,
    })
    expect(result.has('SomeUnknownProgram')).toBe(false)
  })

  test('skips non-program entries (unresolved domains, wallet-type matches)', async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify([{ address: null, type: 'unknown', unresolved: true }, { address: 'x', type: 'wallet', name: 'toly', category: 'Key Opinion Leader' }]), { status: 200 }),
    ) as any
    const result = await batchLookupProgramIdentity(['a', 'x'], { HELIUS_API_KEY: 'test-key' })
    expect(result.size).toBe(0)
  })

  test('returns an empty map (never throws) on a network error', async () => {
    globalThis.fetch = mock(async () => { throw new Error('network down') }) as any
    const result = await batchLookupProgramIdentity(['a'], { HELIUS_API_KEY: 'test-key' })
    expect(result.size).toBe(0)
  })
})

describe('identifyProgram', () => {
  const input = { name: 'test_program', programId: 'ProgId111111111111111111111111111111111111', instructions: ['swap'], accounts: ['Pool'] }

  test('uses Helius data and skips the AI call when Helius has a match', async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({ address: input.programId, type: 'program', name: 'Real Program Name', category: 'Swap', website: 'https://example.com' }),
        { status: 200 },
      ),
    ) as any
    const aiSpy = mock(async () => {
      throw new Error('AI should not have been called')
    })
    const result = await identifyProgram({ AI: { run: aiSpy }, HELIUS_API_KEY: 'test-key' }, input)
    expect(result.source).toBe('helius')
    expect(result.category).toBe('dex-amm')
    expect(result.display_name).toBe('Real Program Name')
    expect(result.website).toBe('https://example.com')
    expect(aiSpy).not.toHaveBeenCalled()
  })

  test('falls back to AI when Helius 404s', async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 })) as any
    const aiSpy = mock(async () => ({ response: '{"category":"dex-amm","display_name":"Test","short_description":"","tags":[],"aliases":[]}' }))
    const result = await identifyProgram({ AI: { run: aiSpy }, HELIUS_API_KEY: 'test-key' }, input)
    expect(result.source).toBe('ai')
    expect(aiSpy).toHaveBeenCalledTimes(1)
  })

  test('falls back to AI when no HELIUS_API_KEY is configured', async () => {
    const aiSpy = mock(async () => ({ response: '{"category":"other","display_name":"Test","short_description":"","tags":[],"aliases":[]}' }))
    const result = await identifyProgram({ AI: { run: aiSpy } }, input)
    expect(result.source).toBe('ai')
    expect(aiSpy).toHaveBeenCalledTimes(1)
  })
})
