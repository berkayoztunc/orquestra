import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
  mergeTxAgentState,
  parseAiExtraction,
  runTxAgent,
} from '../src/services/tx-agent'
import type { AnchorIDL } from '../src/services/idl-parser'

const authority = '11111111111111111111111111111111'
const stateAccount = 'SysvarC1ock11111111111111111111111111111111'
const programId = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'

const testIDL: AnchorIDL = {
  version: '0.1.0',
  name: 'counter_program',
  metadata: { name: 'counter_program', version: '0.1.0', spec: '0.1.0' },
  instructions: [
    {
      name: 'increment',
      accounts: [
        {
          name: 'counter',
          isMut: true,
          isSigner: false,
          pda: { seeds: [{ kind: 'account', value: 'authority' }] },
        },
        { name: 'authority', isMut: false, isSigner: true },
      ],
      args: [{ name: 'amount', type: 'u64' }],
    },
  ],
  accounts: [],
}

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('tx-agent AI extraction', () => {
  test('parses strict JSON from Workers AI text output', () => {
    const parsed = parseAiExtraction(
      '{"projectId":"proj_counter","instruction":"increment","network":"devnet","accounts":{"authority":"11111111111111111111111111111111"},"args":{"amount":1}}',
    )

    expect(parsed.projectId).toBe('proj_counter')
    expect(parsed.instruction).toBe('increment')
    expect(parsed.network).toBe('devnet')
    expect(parsed.accounts?.authority).toBe(authority)
    expect(parsed.args?.amount).toBe(1)
  })

  test('rejects non-JSON output', () => {
    expect(() => parseAiExtraction('I would use increment.')).toThrow('JSON object')
  })

  test('does not accept invented public keys that are absent from user message or prior state', () => {
    const merged = mergeTxAgentState(
      undefined,
      {
        feePayer: authority,
        accounts: {
          authority,
          counter: stateAccount,
        },
      },
      `Use my wallet ${authority}`,
    )

    expect(merged.feePayer).toBe(authority)
    expect(merged.accounts?.authority).toBe(authority)
    expect(merged.accounts?.counter).toBeUndefined()
  })
})

