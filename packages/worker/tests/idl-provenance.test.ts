import { describe, test, expect, afterEach } from 'bun:test'
import {
  idlProvenance,
  provenanceBanner,
  compareInstructionSets,
  instructionNames,
  latestIdlSource,
  MANUAL_IDL_NOTICE,
} from '../src/services/idl-provenance'
import { resolveIdlAgainstChain, type OnChainIdlCheck } from '../src/services/onchain-idl-check'

const idl = (names: string[]) => ({
  version: '0.1.0',
  name: 'demo',
  instructions: names.map((name) => ({ name, accounts: [], args: [] })),
})

describe('idlProvenance', () => {
  test('manual uploads are flagged with the no-on-chain-IDL notice', () => {
    const p = idlProvenance('manual')
    expect(p.origin).toBe('manual')
    expect(p.verifiedOnChain).toBe(false)
    expect(p.notice).toBe(MANUAL_IDL_NOTICE)
    expect(p.notice).toMatch(/No verified on-chain IDL/)
    expect(p.notice).toMatch(/uploaded manually/)
  })

  test('anchor / pmp / legacy NULL rows count as on-chain with no notice', () => {
    for (const src of ['anchor', 'pmp', null, undefined]) {
      const p = idlProvenance(src)
      expect(p.origin).toBe('onchain')
      expect(p.notice).toBeNull()
    }
    expect(idlProvenance('pmp').idlSource).toBe('pmp')
  })

  test('provenanceBanner is empty for on-chain IDLs and a warning for manual ones', () => {
    expect(provenanceBanner('anchor')).toBe('')
    expect(provenanceBanner('manual')).toContain('Manually uploaded IDL')
    expect(provenanceBanner('manual')).toContain('no on-chain IDL')
  })
})

describe('compareInstructionSets', () => {
  test('snake_case, camelCase and kebab-case are the same instruction', () => {
    const r = compareInstructionSets(idl(['make_purchase', 'initialize']), idl(['makePurchase', 'initialize']))
    expect(r.matches).toBe(true)
  })
  test('reports instructions only in the upload and only on-chain', () => {
    const r = compareInstructionSets(idl(['a', 'steal_funds']), idl(['a', 'b']))
    expect(r.matches).toBe(false)
    expect(r.onlyInUploaded).toEqual(['steal_funds'])
    expect(r.onlyOnChain).toEqual(['b'])
  })
  test('reads Codama-style program.instructions too', () => {
    expect(instructionNames({ program: { instructions: [{ name: 'x' }] } })).toEqual(['x'])
  })
})

describe('resolveIdlAgainstChain', () => {
  const uploaded = idl(['make_purchase', 'steal_funds'])
  const chain = idl(['make_purchase', 'initialize'])
  const check = (r: OnChainIdlCheck) => async () => r

  test('an on-chain IDL wins over the upload and the differences are reported', async () => {
    const r = await resolveIdlAgainstChain('P', uploaded, [], check({ status: 'found', source: 'anchor', idl: chain, idlJson: JSON.stringify(chain) }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.idlSource).toBe('anchor')
    expect(r.value.idl).toEqual(chain)
    expect(r.value.onChain.differences?.onlyInUploaded).toEqual(['steal_funds'])
    expect(r.value.warnings.join(' ')).toMatch(/imported from the chain instead of your uploaded file/)
  })

  test('a matching upload is still replaced by the chain copy (no differences noted)', async () => {
    const r = await resolveIdlAgainstChain('P', chain, [], check({ status: 'found', source: 'pmp', idl: chain, idlJson: JSON.stringify(chain) }))
    expect(r.ok && r.value.idlSource).toBe('pmp')
    expect(r.ok && r.value.onChain.differences).toBeUndefined()
  })

  test('no on-chain IDL → stored as manual and the uploader is told so', async () => {
    const r = await resolveIdlAgainstChain('P', uploaded, [], check({ status: 'absent' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.idlSource).toBe('manual')
    expect(r.value.idl).toBe(uploaded)
    expect(r.value.onChain.status).toBe('absent')
    expect(r.value.warnings[0]).toContain('No verified on-chain IDL')
    expect(r.value.warnings[0]).toContain('uploaded manually')
  })

  test('an unreadable on-chain account → manual, with that fact stated', async () => {
    const r = await resolveIdlAgainstChain('P', uploaded, [], check({ status: 'unreadable', source: 'anchor' }))
    expect(r.ok && r.value.idlSource).toBe('manual')
    expect(r.ok && r.value.onChain.status).toBe('unreadable')
    expect(r.ok && r.value.warnings[0]).toMatch(/could not be read/)
  })

  test('a found-but-structurally-invalid on-chain IDL is treated as unreadable, not trusted', async () => {
    const r = await resolveIdlAgainstChain('P', uploaded, [], check({ status: 'found', source: 'anchor', idl: { nope: true }, idlJson: '{"nope":true}' }))
    expect(r.ok && r.value.idlSource).toBe('manual')
  })

  test('an RPC failure fails closed instead of guessing', async () => {
    const r = await resolveIdlAgainstChain('P', uploaded, [], check({ status: 'error', message: 'boom' }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.message).toMatch(/Could not verify/)
  })
})

describe('latestIdlSource', () => {
  const dbWith = (row: unknown) => ({ prepare: () => ({ bind: () => ({ first: async () => row }) }) }) as any
  test('returns the column, or null when there is no version / no db', async () => {
    expect(await latestIdlSource(dbWith({ idl_source: 'manual' }), 'p')).toBe('manual')
    expect(await latestIdlSource(dbWith(null), 'p')).toBeNull()
    expect(await latestIdlSource(undefined, 'p')).toBeNull()
  })
})
