import { describe, expect, test } from 'bun:test'
import { findSimilarName, idlOwnName, namesAreSimilar, normalizeProjectName } from '../src/services/name-similarity'

describe('name similarity', () => {
  test('normalizes noise and punctuation', () => {
    expect(normalizeProjectName('Meteora AMM')).toBe('meteoraamm')
    expect(normalizeProjectName('pump_fun Program')).toBe('pumpfun')
  })

  test('flags identical and near-identical names', () => {
    expect(namesAreSimilar('PumpFun', 'pump_fun')).toBe(true)
    expect(namesAreSimilar('Metaplex Core', 'metaplex-core')).toBe(true)
    expect(namesAreSimilar('Metaplex Core', 'Metaplex Cores')).toBe(true)
    expect(namesAreSimilar('Meteora AMM', 'Meteora AMM Program')).toBe(true)
    expect(namesAreSimilar('metaplex', 'Metaplex Core')).toBe(true)
  })

  test('does not flag unrelated or very short names', () => {
    expect(namesAreSimilar('Jupiter', 'Marinade')).toBe(false)
    expect(namesAreSimilar('coin_flip', 'staking_program')).toBe(false)
    expect(namesAreSimilar('ab', 'ab')).toBe(false)
    expect(namesAreSimilar('swap', 'Jupiter Swap Aggregator')).toBe(false)
  })

  test('findSimilarName returns the first clash across candidates', () => {
    const existing = [{ name: 'Marinade' }, { name: 'Metaplex Core' }]
    expect(findSimilarName(['x', 'metaplex_core'], existing)?.name).toBe('Metaplex Core')
    expect(findSimilarName(['totally different'], existing)).toBeNull()
  })

  test('idlOwnName reads legacy, 0.30+ and codama shapes', () => {
    expect(idlOwnName({ name: 'a_b' })).toBe('a_b')
    expect(idlOwnName({ metadata: { name: 'c' }, name: 'ignored' })).toBe('c')
    expect(idlOwnName({ program: { name: 'd' } })).toBe('d')
    expect(idlOwnName({})).toBeNull()
  })
})