describe('tx-agent state machine', () => {
  test('returns missing fields before transaction construction', async () => {
    const env = makeEnv({
      aiResponse: '{"projectId":"proj_counter","instruction":"increment"}',
    })

    const response = await runTxAgent(env as any, {
      message: 'Increment the counter',
    })

    expect(response.status).toBe('needs_input')
    expect(response.missingFields.some((field) => field.kind === 'feePayer')).toBe(true)
    expect(response.missingFields.some((field) => field.name === 'authority')).toBe(true)
    expect(response.missingFields.some((field) => field.name === 'counter')).toBe(true)
    expect(response.missingFields.some((field) => field.name === 'amount')).toBe(true)
  })

  test('searches program keywords from a broad natural-language prompt', async () => {
    const env = makeEnv({
      aiResponse: '{"query":"Find a simple counter program and build increment by 1 on devnet","network":"devnet","instruction":"increment","args":{"amount":1}}',
      searchRows: [
        {
          rank: 0,
          id: 'proj_counter',
          name: 'Counter Program',
          description: 'A simple counter on Solana',
          program_id: programId,
          is_public: 1,
          updated_at: '2026-01-01T00:00:00.000Z',
          username: 'system',
          avatar_url: null,
          category: '',
          tags: 'counter',
          aliases: '',
        },
      ],
    })

    const response = await runTxAgent(env as any, {
      message: 'Find a simple counter program and build increment by 1 on devnet.',
    })

    expect(response.state.projectId).toBe('proj_counter')
    expect(response.state.programId).toBe(programId)
    expect(response.message).toContain('please provide')
    expect(response.missingFields.some((field) => field.kind === 'project')).toBe(false)
    expect(response.missingFields.some((field) => field.kind === 'feePayer')).toBe(true)
  })

  test('selects a prior candidate when the user says use its project id', async () => {
    const env = makeEnv({
      projectId: 'ns6v9lmws7pakpl1itfma',
      aiResponse: '{"programId":"ns6v9lmws7pakpl1itfma"}',
    })

    const response = await runTxAgent(env as any, {
      message: 'use ns6v9lmws7pakpl1itfma',
      state: {
        projectCandidates: [
          {
            projectId: 'ns6v9lmws7pakpl1itfma',
            name: 'simple_counter_devnet',
            programId,
          },
        ],
      },
    })

    expect(response.state.projectId).toBe('ns6v9lmws7pakpl1itfma')
    expect(response.message).toContain('Which instruction')
  })

  test('autofills signer accounts from fee payer and derives PDA accounts', async () => {
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string }
      if (body.method === 'getLatestBlockhash') {
        return jsonRpc({
          value: {
            blockhash: '11111111111111111111111111111111',
            lastValidBlockHeight: 123,
          },
        })
      }
      if (body.method === 'simulateTransaction') {
        return jsonRpc({
          value: {
            err: null,
            logs: ['Program log: consumed 1000 of 200000 compute units'],
          },
        })
      }
      return jsonRpc(null)
    }) as typeof fetch

    const env = makeEnv({
      aiResponse: '{}',
    })

    const response = await runTxAgent(env as any, {
      message: 'feePayer is 11111111111111111111111111111111 you can find rest',
      state: {
        projectId: 'proj_counter',
        instruction: 'increment',
        network: 'devnet',
        feePayer: authority,
        args: {
          amount: 1,
        },
      },
    })

    expect(response.status).toBe('simulated')
    expect(response.state.accounts?.authority).toBe(authority)
    expect(response.state.accounts?.counter).toBeDefined()
  })

  test('builds and simulates a completed unsigned transaction with mocked AI and RPC', async () => {
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string }
      if (body.method === 'getLatestBlockhash') {
        return jsonRpc({
          value: {
            blockhash: '11111111111111111111111111111111',
            lastValidBlockHeight: 123,
          },
        })
      }
      if (body.method === 'simulateTransaction') {
        return jsonRpc({
          value: {
            err: null,
            logs: ['Program log: consumed 1000 of 200000 compute units'],
          },
        })
      }
      return jsonRpc(null)
    }) as typeof fetch

    const env = makeEnv({
      aiResponse: '{}',
    })

    const response = await runTxAgent(env as any, {
      message: 'Build it',
      state: {
        projectId: 'proj_counter',
        instruction: 'increment',
        network: 'devnet',
        feePayer: authority,
        accounts: {
          authority,
          counter: stateAccount,
        },
        args: {
          amount: 1,
        },
      },
    })

    expect(response.status).toBe('simulated')
    expect(response.build?.encoding).toBe('base64')
    expect(response.build?.serializedTransaction.length).toBeGreaterThan(20)
    expect(response.simulation?.success).toBe(true)
  })
})

function makeEnv(options: { aiResponse: string; searchRows?: any[]; projectId?: string }) {
  const projectRow = {
    id: options.projectId ?? 'proj_counter',
    name: 'Counter Program',
    program_id: programId,
    is_public: 1,
  }

  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (sql.includes('COUNT(*) as count')) {
                return { count: options.searchRows?.length ?? 0 }
              }
              if (sql.includes('WHERE program_id = ?')) {
                return args[0] === programId ? { id: projectRow.id } : null
              }
              if (sql.includes('JOIN idl_versions')) {
                return {
                  ...projectRow,
                  idl_json: JSON.stringify(testIDL),
                }
              }
              return null
            },
            async all() {
              if (sql.includes('projects_fts')) {
                return { results: options.searchRows ?? [] }
              }
              return { results: [] }
            },
          }
        },
      }
    },
  }

  const IDLS = {
    async get() {
      return null
    },
  }

  const AI = {
    async run() {
      return { response: options.aiResponse }
    },
  }

  return {
    DB,
    IDLS,
    AI,
    SOLANA_DEVNET_RPC_URL: 'https://example-rpc.invalid',
  }
}

function jsonRpc(result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
