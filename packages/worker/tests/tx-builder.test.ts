import { describe, test, expect } from 'bun:test'
import { buildTransaction, validateBuildRequest } from '../src/services/tx-builder'

async function getLegacyAnchorDiscriminatorHex(instructionName: string): Promise<string> {
  const data = new TextEncoder().encode(`global:${instructionName}`)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const discriminator = new Uint8Array(hashBuffer).slice(0, 8)
  return Array.from(discriminator).map((b) => b.toString(16).padStart(2, '0')).join('')
}

describe('Transaction Builder', () => {
  describe('validateBuildRequest', () => {
    const sampleInstruction = {
      name: 'initialize',
      docs: [],
      accounts: [
        { name: 'authority', isMut: true, isSigner: true },
        { name: 'state', isMut: true, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [{ name: 'amount', type: 'u64' }],
    }

    test('validates a correct build request', () => {
      const result = validateBuildRequest(
        sampleInstruction as any,
        {
          authority: '11111111111111111111111111111111',
          state: '22222222222222222222222222222222',
          systemProgram: '11111111111111111111111111111112',
        },
        { amount: 1000 },
      )
      expect(result.valid).toBe(true)
      expect(result.errors.length).toBe(0)
    })

    test('reports missing required accounts', () => {
      const result = validateBuildRequest(
        sampleInstruction as any,
        { authority: '11111111111111111111111111111111' },
        { amount: 1000 },
      )
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some((e) => e.includes('state'))).toBe(true)
    })

    test('reports missing required args', () => {
      const result = validateBuildRequest(
        sampleInstruction as any,
        {
          authority: '11111111111111111111111111111111',
          state: '22222222222222222222222222222222',
          systemProgram: '11111111111111111111111111111112',
        },
        {},
      )
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('amount'))).toBe(true)
    })

    test('reports unknown accounts', () => {
      const result = validateBuildRequest(
        sampleInstruction as any,
        {
          authority: '11111111111111111111111111111111',
          state: '22222222222222222222222222222222',
          systemProgram: '11111111111111111111111111111112',
          unknownAccount: '33333333333333333333333333333333',
        },
        { amount: 1000 },
      )
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('unknownAccount'))).toBe(true)
    })
  })

  describe('validateBuildRequest with defined types', () => {
    const idlTypes = [
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
    ]

    const instructionWithStruct = {
      name: 'initialize',
      docs: [],
      accounts: [
        { name: 'payer', isMut: true, isSigner: true },
      ],
      args: [
        { name: 'metadata', type: { defined: { name: 'InitTokenParams' } } },
        { name: 'seed1', type: 'string' },
      ],
    }

    test('validates correct struct arg', () => {
      const result = validateBuildRequest(
        instructionWithStruct as any,
        { payer: '11111111111111111111111111111111' },
        {
          metadata: { name: 'USDC', symbol: 'USDC', uri: 'https://example.com', decimals: 6 },
          seed1: 'myseed',
        },
        idlTypes as any,
      )
      expect(result.valid).toBe(true)
    })

    test('reports missing struct fields', () => {
      const result = validateBuildRequest(
        instructionWithStruct as any,
        { payer: '11111111111111111111111111111111' },
        {
          metadata: { name: 'USDC' }, // missing symbol, uri, decimals
          seed1: 'myseed',
        },
        idlTypes as any,
      )
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('symbol'))).toBe(true)
      expect(result.errors.some((e) => e.includes('uri'))).toBe(true)
      expect(result.errors.some((e) => e.includes('decimals'))).toBe(true)
    })

    test('reports error when struct arg is not an object', () => {
      const result = validateBuildRequest(
        instructionWithStruct as any,
        { payer: '11111111111111111111111111111111' },
        {
          metadata: 'not_an_object',
          seed1: 'myseed',
        },
        idlTypes as any,
      )
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('must be an object'))).toBe(true)
    })

    test('works without idlTypes (backward compatible)', () => {
      const result = validateBuildRequest(
        instructionWithStruct as any,
        { payer: '11111111111111111111111111111111' },
        {
          metadata: { name: 'USDC', symbol: 'USDC', uri: 'https://example.com', decimals: 6 },
          seed1: 'myseed',
        },
      )
      // Without idlTypes, struct field validation is skipped
      expect(result.valid).toBe(true)
    })
  })

  describe('buildTransaction discriminator compatibility', () => {
    test('uses explicit discriminator bytes when provided in IDL instruction', async () => {
      const idl = {
        name: 'root_program',
        version: '0.31.0',
        instructions: [
          {
            name: 'initialize',
            discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
            accounts: [],
            args: [],
          },
        ],
      }

      const result = await buildTransaction(
        idl as any,
        'initialize',
        {
          accounts: {},
          args: {},
          feePayer: '11111111111111111111111111111111',
          recentBlockhash: '11111111111111111111111111111111',
        },
        '11111111111111111111111111111111',
        'https://example-rpc.invalid',
        { cluster: 'devnet', rpcUrlHost: 'example-rpc.invalid' },
      )

      expect(result.instruction.data.startsWith('0102030405060708')).toBe(true)
      expect(result.message).toContain('root_program.initialize')
    })

    test('falls back to legacy hash-based discriminator when explicit one is absent', async () => {
      const idl = {
        name: 'fallback_program',
        version: '0.31.0',
        instructions: [
          {
            name: 'initialize',
            accounts: [],
            args: [],
          },
        ],
      }

      const result = await buildTransaction(
        idl as any,
        'initialize',
        {
          accounts: {},
          args: {},
          feePayer: '11111111111111111111111111111111',
          recentBlockhash: '11111111111111111111111111111111',
        },
        '11111111111111111111111111111111',
        'https://example-rpc.invalid',
        { cluster: 'devnet', rpcUrlHost: 'example-rpc.invalid' },
      )

      const expectedHex = await getLegacyAnchorDiscriminatorHex('initialize')
      expect(result.instruction.data.startsWith(expectedHex)).toBe(true)
      expect(result.instruction.data.startsWith('0102030405060708')).toBe(false)
    })
  })
})
