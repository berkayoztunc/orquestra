import { beforeEach, describe, expect, test } from 'bun:test'
import apiApp from '../src/routes/api'
import {
  buildIdlSummary,
  clearIdlSummaryMemo,
  getPublicIdlSummary,
  idlSummaryCacheKey,
} from '../src/services/idl-summary'
import { generateDocumentation } from '../src/services/doc-generator'
import type { AnchorIDL } from '../src/services/idl-parser'

const PROGRAM_ID = 'CounterProgram11111111111111111111111111111'

const idl: AnchorIDL = {
  version: '0.1.0',
  name: 'counter_program',
  instructions: [
    {
      name: 'initialize',
      docs: ['Initialize the counter'],
      accounts: [
        { name: 'counter', isMut: true, isSigner: false, pda: { seeds: [{ kind: 'const', value: [99, 111, 117, 110, 116, 101, 114] }] } },
        { name: 'authority', isMut: false, isSigner: true },
      ],
      args: [{ name: 'startValue', type: 'u64' }],
    },
  ],
  accounts: [
    {
      name: 'Counter',
      type: {
        kind: 'struct',
        fields: [
          { name: 'authority', type: 'publicKey' },
          { name: 'count', type: 'u64' },
        ],
      },
    },
  ],
  types: [],
  errors: [{ code: 6000, name: 'Unauthorized', msg: 'Not authorized' }],
  events: [],
}

function makeKv(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    async get(key: string) {
      return values.get(key) ?? null
    },
    async put(key: string, value: string) {
      values.set(key, value)
    },
    async delete(key: string) {
      values.delete(key)
    },
  }
}

function makeDb(options: { allowIdlLookup?: boolean; idlLookups?: { count: number } } = {}) {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('FROM projects')) {
                return { id: 'proj_test', program_id: PROGRAM_ID, is_public: 1 }
              }
              if (sql.includes('FROM idl_versions')) {
                if (!options.allowIdlLookup) {
                  throw new Error('Unexpected IDL lookup')
                }
                if (options.idlLookups) options.idlLookups.count++
                return { idl_json: JSON.stringify(idl), version: 1, idl_standard: 'anchor' }
              }
              return null
            },
          }
        },
      }
    },
  }
}

describe('IDL summary cache', () => {
  beforeEach(() => {
    clearIdlSummaryMemo()
  })

  test('builds normalized schema summary for Anchor IDLs', () => {
    const summary = buildIdlSummary({ projectId: 'proj_test', programId: PROGRAM_ID, version: 1, idl })
    expect(summary.schemaVersion).toBe(1)
    expect(summary.idlStandard).toBe('anchor')
    expect(summary.programName).toBe('counter_program')
    expect(summary.instructions).toHaveLength(1)
    expect(summary.accounts).toHaveLength(1)
    expect(summary.errors).toHaveLength(1)
    expect(summary.pdaAccounts).toHaveLength(1)
    expect(summary.instructionDetails.initialize).toBeDefined()
  })

  test('serves valid cache without reading raw IDL from DB', async () => {
    const summary = buildIdlSummary({ projectId: 'proj_test', programId: PROGRAM_ID, version: 1, idl })
    const kv = makeKv({ [idlSummaryCacheKey('proj_test')]: JSON.stringify(summary) })
    const result = await getPublicIdlSummary({
      db: makeDb({ allowIdlLookup: false }),
      kv,
      projectId: 'proj_test',
    })
    expect(result?.programName).toBe('counter_program')
  })

  test('ignores invalid cache, falls back to DB, and backfills summary', async () => {
    const lookups = { count: 0 }
    const kv = makeKv({ [idlSummaryCacheKey('proj_test')]: '{bad json' })
    const result = await getPublicIdlSummary({
      db: makeDb({ allowIdlLookup: true, idlLookups: lookups }),
      kv,
      projectId: 'proj_test',
    })
    expect(result?.instructions).toHaveLength(1)
    expect(lookups.count).toBe(1)
    expect(kv.values.get(idlSummaryCacheKey('proj_test'))).toContain('"schemaVersion":1')
  })

  test('instruction list route preserves public response shape from summary cache', async () => {
    const summary = buildIdlSummary({ projectId: 'proj_test', programId: PROGRAM_ID, version: 1, idl })
    const res = await apiApp.request('/proj_test/instructions', {}, {
      DB: makeDb({ allowIdlLookup: false }),
      IDLS: makeKv({ [idlSummaryCacheKey('proj_test')]: JSON.stringify(summary) }),
    } as any)

    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json).toEqual({
      projectId: 'proj_test',
      programName: 'counter_program',
      programId: PROGRAM_ID,
      instructions: summary.instructions,
    })
  })

  test('docs route can serve full docs and sections from summary cache', async () => {
    const docs = generateDocumentation(idl, PROGRAM_ID, 'https://api.orquestra.dev', 'proj_test', null)
    const summary = buildIdlSummary({ projectId: 'proj_test', programId: PROGRAM_ID, version: 1, idl, docs })
    const res = await apiApp.request('/proj_test/docs', {}, {
      DB: makeDb({ allowIdlLookup: false }),
      IDLS: makeKv({ [idlSummaryCacheKey('proj_test')]: JSON.stringify(summary) }),
      CACHE: makeKv(),
    } as any)

    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.source).toBe('summary-cache')
    expect(json.docs).toContain('counter_program')
    expect(json.sections.instructions).toContain('initialize')
  })
})
