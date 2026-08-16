import { describe, test, expect } from 'bun:test'
import { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, AddressLookupTableAccount } from '@solana/web3.js'
import {
  buildTransaction,
  validateBuildRequest,
  decodeAnchorErrorFromLogs,
  extractComputeUnits,
  assessRiskLevelAnchor,
  packInstructionsIntoBatches,
} from '../src/services/tx-builder'

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

  describe('remainingAccounts (Anchor remaining_accounts)', () => {
    test('appends extra account metas after the IDL-named accounts, in order', async () => {
      const idl = {
        name: 'remaining_accounts_program',
        version: '0.31.0',
        instructions: [
          {
            name: 'buy',
            accounts: [
              { name: 'user', isMut: true, isSigner: true },
              { name: 'mint', isMut: false, isSigner: false },
            ],
            args: [],
          },
        ],
      }

      const result = await buildTransaction(
        idl as any,
        'buy',
        {
          accounts: {
            user: '11111111111111111111111111111112',
            mint: '11111111111111111111111111111113',
          },
          args: {},
          feePayer: '11111111111111111111111111111112',
          recentBlockhash: '11111111111111111111111111111111',
          remainingAccounts: [
            { pubkey: '11111111111111111111111111111114', isWritable: true },
            { pubkey: '11111111111111111111111111111115', isSigner: true },
          ],
        },
        '11111111111111111111111111111111',
        'https://example-rpc.invalid',
        { cluster: 'devnet', rpcUrlHost: 'example-rpc.invalid' },
      )

      expect(result.accounts.map((a) => a.pubkey)).toEqual([
        '11111111111111111111111111111112',
        '11111111111111111111111111111113',
        '11111111111111111111111111111114',
        '11111111111111111111111111111115',
      ])
      expect(result.accounts[2]).toMatchObject({ isSigner: false, isWritable: true })
      expect(result.accounts[3]).toMatchObject({ isSigner: true, isWritable: false })
    })
  })

  describe('riskLevel + decodedError + compute units', () => {
    test('writable signer + transfer keyword in instruction name → high risk', async () => {
      const idl = {
        name: 'risky_program',
        version: '0.1.0',
        instructions: [
          {
            name: 'transfer',
            discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
            accounts: [
              { name: 'from', isMut: true, isSigner: true },
              { name: 'to', isMut: true, isSigner: false },
            ],
            args: [{ name: 'amount', type: 'u64' }],
          },
        ],
      }

      const result = await buildTransaction(
        idl as any,
        'transfer',
        {
          accounts: {
            from: '11111111111111111111111111111111',
            to: '22222222222222222222222222222222',
          },
          args: { amount: 1000 },
          feePayer: '11111111111111111111111111111111',
          recentBlockhash: '11111111111111111111111111111111',
        },
        '11111111111111111111111111111111',
        'https://example-rpc.invalid',
        { cluster: 'devnet', rpcUrlHost: 'example-rpc.invalid' },
      )

      expect(result.riskLevel).toBe('high')
      expect(result.riskReasons.length).toBeGreaterThan(0)
      expect(result.decodedError).toBeNull()
    })

    test('read-only instruction with no writable accounts → low risk', async () => {
      const idl = {
        name: 'view_program',
        version: '0.1.0',
        instructions: [
          {
            name: 'view',
            discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
            accounts: [{ name: 'state', isMut: false, isSigner: false }],
            args: [],
          },
        ],
      }

      const result = await buildTransaction(
        idl as any,
        'view',
        {
          accounts: { state: '11111111111111111111111111111111' },
          args: {},
          feePayer: '11111111111111111111111111111111',
          recentBlockhash: '11111111111111111111111111111111',
        },
        '11111111111111111111111111111111',
        'https://example-rpc.invalid',
        { cluster: 'devnet', rpcUrlHost: 'example-rpc.invalid' },
      )

      expect(result.riskLevel).toBe('low')
    })

    test('decodeAnchorErrorFromLogs matches Custom program error: 0x<hex>', () => {
      const logs = [
        'Program X invoke [1]',
        'Program log: AnchorError occurred',
        'Program X failed: custom program error: 0x1771',
      ]
      const errors = [
        { code: 6001, name: 'NotEnoughFunds', msg: 'Not enough funds in vault' },
        { code: 6000, name: 'WrongAuthority', msg: 'Authority mismatch' },
      ]
      const decoded = decodeAnchorErrorFromLogs(logs, errors as any)
      expect(decoded?.code).toBe(0x1771)
      expect(decoded?.name).toBe('NotEnoughFunds')
    })

    test('decodeAnchorErrorFromLogs returns null for unknown codes', () => {
      const decoded = decodeAnchorErrorFromLogs(
        ['Program X failed: custom program error: 0xdead'],
        [{ code: 1, name: 'A', msg: 'a' }] as any,
      )
      expect(decoded).toBeNull()
    })

    test('extractComputeUnits parses standard log line', () => {
      const cu = extractComputeUnits([
        'Program X invoke [1]',
        'Program X consumed 12345 of 200000 compute units',
        'Program X success',
      ])
      expect(cu).toBe(12345)
    })

    test('extractComputeUnits reports the OUTER program, not an inner CPI', () => {
      // Real mainnet logs (let_me_buy make_purchase, tx 2KxAbvtke5s...). The inner SPL
      // Token CPI returns first, so its `consumed` line comes first -- a first-match scan
      // reported 105 for a transaction the chain charged 36,399 for.
      const cu = extractComputeUnits([
        'Program BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya invoke [1]',
        'Program log: Instruction: MakePurchase',
        'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]',
        'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 105 of 173022 compute units',
        'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
        'Program BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya consumed 36399 of 200000 compute units',
        'Program BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya success',
      ])
      expect(cu).toBe(36399)
    })

    test('extractComputeUnits sums a multi-instruction transaction', () => {
      // The caller is billed for every top-level instruction, so no single line is it.
      const cu = extractComputeUnits([
        'Program A invoke [1]',
        'Program A consumed 1000 of 200000 compute units',
        'Program A success',
        'Program B invoke [1]',
        'Program C invoke [2]',
        'Program C consumed 50 of 199000 compute units',
        'Program C success',
        'Program B consumed 2000 of 199000 compute units',
        'Program B success',
      ])
      expect(cu).toBe(3000)
    })

    test('the fee payer alone no longer makes every instruction high risk', () => {
      const instruction = {
        name: 'poke',
        accounts: [
          { name: 'payer', isMut: true, isSigner: true },
          { name: 'log', isMut: true, isSigner: false },
        ],
        args: [],
      } as any
      const accounts = { payer: 'FeePayer1', log: 'Log1' }
      const risk = assessRiskLevelAnchor(instruction, accounts, {}, accounts.payer)
      expect(risk.level).not.toBe('high')
    })

    test('a second writable signer IS still high risk', () => {
      const instruction = {
        name: 'poke',
        accounts: [
          { name: 'payer', isMut: true, isSigner: true },
          { name: 'other', isMut: true, isSigner: true },
        ],
        args: [],
      } as any
      const accounts = { payer: 'FeePayer1', other: 'Other1' }
      const risk = assessRiskLevelAnchor(instruction, accounts, {}, accounts.payer)
      expect(risk.level).toBe('high')
      expect(risk.reasons.join(' ')).toContain('other')
    })

    test('a purchase is high risk for a reason that is actually about the purchase', () => {
      const instruction = {
        name: 'make_purchase',
        accounts: [{ name: 'signer', isMut: true, isSigner: true }],
        args: [],
      } as any
      const accounts = { signer: 'Buyer1' }
      const risk = assessRiskLevelAnchor(instruction, accounts, {}, accounts.signer)
      expect(risk.level).toBe('high')
      expect(risk.reasons.join(' ')).toContain('make_purchase')
    })

    test('extractComputeUnits returns null when absent', () => {
      expect(extractComputeUnits(['Program X invoke [1]', 'Program X success'])).toBeNull()
      expect(extractComputeUnits(null)).toBeNull()
    })
  })

  describe('packInstructionsIntoBatches (multi-transaction flow output)', () => {
    // Dummy 32-byte-decodable values — packInstructionsIntoBatches never talks to the
    // network, it only needs base58 values that decode to the right byte length.
    const PAYER = new PublicKey('11111111111111111111111111111111')
    const BLOCKHASH = '11111111111111111111111111111111'

    function makeBigInstruction(seed: number, dataSize: number): TransactionInstruction {
      // A unique program id + unique writable key per instruction (derived deterministically
      // from `seed`) so instructions can't accidentally dedupe into a smaller message than a
      // real flow's distinct-account instructions would produce.
      const programId = new PublicKey(new Uint8Array(32).fill(seed))
      const key = new PublicKey(new Uint8Array(32).fill(seed + 1))
      return new TransactionInstruction({
        programId,
        keys: [{ pubkey: key, isSigner: false, isWritable: true }],
        data: Buffer.alloc(dataSize, seed),
      })
    }

    test('a small instruction set stays in one transaction', () => {
      const instructions = [makeBigInstruction(10, 50), makeBigInstruction(20, 50)]
      const batches = packInstructionsIntoBatches(instructions, PAYER, BLOCKHASH)
      expect(batches).toHaveLength(1)
      expect(batches[0]).toHaveLength(2)
    })

    test('an oversized instruction set splits into multiple transactions, each within the packet limit', () => {
      // ~900 bytes of instruction data each; two together comfortably exceed 1232 bytes
      // once account keys + header + blockhash overhead are added, one alone does not.
      const instructions = [
        makeBigInstruction(10, 900),
        makeBigInstruction(20, 900),
        makeBigInstruction(30, 900),
        makeBigInstruction(40, 900),
      ]
      const batches = packInstructionsIntoBatches(instructions, PAYER, BLOCKHASH)

      expect(batches.length).toBeGreaterThan(1)
      // every batch actually fits — re-verify via the same compile+serialize path the
      // function itself uses, rather than trusting its internal accounting blindly
      for (const batch of batches) {
        const message = new TransactionMessage({ payerKey: PAYER, recentBlockhash: BLOCKHASH, instructions: batch }).compileToV0Message()
        const serialized = new VersionedTransaction(message).serialize()
        expect(serialized.length).toBeLessThanOrEqual(1232)
      }
    })

    test('order is preserved — flattening the batches reproduces the original instruction order exactly', () => {
      const instructions = [
        makeBigInstruction(10, 900),
        makeBigInstruction(20, 900),
        makeBigInstruction(30, 900),
        makeBigInstruction(40, 900),
        makeBigInstruction(50, 900),
      ]
      const batches = packInstructionsIntoBatches(instructions, PAYER, BLOCKHASH)
      const flattened = batches.flat()

      expect(flattened).toHaveLength(instructions.length)
      for (let i = 0; i < instructions.length; i++) {
        expect(flattened[i].programId.equals(instructions[i].programId)).toBe(true)
      }
    })

    test('a single instruction that alone exceeds the packet limit throws (unsplittable)', () => {
      const hugeInstruction = makeBigInstruction(10, 1300)
      expect(() => packInstructionsIntoBatches([hugeInstruction], PAYER, BLOCKHASH)).toThrow(
        /cannot be split across transactions/,
      )
    })

    test('throws on an empty instruction list', () => {
      expect(() => packInstructionsIntoBatches([], PAYER, BLOCKHASH)).toThrow(/at least one instruction/)
    })

    test('a real address lookup table lets an account-key-bound instruction set fit in fewer transactions', () => {
      // Bottleneck here is UNIQUE ACCOUNT COUNT, not instruction data (ALT only shrinks
      // account-key references, never instruction data) — one shared program id, one
      // unique writable account per instruction, zero data payload.
      const sharedProgramId = new PublicKey(new Uint8Array(32).fill(99))
      const accountKeys = Array.from({ length: 40 }, (_, i) => new PublicKey(new Uint8Array(32).fill(i + 1)))
      const instructions = accountKeys.map(
        (key) => new TransactionInstruction({ programId: sharedProgramId, keys: [{ pubkey: key, isSigner: false, isWritable: true }], data: Buffer.alloc(0) }),
      )

      const withoutAlt = packInstructionsIntoBatches(instructions, PAYER, BLOCKHASH)
      expect(withoutAlt.length).toBeGreaterThan(1) // too many unique 32-byte account keys for one packet

      const lookupTable = new AddressLookupTableAccount({
        key: new PublicKey(new Uint8Array(32).fill(200)),
        state: {
          deactivationSlot: BigInt('0xffffffffffffffff'), // never deactivated
          lastExtendedSlot: 0,
          lastExtendedSlotStartIndex: 0,
          addresses: accountKeys,
        },
      })
      const withAlt = packInstructionsIntoBatches(instructions, PAYER, BLOCKHASH, [lookupTable])
      expect(withAlt.length).toBeLessThan(withoutAlt.length)

      // and every resulting transaction still actually fits, same as the non-ALT case
      for (const batch of withAlt) {
        const message = new TransactionMessage({ payerKey: PAYER, recentBlockhash: BLOCKHASH, instructions: batch }).compileToV0Message([lookupTable])
        expect(new VersionedTransaction(message).serialize().length).toBeLessThanOrEqual(1232)
      }
    })
  })
})
