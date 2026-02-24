import { describe, test, expect } from 'bun:test'
import { validateIDL, parseIDL, getInstruction, resolveType, getDefaultValue, extractPDASeeds, getDefinedTypeName, isDefinedType, lookupType, resolveDefinedType, expandInstructionArgs, resolveAccountFields, resolveEventFields, normalizeField } from '../src/services/idl-parser'

const sampleIDL = {
  version: '0.1.0',
  name: 'test_program',
  metadata: { name: 'test_program', version: '0.1.0', spec: '0.1.0' },
  instructions: [
    {
      name: 'initialize',
      docs: ['Initialize the program'],
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
      docs: [],
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
          { name: 'label', type: 'string' },
        ],
      },
    },
  ],
  types: [
    {
      name: 'TransferParams',
      type: {
        kind: 'struct',
        fields: [
          { name: 'amount', type: 'u64' },
          { name: 'memo', type: { option: 'string' } },
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
}

describe('IDL Parser', () => {
  describe('validateIDL', () => {
    test('validates a correct IDL', () => {
      const result = validateIDL(sampleIDL)
      expect(result.valid).toBe(true)
      expect(result.errors.length).toBe(0)
    })

    test('rejects IDL without name', () => {
      const result = validateIDL({ ...sampleIDL, metadata: { ...sampleIDL.metadata, name: undefined } })
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    test('rejects IDL without version', () => {
      const result = validateIDL({ ...sampleIDL, metadata: { ...sampleIDL.metadata, version: undefined } })
      expect(result.valid).toBe(false)
    })

    test('rejects IDL without instructions', () => {
      const result = validateIDL({ ...sampleIDL, instructions: undefined })
      expect(result.valid).toBe(false)
    })

    test('accepts IDL with empty instructions array', () => {
      const result = validateIDL({ ...sampleIDL, instructions: [] })
      expect(result.valid).toBe(true)
    })

    test('rejects non-object input', () => {
      expect(validateIDL(null).valid).toBe(false)
      expect(validateIDL('hello').valid).toBe(false)
      expect(validateIDL(42).valid).toBe(false)
    })
  })

  describe('parseIDL', () => {
    test('parses a valid IDL into structured data', () => {
      const parsed = parseIDL(sampleIDL as any)
      expect(parsed.programName).toBe('test_program')
      expect(parsed.version).toBe('0.1.0')
      expect(parsed.instructionCount).toBe(2)
      expect(parsed.accountCount).toBe(1)
      expect(parsed.errorCount).toBe(2)
      expect(parsed.eventCount).toBe(1)
    })

    test('includes the full IDL reference', () => {
      const parsed = parseIDL(sampleIDL as any)
      expect(parsed.idl).toBeDefined()
      expect(parsed.idl.name).toBe('test_program')
    })
  })

  describe('getInstruction', () => {
    test('finds an instruction by name', () => {
      const ix = getInstruction(sampleIDL as any, 'initialize')
      expect(ix).toBeDefined()
      expect(ix!.name).toBe('initialize')
      expect(ix!.accounts.length).toBe(3)
      expect(ix!.args.length).toBe(2)
    })

    test('returns undefined for non-existent instruction', () => {
      const ix = getInstruction(sampleIDL as any, 'nonexistent')
      expect(ix).toBeUndefined()
    })
  })

  describe('resolveType', () => {
    test('resolves primitive types', () => {
      expect(resolveType('u64')).toBe('u64')
      expect(resolveType('bool')).toBe('bool')
      expect(resolveType('string')).toBe('string')
      expect(resolveType('publicKey')).toBe('publicKey')
    })

    test('resolves option types', () => {
      expect(resolveType({ option: 'u64' })).toBe('Option<u64>')
    })

    test('resolves vec types', () => {
      expect(resolveType({ vec: 'u8' })).toBe('Vec<u8>')
    })

    test('resolves defined types', () => {
      expect(resolveType({ defined: 'TransferParams' })).toBe('TransferParams')
    })

    test('resolves new-format defined types { defined: { name: "..." } }', () => {
      expect(resolveType({ defined: { name: 'InitTokenParams' } })).toBe('InitTokenParams')
    })

    test('resolves array types', () => {
      expect(resolveType({ array: ['u8', 32] })).toBe('[u8; 32]')
    })
  })

  describe('getDefaultValue', () => {
    test('returns defaults for numeric types', () => {
      expect(getDefaultValue('u64')).toBe(0)
      expect(getDefaultValue('i32')).toBe(0)
      expect(getDefaultValue('f64')).toBe(0)
    })

    test('returns empty string for string type', () => {
      expect(getDefaultValue('string')).toBe('')
    })

    test('returns false for bool', () => {
      expect(getDefaultValue('bool')).toBe(false)
    })

    test('returns null for option types', () => {
      expect(getDefaultValue({ option: 'u64' })).toBeNull()
    })

    test('returns empty array for vec types', () => {
      expect(getDefaultValue({ vec: 'u8' })).toEqual([])
    })
  })

  describe('extractPDASeeds', () => {
    test('extracts PDA seeds from account with pda info', () => {
      const account = {
        name: 'state',
        isMut: true,
        isSigner: false,
        pda: {
          seeds: [
            { kind: 'const', value: 'state' },
            { kind: 'account', value: 'authority' },
          ],
        },
      }
      const seeds = extractPDASeeds(account as any)
      expect(seeds.length).toBe(2)
      expect(seeds[0]).toContain('const')
      expect(seeds[1]).toContain('account')
    })

    test('returns empty array for account without PDA', () => {
      const account = { name: 'authority', isMut: true, isSigner: true }
      const seeds = extractPDASeeds(account as any)
      expect(seeds).toEqual([])
    })
  })

  // ── Defined Type Tests ──────────────────────────────

  const idlWithDefinedTypes = {
    version: '0.1.0',
    name: 'token_program',
    metadata: { name: 'token_program', version: '0.1.0', spec: '0.1.0' },
    instructions: [
      {
        name: 'initialize',
        accounts: [
          { name: 'payer', isMut: true, isSigner: true },
        ],
        args: [
          { name: 'metadata', type: { defined: { name: 'InitTokenParams' } } },
          { name: 'seed1', type: 'string' },
        ],
      },
    ],
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
      {
        name: 'NestedConfig',
        type: {
          kind: 'struct',
          fields: [
            { name: 'params', type: { defined: { name: 'InitTokenParams' } } },
            { name: 'enabled', type: 'bool' },
          ],
        },
      },
    ],
    accounts: [],
    errors: [],
    events: [],
  } as any

  describe('getDefinedTypeName', () => {
    test('returns name for old format { defined: "Name" }', () => {
      expect(getDefinedTypeName({ defined: 'TransferParams' })).toBe('TransferParams')
    })

    test('returns name for new format { defined: { name: "Name" } }', () => {
      expect(getDefinedTypeName({ defined: { name: 'InitTokenParams' } })).toBe('InitTokenParams')
    })

    test('returns null for primitive types', () => {
      expect(getDefinedTypeName('u64')).toBeNull()
      expect(getDefinedTypeName('string')).toBeNull()
    })

    test('returns null for non-defined complex types', () => {
      expect(getDefinedTypeName({ vec: 'u8' })).toBeNull()
      expect(getDefinedTypeName({ option: 'string' })).toBeNull()
    })
  })

  describe('isDefinedType', () => {
    test('returns true for defined types', () => {
      expect(isDefinedType({ defined: 'Foo' })).toBe(true)
      expect(isDefinedType({ defined: { name: 'Foo' } })).toBe(true)
    })

    test('returns false for non-defined types', () => {
      expect(isDefinedType('u64')).toBe(false)
      expect(isDefinedType({ vec: 'u8' })).toBe(false)
    })
  })

  describe('lookupType', () => {
    test('finds a type by name', () => {
      const t = lookupType(idlWithDefinedTypes, 'InitTokenParams')
      expect(t).toBeDefined()
      expect(t!.name).toBe('InitTokenParams')
      expect(t!.type.kind).toBe('struct')
    })

    test('returns undefined for missing type', () => {
      expect(lookupType(idlWithDefinedTypes, 'Nonexistent')).toBeUndefined()
    })
  })

  describe('resolveDefinedType', () => {
    test('resolves struct with primitive fields', () => {
      const resolved = resolveDefinedType(idlWithDefinedTypes, 'InitTokenParams')
      expect(resolved).toBeDefined()
      expect(resolved!.name).toBe('InitTokenParams')
      expect(resolved!.kind).toBe('struct')
      expect(resolved!.fields.length).toBe(4)
      expect(resolved!.fields[0].name).toBe('name')
      expect(resolved!.fields[0].typeStr).toBe('string')
      expect(resolved!.fields[3].name).toBe('decimals')
      expect(resolved!.fields[3].typeStr).toBe('u8')
    })

    test('resolves nested defined types', () => {
      const resolved = resolveDefinedType(idlWithDefinedTypes, 'NestedConfig')
      expect(resolved).toBeDefined()
      expect(resolved!.fields.length).toBe(2)
      expect(resolved!.fields[0].name).toBe('params')
      expect(resolved!.fields[0].isDefinedType).toBe(true)
      expect(resolved!.fields[0].nestedFields).toBeDefined()
      expect(resolved!.fields[0].nestedFields!.length).toBe(4)
    })

    test('returns null for missing type', () => {
      expect(resolveDefinedType(idlWithDefinedTypes, 'Missing')).toBeNull()
    })
  })

  describe('expandInstructionArgs', () => {
    test('expands defined type args with struct fields', () => {
      const ix = idlWithDefinedTypes.instructions[0]
      const expanded = expandInstructionArgs(idlWithDefinedTypes, ix.args)
      expect(expanded.length).toBe(2)

      // First arg: defined type
      expect(expanded[0].name).toBe('metadata')
      expect(expanded[0].isDefinedType).toBe(true)
      expect(expanded[0].definedTypeName).toBe('InitTokenParams')
      expect(expanded[0].fields).toBeDefined()
      expect(expanded[0].fields!.length).toBe(4)
      expect(expanded[0].fields![0].name).toBe('name')

      // Second arg: primitive
      expect(expanded[1].name).toBe('seed1')
      expect(expanded[1].isDefinedType).toBe(false)
      expect(expanded[1].fields).toBeNull()
    })
  })

  describe('getDefaultValue with defined types', () => {
    test('returns default struct object for defined type', () => {
      const defaultVal = getDefaultValue({ defined: { name: 'InitTokenParams' } }, idlWithDefinedTypes)
      expect(defaultVal).toBeDefined()
      expect(typeof defaultVal).toBe('object')
      expect(defaultVal.name).toBe('')
      expect(defaultVal.symbol).toBe('')
      expect(defaultVal.uri).toBe('')
      expect(defaultVal.decimals).toBe(0)
    })

    test('returns null for defined type without IDL', () => {
      expect(getDefaultValue({ defined: { name: 'InitTokenParams' } })).toBeNull()
    })
  })

  // ── New IDL format (spec 0.1.0) — accounts & events resolved from types ──

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
  } as any

  describe('resolveAccountFields', () => {
    test('resolves account fields from types array (new format)', () => {
      const acc = newFormatIDL.accounts[0]
      const resolved = resolveAccountFields(newFormatIDL, acc)
      expect(resolved.kind).toBe('struct')
      expect(resolved.fields.length).toBe(4)
      expect(resolved.fields[0].name).toBe('total_purchases')
      expect(resolved.fields[0].typeStr).toBe('u64')
      expect(resolved.fields[2].name).toBe('authority')
      expect(resolved.fields[2].typeStr).toBe('pubkey')
    })

    test('resolves account fields from inline type (old format)', () => {
      const oldAcc = {
        name: 'StateAccount',
        type: {
          kind: 'struct',
          fields: [
            { name: 'authority', type: 'publicKey' },
            { name: 'balance', type: 'u64' },
          ],
        },
      }
      const resolved = resolveAccountFields({ types: [] } as any, oldAcc)
      expect(resolved.kind).toBe('struct')
      expect(resolved.fields.length).toBe(2)
      expect(resolved.fields[0].name).toBe('authority')
      expect(resolved.fields[1].typeStr).toBe('u64')
    })

    test('returns empty fields for unresolvable account', () => {
      const unknownAcc = { name: 'Unknown', discriminator: [1, 2, 3] }
      const resolved = resolveAccountFields(newFormatIDL, unknownAcc as any)
      expect(resolved.fields).toEqual([])
    })
  })

  describe('resolveEventFields', () => {
    test('resolves event fields from types array (new format)', () => {
      const event = newFormatIDL.events[0]
      const resolved = resolveEventFields(newFormatIDL, event)
      expect(resolved.fields.length).toBe(4)
      expect(resolved.fields[0].name).toBe('buyer')
      expect(resolved.fields[0].typeStr).toBe('pubkey')
      expect(resolved.fields[2].name).toBe('price')
      expect(resolved.fields[2].typeStr).toBe('u64')
    })

    test('resolves event fields from inline data (old format)', () => {
      const oldEvent = {
        name: 'TransferEvent',
        data: [
          { name: 'from', type: 'publicKey' },
          { name: 'amount', type: 'u64' },
        ],
      }
      const resolved = resolveEventFields({ types: [] } as any, oldEvent)
      expect(resolved.fields.length).toBe(2)
      expect(resolved.fields[0].name).toBe('from')
      expect(resolved.fields[1].typeStr).toBe('u64')
    })

    test('returns empty fields for unresolvable event', () => {
      const unknownEvent = { name: 'Unknown', discriminator: [1, 2, 3] }
      const resolved = resolveEventFields(newFormatIDL, unknownEvent as any)
      expect(resolved.fields).toEqual([])
    })
  })

  // ── Tuple struct fields (bare type strings) ──────────────────────

  describe('normalizeField', () => {
    test('passes through normal named field unchanged', () => {
      const field = { name: 'amount', type: 'u64' }
      const result = normalizeField(field, 0)
      expect(result.name).toBe('amount')
      expect(result.type).toBe('u64')
    })

    test('normalizes bare string field to field_N', () => {
      const result = normalizeField('bool' as any, 0)
      expect(result.name).toBe('field_0')
      expect(result.type).toBe('bool')
    })

    test('normalizes unnamed object field to field_N', () => {
      const result = normalizeField({ vec: 'u8' } as any, 2)
      expect(result.name).toBe('field_2')
      expect(result.type).toEqual({ vec: 'u8' })
    })
  })

  describe('resolveType edge cases', () => {
    test('returns unknown for null type', () => {
      expect(resolveType(null)).toBe('unknown')
    })

    test('returns unknown for undefined type', () => {
      expect(resolveType(undefined)).toBe('unknown')
    })

    test('resolves vec of defined type (new format)', () => {
      expect(resolveType({ vec: { defined: { name: 'Shareholder' } } })).toBe('Vec<Shareholder>')
    })
  })


})
