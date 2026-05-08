import { afterEach, describe, expect, mock, test } from 'bun:test'
import bs58 from 'bs58'
import apiApp from '../src/routes/api'
import { computeAccountDiscriminator } from '../src/services/account-parser'
import {
  getAnchorAccountLayout,
  getCodamaAccountLayout,
  queryProgramAccounts,
} from '../src/services/program-accounts'
import type { AnchorIDL, CodamaIDL } from '../src/services/idl-parser'

const PROGRAM_ID = 'CounterProgram11111111111111111111111111111'
const AUTHORITY = '11111111111111111111111111111111'

const anchorIdl: AnchorIDL = {
  version: '0.1.0',
  name: 'counter_program',
  instructions: [],
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
  events: [],
  errors: [],
}

const newFormatIdl: AnchorIDL = {
  version: '0.1.0',
  name: 'new_counter',
  instructions: [],
  accounts: [{ name: 'Counter', discriminator: [1, 2, 3, 4, 5, 6, 7, 8] }],
  types: [
    {
      name: 'Counter',
      type: {
        kind: 'struct',
        fields: [
          { name: 'authority', type: 'pubkey' },
          { name: 'count', type: 'u64' },
        ],
      },
    },
  ],
  events: [],
  errors: [],
}

const variableIdl: AnchorIDL = {
  version: '0.1.0',
  name: 'variable_program',
  instructions: [],
  accounts: [
    {
      name: 'State',
      type: {
        kind: 'struct',
        fields: [
          { name: 'bump', type: 'u8' },
          { name: 'label', type: 'string' },
          { name: 'authority', type: 'publicKey' },
        ],
      },
    },
  ],
  types: [],
  events: [],
  errors: [],
}

const codamaIdl: CodamaIDL = {
  kind: 'rootNode',
  standard: 'codama',
  version: '1.0.0',
  program: {
    name: 'token_program',
    publicKey: PROGRAM_ID,
    version: '1.0.0',
    instructions: [],
    accounts: [
      {
        name: 'TokenAccount',
        discriminators: [{ kind: 'sizeDiscriminatorNode', size: 165 }],
        data: {
          kind: 'structTypeNode',
          fields: [
            { kind: 'structFieldTypeNode', name: 'mint', type: { kind: 'publicKeyTypeNode' } },
            { kind: 'structFieldTypeNode', name: 'owner', type: { kind: 'publicKeyTypeNode' } },
          ],
        },
      },
    ],
    definedTypes: [],
    pdas: [],
    errors: [],
  },
}

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function counterAccountBase64(count: bigint): Promise<string> {
  const disc = await computeAccountDiscriminator('Counter')
  const bytes = new Uint8Array(8 + 32 + 8)
  bytes.set(disc, 0)
  bytes.set(bs58.decode(AUTHORITY), 8)
  const view = new DataView(bytes.buffer)
  view.setBigUint64(40, count, true)
  return toBase64(bytes)
}

function makeEnv(idl: AnchorIDL | CodamaIDL = anchorIdl) {
  return {
    SOLANA_RPC_URL: 'https://rpc.example.com',
    SOLANA_MAINNET_RPC_URL: 'https://rpc.example.com',
    API_BASE_URL: 'https://api.orquestra.dev',
    IDLS: {
      async get() {
        return null
      },
    },
    DB: {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async first() {
                if (sql.includes('FROM idl_versions')) {
                  return { idl_json: JSON.stringify(idl), program_id: PROGRAM_ID }
                }
                return null
              },
            }
          },
        }
      },
    },
  }
}

