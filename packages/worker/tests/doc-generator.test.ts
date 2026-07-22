import { describe, test, expect } from 'bun:test'
import { generateDocumentation } from '../src/services/doc-generator'

const sampleIDL = {
  version: '0.1.0',
  name: 'test_program',
  instructions: [
    {
      name: 'initialize',
      docs: ['Initialize the program state'],
      accounts: [
        { name: 'authority', isMut: true, isSigner: true },
        { name: 'state', isMut: true, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [
        { name: 'amount', type: 'u64' },
        { name: 'label', type: 'string' },
      ],
    },
    {
      name: 'transfer',
      docs: ['Transfer tokens between accounts'],
      accounts: [
        { name: 'from', isMut: true, isSigner: true },
        { name: 'to', isMut: true, isSigner: false },
      ],
      args: [{ name: 'amount', type: 'u64' }],
    },
  ],
  accounts: [
    {
      name: 'StateAccount',
      type: {
        kind: 'struct',
        fields: [
          { name: 'authority', type: 'publicKey' },
          { name: 'balance', type: 'u64' },
        ],
      },
    },
  ],
  errors: [
    { code: 6000, name: 'Unauthorized', msg: 'You are not authorized' },
    { code: 6001, name: 'InsufficientFunds', msg: 'Insufficient funds' },
  ],
  events: [
    {
      name: 'TransferEvent',
      data: [
        { name: 'from', type: 'publicKey' },
        { name: 'to', type: 'publicKey' },
        { name: 'amount', type: 'u64' },
      ],
    },
  ],
  types: [],
}

describe('Doc Generator', () => {
  test('generates complete documentation', () => {
    const docs = generateDocumentation(sampleIDL as any, 'PROG123', 'http://localhost:8787/api', 'test')
    expect(docs).toBeDefined()
    expect(docs.full).toContain('test_program')
    expect(docs.full).toContain('initialize')
    expect(docs.full).toContain('transfer')
    expect(docs.full).toContain('Query Program Accounts')
    expect(docs.full).toContain('/program-accounts/query')
  })

  test('generates instruction docs', () => {
    const docs = generateDocumentation(sampleIDL as any, 'PROG123', 'http://localhost:8787/api', 'test')
    expect(docs.instructions).toContain('initialize')
    expect(docs.instructions).toContain('transfer')
    expect(docs.instructions).toContain('authority')
    expect(docs.instructions).toContain('amount')
  })

  test('generates account docs', () => {
    const docs = generateDocumentation(sampleIDL as any, 'PROG123', 'http://localhost:8787/api', 'test')
    expect(docs.accounts).toContain('StateAccount')
    expect(docs.accounts).toContain('authority')
    expect(docs.accounts).toContain('balance')
    expect(docs.programAccounts).toContain('accountType')
    expect(docs.programAccounts).toContain('fieldFilters')
  })

  test('generates error docs', () => {
    const docs = generateDocumentation(sampleIDL as any, 'PROG123', 'http://localhost:8787/api', 'test')
    expect(docs.errors).toContain('Unauthorized')
    expect(docs.errors).toContain('6000')
    expect(docs.errors).toContain('InsufficientFunds')
  })

  test('generates event docs with event names', () => {
    const docs = generateDocumentation(sampleIDL as any, 'PROG123', 'http://localhost:8787/api', 'test')
    expect(docs.events).toContain('TransferEvent')
  })

  test('generates overview with stats', () => {
    const docs = generateDocumentation(sampleIDL as any, 'PROG123', 'http://localhost:8787/api', 'test')
    expect(docs.overview).toContain('test_program')
    expect(docs.overview).toContain('PROG123')
  })

  test('includes API base URL in curl examples', () => {
    const docs = generateDocumentation(sampleIDL as any, 'PROG123', 'https://api.orquestra.dev/api', 'test')
    expect(docs.full).toContain('https://api.orquestra.dev/api')
  })

  // ── Defined type documentation ──────────────────

  const idlWithDefinedTypes = {
    version: '0.1.0',
    name: 'token_program',
    metadata: { name: 'token_program', version: '0.1.0', spec: '0.1.0' },
    instructions: [
      {
        name: 'initialize',
        docs: ['Initialize a new token'],
        accounts: [
          { name: 'payer', isMut: true, isSigner: true },
        ],
        args: [
          { name: 'metadata', type: { defined: { name: 'InitTokenParams' } } },
          { name: 'seed1', type: 'string' },
        ],
      },
    ],
    accounts: [],
    errors: [],
    events: [],
    types: [
      {
        name: 'InitTokenParams',
        type: {
          kind: 'struct',
          fields: [
            { name: 'name', type: 'string' },
            { name: 'symbol', type: 'string' },
            { name: 'uri', type: 'string' },
            { name: 'decimals', type: 'u8' },
          ],
        },
      },
    ],
  }

  test('generates docs showing defined type struct fields', () => {
    const docs = generateDocumentation(idlWithDefinedTypes as any, 'PROG123', 'http://localhost:8787/api', 'token')
    expect(docs.instructions).toContain('InitTokenParams')
    expect(docs.instructions).toContain('metadata')
    // Struct fields should be expanded in documentation
    expect(docs.instructions).toContain('name')
    expect(docs.instructions).toContain('symbol')
    expect(docs.instructions).toContain('uri')
    expect(docs.instructions).toContain('decimals')
    expect(docs.instructions).toContain('u8')
  })

  test('generates example with nested struct in args', () => {
    const docs = generateDocumentation(idlWithDefinedTypes as any, 'PROG123', 'http://localhost:8787/api', 'token')
    // The example curl should show nested object format
    expect(docs.instructions).toContain('"metadata"')
    expect(docs.instructions).toContain('"name"')
    expect(docs.instructions).toContain('"symbol"')
  })

  test('generates types section for defined types', () => {
    const docs = generateDocumentation(idlWithDefinedTypes as any, 'PROG123', 'http://localhost:8787/api', 'token')
    expect(docs.types).toContain('InitTokenParams')
    expect(docs.types).toContain('struct')
    expect(docs.types).toContain('name')
    expect(docs.types).toContain('decimals')
  })

  // ── New IDL format (accounts/events resolved from types) ──

  const newFormatIDL = {
    version: '0.1.0',
    name: 'let_me_buy',
    metadata: { name: 'let_me_buy', version: '0.1.0', spec: '0.1.0' },
    instructions: [],
    accounts: [
      {
        name: 'Receipts',
        discriminator: [222, 245, 237, 64, 59, 49, 29, 246],
      },
    ],
    events: [
      {
        name: 'PurchaseMade',
        discriminator: [73, 37, 99, 22, 201, 228, 56, 21],
      },
    ],
    types: [
      {
        name: 'Receipts',
        type: {
          kind: 'struct',
          fields: [
            { name: 'total_purchases', type: 'u64' },
            { name: 'store_name', type: 'string' },
            { name: 'authority', type: 'pubkey' },
            { name: 'bump', type: 'u8' },
          ],
        },
      },
      {
        name: 'PurchaseMade',
        type: {
          kind: 'struct',
          fields: [
            { name: 'buyer', type: 'pubkey' },
            { name: 'product_name', type: 'string' },
            { name: 'price', type: 'u64' },
            { name: 'timestamp', type: 'i64' },
          ],
        },
      },
    ],
    errors: [],
  }

  test('generates account docs from types array (new IDL format)', () => {
    const docs = generateDocumentation(newFormatIDL as any, 'PROG123', 'http://localhost:8787/api', 'buy')
    expect(docs.accounts).toContain('Receipts')
    expect(docs.accounts).toContain('total_purchases')
    expect(docs.accounts).toContain('store_name')
    expect(docs.accounts).toContain('authority')
    expect(docs.accounts).toContain('bump')
  })

  test('generates event docs from types array (new IDL format)', () => {
    const docs = generateDocumentation(newFormatIDL as any, 'PROG123', 'http://localhost:8787/api', 'buy')
    expect(docs.events).toContain('PurchaseMade')
    expect(docs.events).toContain('buyer')
    expect(docs.events).toContain('product_name')
    expect(docs.events).toContain('price')
    expect(docs.events).toContain('timestamp')
  })

  // ── Codama PDA docs (IMP-1) ──

  const codamaIdlWithConstPdas = {
    kind: 'rootNode',
    standard: 'codama',
    version: '1.0.0',
    program: {
      name: 'subscriptions',
      publicKey: 'PROG123',
      version: '0.1.0',
      instructions: [],
      accounts: [],
      definedTypes: [],
      errors: [],
      pdas: [
        {
          name: 'vault',
          seeds: [
            { kind: 'constantPdaSeedNode', value: { kind: 'stringValueNode', string: 'vault' } },
            { kind: 'variablePdaSeedNode', name: 'owner', type: { kind: 'publicKeyTypeNode' } },
          ],
        },
        {
          name: 'authority',
          seeds: [
            { kind: 'programIdPdaSeedNode' },
          ],
        },
        {
          name: 'rawBytesSeed',
          seeds: [
            // base64 for the raw bytes [0xde, 0xad, 0xbe, 0xef]
            { kind: 'constantPdaSeedNode', value: { kind: 'bytesValueNode', data: '3q2+7w==' } },
          ],
        },
      ],
    },
  }

  test('renders the real constant seed value for a Codama PDA, not "(fixed bytes)" (IMP-1)', () => {
    const docs = generateDocumentation(codamaIdlWithConstPdas as any, 'PROG123', 'http://localhost:8787/api', 'subs')
    expect(docs.pdaAccounts).toContain('`vault`')
    expect(docs.pdaAccounts).not.toContain('(fixed bytes)')
  })

  test('renders base64 for a raw bytesValueNode constant Codama PDA seed (IMP-1)', () => {
    const docs = generateDocumentation(codamaIdlWithConstPdas as any, 'PROG123', 'http://localhost:8787/api', 'subs')
    expect(docs.pdaAccounts).toContain('3q2+7w==')
  })

  test('still special-cases programIdPdaSeedNode as "(program ID)" (IMP-1 regression guard)', () => {
    const docs = generateDocumentation(codamaIdlWithConstPdas as any, 'PROG123', 'http://localhost:8787/api', 'subs')
    expect(docs.pdaAccounts).toContain('(program ID)')
  })
})
