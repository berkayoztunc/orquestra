import { describe, expect, test } from 'bun:test'
import { NOT_MANUAL_IDL_SQL, parseSecure } from '../src/services/idl-provenance'
import { searchProjects } from '../src/services/search'

describe('parseSecure', () => {
  test('defaults to true; only an explicit false opts in', () => {
    expect(parseSecure(undefined)).toBe(true)
    expect(parseSecure('true')).toBe(true)
    expect(parseSecure('garbage')).toBe(true)
    expect(parseSecure(true)).toBe(true)
    expect(parseSecure(false)).toBe(false)
    expect(parseSecure('false')).toBe(false)
    expect(parseSecure('FALSE')).toBe(false)
    expect(parseSecure('0')).toBe(false)
  })
})

function recordingDb() {
  const sqls: string[] = []
  return {
    sqls,
    prepare(sql: string) {
      sqls.push(sql)
      const q = { bind: () => q, first: async () => null, all: async () => ({ results: [] }) }
      return q
    },
  } as any
}

describe('search hides manual-IDL projects by default', () => {
  for (const term of ['metaplex', 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d']) {
    test(`default excludes manual (${term.slice(0, 8)})`, async () => {
      const db = recordingDb()
      await searchProjects(db, term, 10, 0)
      expect(db.sqls.length).toBeGreaterThan(0)
      expect(db.sqls.every((s: string) => s.includes(NOT_MANUAL_IDL_SQL))).toBe(true)
    })
    test(`includeManual opts in (${term.slice(0, 8)})`, async () => {
      const db = recordingDb()
      await searchProjects(db, term, 10, 0, undefined, { includeManual: true })
      expect(db.sqls.some((s: string) => s.includes(NOT_MANUAL_IDL_SQL))).toBe(false)
    })
  }
})