describe('program account layout inference', () => {
  test('infers fixed Anchor account size and field offsets', () => {
    const layout = getAnchorAccountLayout(anchorIdl, 'Counter')
    expect(layout?.size).toBe(48)
    expect(layout?.fieldOffsets.authority).toBe(8)
    expect(layout?.fieldOffsets.count).toBe(40)
  })

  test('infers new Anchor IDL format account layout from types array', () => {
    const layout = getAnchorAccountLayout(newFormatIdl, 'Counter')
    expect(layout?.size).toBe(48)
    expect(layout?.fieldOffsets.authority).toBe(8)
    expect(layout?.fieldOffsets.count).toBe(40)
  })

  test('stops field-filter inference at variable-size fields', () => {
    const layout = getAnchorAccountLayout(variableIdl, 'State')
    expect(layout?.size).toBeNull()
    expect(layout?.fieldOffsets.bump).toBe(8)
    expect(layout?.fieldOffsets.label).toBeUndefined()
    expect(layout?.fieldOffsets.authority).toBeUndefined()
  })

  test('uses Codama size discriminator as exact account size', () => {
    const layout = getCodamaAccountLayout(codamaIdl, 'TokenAccount')
    expect(layout?.size).toBe(165)
    expect(layout?.startOffset).toBe(0)
    expect(layout?.fieldOffsets.mint).toBe(0)
    expect(layout?.fieldOffsets.owner).toBe(32)
  })
})

describe('queryProgramAccounts', () => {
  test('builds RPC filters, applies limit, and decodes matching accounts', async () => {
    const raw = await counterAccountBase64(42n)
    let rpcBody: any

    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      rpcBody = JSON.parse(init?.body as string)
      return new Response(JSON.stringify({
        result: {
          context: { slot: 123 },
          value: [
            {
              pubkey: 'Counter1111111111111111111111111111111111',
              account: {
                data: [raw, 'base64'],
                executable: false,
                lamports: 10,
                owner: PROGRAM_ID,
                rentEpoch: 99,
              },
            },
            {
              pubkey: 'Counter2222221111111111111111111111111111',
              account: {
                data: [raw, 'base64'],
                executable: false,
                lamports: 20,
                owner: PROGRAM_ID,
                rentEpoch: 99,
              },
            },
          ],
        },
      }))
    }) as any

    const result = await queryProgramAccounts({
      idl: anchorIdl,
      programId: PROGRAM_ID,
      rpcUrl: 'https://rpc.example.com',
      cluster: 'mainnet-beta',
      input: {
        accountType: 'Counter',
        fieldFilters: [{ field: 'authority', bytes: AUTHORITY }],
        limit: 1,
      },
    })

    expect(rpcBody.method).toBe('getProgramAccounts')
    expect(rpcBody.params[1].withContext).toBe(true)
    expect(rpcBody.params[1].encoding).toBe('base64')
    expect(rpcBody.params[1].filters).toContainEqual({ dataSize: 48 })
    expect(rpcBody.params[1].filters).toContainEqual({ memcmp: { offset: 8, bytes: AUTHORITY } })
    expect(result.slot).toBe(123)
    expect(result.rpcMethod).toBe('getProgramAccounts')
    expect(result.paginationKey).toBeNull()
    expect(result.count).toBe(1)
    expect(result.accounts[0].accountType).toBe('Counter')
    expect(result.accounts[0].data).toEqual({ authority: AUTHORITY, count: 42 })
    expect(result.accounts[0].raw).toBeUndefined()
  })

  test('rejects field filters for non-fixed fields', async () => {
    await expect(queryProgramAccounts({
      idl: variableIdl,
      programId: PROGRAM_ID,
      rpcUrl: 'https://rpc.example.com',
      cluster: 'mainnet-beta',
      input: {
        accountType: 'State',
        fieldFilters: [{ field: 'label', bytes: 'abc' }],
      },
    })).rejects.toThrow('Field "label"')
  })

  test('uses getProgramAccountsV2 with pagination for Helius RPC URLs', async () => {
    const raw = await counterAccountBase64(9n)
    let rpcBody: any

    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      rpcBody = JSON.parse(init?.body as string)
      return new Response(JSON.stringify({
        result: {
          context: { slot: 321 },
          value: {
            accounts: [
              {
                pubkey: 'Counter1111111111111111111111111111111111',
                account: {
                  data: [raw, 'base64'],
                  executable: false,
                  lamports: 10,
                  owner: PROGRAM_ID,
                  rentEpoch: 99,
                },
              },
            ],
            paginationKey: 'next_cursor',
          },
        },
      }))
    }) as any

    const result = await queryProgramAccounts({
      idl: anchorIdl,
      programId: PROGRAM_ID,
      rpcUrl: 'https://mainnet.helius-rpc.com/?api-key=test',
      cluster: 'mainnet-beta',
      input: {
        accountType: 'Counter',
        limit: 10,
        paginationKey: 'cursor',
        changedSinceSlot: 123,
      },
    })

    expect(rpcBody.method).toBe('getProgramAccountsV2')
    expect(rpcBody.params[1].limit).toBe(10)
    expect(rpcBody.params[1].paginationKey).toBe('cursor')
    expect(rpcBody.params[1].changedSinceSlot).toBe(123)
    expect(result.rpcMethod).toBe('getProgramAccountsV2')
    expect(result.paginationKey).toBe('next_cursor')
    expect(result.accounts[0].data).toEqual({ authority: AUTHORITY, count: 9 })
  })

  test('retries with getProgramAccountsV2 when legacy RPC asks for pagination', async () => {
    const raw = await counterAccountBase64(11n)
    const methods: string[] = []

    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      methods.push(body.method)
      if (body.method === 'getProgramAccounts') {
        return new Response(JSON.stringify({
          error: {
            message: 'account index service overloaded, please try again. Please use getProgramAccountsV2 with pagination to handle large datasets.',
          },
        }))
      }
      return new Response(JSON.stringify({
        result: {
          context: { slot: 456 },
          value: {
            accounts: [
              {
                pubkey: 'Counter1111111111111111111111111111111111',
                account: {
                  data: [raw, 'base64'],
                  executable: false,
                  lamports: 10,
                  owner: PROGRAM_ID,
                  rentEpoch: 99,
                },
              },
            ],
            paginationKey: null,
          },
        },
      }))
    }) as any

    const result = await queryProgramAccounts({
      idl: anchorIdl,
      programId: PROGRAM_ID,
      rpcUrl: 'https://rpc.example.com',
      cluster: 'mainnet-beta',
      input: { accountType: 'Counter', limit: 10 },
    })

    expect(methods).toEqual(['getProgramAccounts', 'getProgramAccountsV2'])
    expect(result.rpcMethod).toBe('getProgramAccountsV2')
    expect(result.slot).toBe(456)
  })
})

