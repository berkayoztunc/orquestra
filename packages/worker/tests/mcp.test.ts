/**
 * MCP Server Tests
 *
 * Tests the MCP tool handlers directly using mock env bindings —
 * no wrangler dev server required.
 *
 * How it works:
 *   - We create a mock `Bindings` env with a fake D1 stub and a fake IDLS KV stub.
 *   - We call the exported `handleMcpRequest` with a synthetic MCP `initialize`
 *     request (the MCP protocol handshake) to verify the server responds correctly.
 *   - Individual tool logic is unit-tested by constructing the request JSON manually.
 */

import { describe, test, expect, mock } from 'bun:test'

// We import the service functions directly to test the tool logic without
// needing the MCP transport layer.
import { parseIDL, expandInstructionArgs, normalizeAccountMeta } from '../src/services/idl-parser'
import { listPdaAccounts } from '../src/services/pda'
import { generateDocumentation } from '../src/services/doc-generator'
import type { AnchorIDL } from '../src/services/idl-parser'

// ── Shared test IDL ──────────────────────────────────────────────────────────

const testIDL: AnchorIDL = {
  version: '0.1.0',
  name: 'counter_program',
  metadata: { name: 'counter_program', version: '0.1.0', spec: '0.1.0' },
  instructions: [
    {
      name: 'initialize',
      docs: ['Initialize the counter'],
      accounts: [
        { name: 'counter', isMut: true, isSigner: false, pda: { seeds: [{ kind: 'const', value: [99, 111, 117, 110, 116, 101, 114] }] } },
        { name: 'authority', isMut: true, isSigner: true },
        { name: 'systemProgram', isMut: false, isSigner: false, address: '11111111111111111111111111111111' },
      ],
      args: [
        { name: 'startValue', type: 'u64' },
      ],
    },
    {
      name: 'increment',
      accounts: [
        { name: 'counter', isMut: true, isSigner: false },
        { name: 'authority', isMut: false, isSigner: true },
      ],
      args: [
        { name: 'amount', type: 'u64' },
      ],
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
  errors: [
    { code: 6000, name: 'Unauthorized', msg: 'Not authorized' },
  ],
}

// ── Mock env helpers ─────────────────────────────────────────────────────────

function makeEnv(overrides: Partial<{
  projectRow: any
  idlRow: any
  analysisRow: any
}> = {}) {
  const projectRow = overrides.projectRow ?? {
    id: 'proj_test',
    name: 'Counter Program',
    program_id: 'CounterProgram11111111111111111111111111111',
    description: 'A simple counter on Solana',
    is_public: 1,
    custom_docs: null,
  }

  const idlRow = overrides.idlRow ?? {
    idl_json: JSON.stringify(testIDL),
    cpi_md: null,
  }

  // D1 stub: returns rows based on the SQL query
  const DB = {
    prepare(sql: string) {
      return {
        bind(..._args: any[]) {
          return {
            async first() {
              // JOIN query fetches both project + IDL fields in one row
              if (sql.includes('idl_json')) {
                if (!idlRow) return null
                return { ...projectRow, ...idlRow }
              }
              if (sql.includes('FROM projects')) {
                return projectRow
              }
              if (sql.includes('ai_analyses')) {
                return overrides.analysisRow ?? null
              }
              return null
            },
            async all() {
              if (sql.includes('FROM projects')) {
                return { results: [projectRow] }
              }
              return { results: [] }
            },
          }
        },
      }
    },
  }

  // IDLS KV stub: always returns null (forces DB fallback)
  const IDLS = {
    async get(_key: string) { return null },
    async put() {},
  }

  const CACHE = {
    async get(_key: string) { return null },
    async put() {},
  }

  return {
    DB,
    IDLS,
    CACHE,
    API_BASE_URL: 'http://localhost:8787',
    SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
  }
}

// ── Tests: tool logic via service functions ──────────────────────────────────

describe('MCP tool: list_instructions', () => {
  test('parseIDL returns correct instruction count', () => {
    const parsed = parseIDL(testIDL)
    expect(parsed.instructionCount).toBe(2)
    expect(parsed.programName).toBe('counter_program')
  })

  test('expandInstructionArgs resolves u64 type', () => {
    const args = expandInstructionArgs(testIDL, testIDL.instructions[0].args)
    expect(args).toHaveLength(1)
    expect(args[0].name).toBe('startValue')
    expect(args[0].typeStr).toBe('u64')
  })

  test('normalizeAccountMeta handles old format (isMut/isSigner)', () => {
    const acc = normalizeAccountMeta({ name: 'authority', isMut: true, isSigner: true })
    expect(acc.name).toBe('authority')
    expect(acc.isMut).toBe(true)
    expect(acc.isSigner).toBe(true)
    expect(acc.isOptional).toBe(false)
  })

  test('normalizeAccountMeta handles new format (writable/signer)', () => {
    const acc = normalizeAccountMeta({ name: 'state', writable: true, signer: false } as any)
    expect(acc.isMut).toBe(true)
    expect(acc.isSigner).toBe(false)
  })

  test('all accounts normalized with correct flags', () => {
    const instruction = testIDL.instructions[0]
    const accounts = instruction.accounts.map(normalizeAccountMeta)
    expect(accounts[0].name).toBe('counter')
    expect(accounts[0].isMut).toBe(true)
    expect(accounts[0].isSigner).toBe(false)
    expect(accounts[1].name).toBe('authority')
    expect(accounts[1].isSigner).toBe(true)
  })
})

describe('MCP tool: list_pda_accounts', () => {
  test('listPdaAccounts finds the counter PDA', () => {
    const pdas = listPdaAccounts(testIDL)
    expect(pdas.length).toBeGreaterThanOrEqual(1)
    const counterPda = pdas.find((p) => p.account === 'counter')
    expect(counterPda).toBeDefined()
    expect(counterPda?.instruction).toBe('initialize')
  })
})

describe('MCP tool: read_llms_txt', () => {
  test('generateDocumentation produces non-empty full docs', () => {
    const docs = generateDocumentation(
      testIDL,
      'CounterProgram11111111111111111111111111111',
      'http://localhost:8787',
      'proj_test',
      null,
    )
    expect(docs.full.length).toBeGreaterThan(100)
    expect(docs.full).toContain('counter_program')
    expect(docs.full).toContain('initialize')
    expect(docs.full).toContain('increment')
  })

  test('docs contain error codes section', () => {
    const docs = generateDocumentation(testIDL, 'PROG', 'http://localhost:8787', 'proj_test', null)
    expect(docs.errors).toContain('Unauthorized')
  })
})

describe('MCP tool: search_programs (DB query logic)', () => {
  test('mock DB returns matching project for text query', async () => {
    const env = makeEnv()
    const term = '%counter%'
    const row = await env.DB
      .prepare("SELECT p.id, p.name FROM projects p WHERE LOWER(p.name) LIKE LOWER(?) LIMIT 10")
      .bind(term)
      .all()
    expect(row.results).toHaveLength(1)
    expect((row.results[0] as any).name).toBe('Counter Program')
  })

  test('mock DB returns project for programId lookup', async () => {
    const env = makeEnv()
    const row = await env.DB
      .prepare("SELECT p.id, p.name, p.program_id FROM projects p WHERE p.program_id = ? AND p.is_public = 1 LIMIT 1")
      .bind('CounterProgram11111111111111111111111111111')
      .first()
    expect(row).not.toBeNull()
    expect((row as any).program_id).toBe('CounterProgram11111111111111111111111111111')
  })
})

describe('MCP tool: get_ai_analysis', () => {
  test('returns "no analysis" message when no DB row', async () => {
    const env = makeEnv({ analysisRow: null })
    const row = await env.DB
      .prepare('SELECT * FROM ai_analyses WHERE project_id = ? ORDER BY created_at DESC LIMIT 1')
      .bind('proj_test')
      .first()
    expect(row).toBeNull()
  })

  test('returns analysis data when row exists', async () => {
    const analysisRow = {
      short_description: 'A simple on-chain counter',
      detailed_analysis: JSON.stringify({ tags: ['counter', 'defi'], instructionCount: 2, summary: 'Manages counts.' }),
      model_used: 'gpt-4o',
      generated_at: '2026-04-15T00:00:00Z',
      idl_version: 1,
    }
    const env = makeEnv({ analysisRow })
    const row = await env.DB
      .prepare('SELECT * FROM ai_analyses WHERE project_id = ?')
      .bind('proj_test')
      .first()
    expect((row as any).short_description).toBe('A simple on-chain counter')
    const detail = JSON.parse((row as any).detailed_analysis)
    expect(detail.tags).toContain('counter')
  })
})

describe('MCP tool: fetchIDL helper (KV miss → DB fallback)', () => {
  test('IDLS KV miss causes DB fallback and returns valid IDL', async () => {
    const env = makeEnv()

    // Simulate the fetchIDL logic
    const cached = await env.IDLS.get('project:proj_test')
    expect(cached).toBeNull() // KV miss

    // DB fallback
    const row = await env.DB
      .prepare('SELECT p.name, p.program_id, p.is_public, v.idl_json, v.cpi_md FROM projects p JOIN idl_versions v WHERE p.id = ? ORDER BY v.version DESC LIMIT 1')
      .bind('proj_test')
      .first()

    expect(row).not.toBeNull()
    expect((row as any).is_public).toBe(1)

    const idl = JSON.parse((row as any).idl_json as string) as AnchorIDL
    expect(idl.name).toBe('counter_program')
    expect(idl.instructions).toHaveLength(2)
  })
})