describe('program account REST route', () => {
  test('validates query body', async () => {
    const res = await apiApp.request('/proj_test/program-accounts/query', {
      method: 'POST',
      body: JSON.stringify({ limit: 101 }),
      headers: { 'Content-Type': 'application/json' },
    }, makeEnv() as any)

    expect(res.status).toBe(400)
    const json = await res.json() as any
    expect(json.error).toBe('Invalid program account query')
  })

  test('returns decoded program account query results', async () => {
    const raw = await counterAccountBase64(7n)
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      result: {
        context: { slot: 777 },
        value: [
          {
            pubkey: 'Counter1111111111111111111111111111111111',
            account: {
              data: [raw, 'base64'],
              executable: false,
              lamports: 123,
              owner: PROGRAM_ID,
              rentEpoch: 1,
            },
          },
        ],
      },
    }))) as any

    const res = await apiApp.request('/proj_test/program-accounts/query', {
      method: 'POST',
      body: JSON.stringify({ accountType: 'Counter' }),
      headers: { 'Content-Type': 'application/json' },
    }, makeEnv() as any)

    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.projectId).toBe('proj_test')
    expect(json.slot).toBe(777)
    expect(json.accounts[0].accountType).toBe('Counter')
    expect(json.accounts[0].data.count).toBe(7)
  })
})
