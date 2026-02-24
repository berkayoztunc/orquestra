import { describe, test, expect } from 'bun:test'
import { listPdaAccounts, derivePda } from '../src/services/pda'

// Minimal IDL that mirrors the testid.json "let_me_buy" program
const TEST_PROGRAM_ID = 'BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya'

const sampleIdl: any = {
  version: '0.1.0',
  name: 'let_me_buy',
  metadata: { name: 'let_me_buy', version: '0.1.0', spec: '0.1.0' },
  instructions: [
    {
      name: 'initialize',
      accounts: [
        {
          name: 'receipts',
          writable: true,
          pda: {
            seeds: [
              { kind: 'const', value: [114, 101, 99, 101, 105, 112, 116, 115] }, // "receipts"
              { kind: 'arg', path: 'store_name' },
            ],
          },
        },
        { name: 'authority', writable: true, signer: true },
        { name: 'system_program', address: '11111111111111111111111111111111' },
      ],
      args: [{ name: 'store_name', type: 'string' }],
    },
    {
      name: 'make_purchase',
      accounts: [
        {
          name: 'receipts',
          writable: true,
          pda: {
            seeds: [
              { kind: 'const', value: [114, 101, 99, 101, 105, 112, 116, 115] },
              { kind: 'arg', path: 'store_name' },
            ],
          },
        },
        { name: 'signer', writable: true, signer: true },
        {
          name: 'sender_token_account',
          writable: true,
          pda: {
            seeds: [
              { kind: 'account', path: 'signer' },
              { kind: 'account', path: 'token_program' },
              { kind: 'account', path: 'mint' },
            ],
            program: {
              kind: 'const',
              value: [
                140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41,
                20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132,
                4, 142, 123, 216, 219, 233, 248, 89,
              ],
            },
          },
        },
        { name: 'mint' },
        { name: 'token_program', address: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      ],
      args: [
        { name: 'store_name', type: 'string' },
        { name: 'product_name', type: 'string' },
        { name: 'table_number', type: 'u8' },
      ],
    },
  ],
  accounts: [],
  types: [],
  errors: [],
  events: [],
}

describe('PDA Service', () => {
  describe('listPdaAccounts', () => {
    test('discovers all PDA accounts across instructions', () => {
      const pdas = listPdaAccounts(sampleIdl)
      expect(pdas.length).toBe(3) // receipts in initialize, receipts in make_purchase, sender_token_account
    })

    test('returns seed info for const seeds', () => {
      const pdas = listPdaAccounts(sampleIdl)
      const initReceipts = pdas.find(
        (p) => p.instruction === 'initialize' && p.account === 'receipts',
      )
      expect(initReceipts).toBeDefined()
      expect(initReceipts!.seeds[0].kind).toBe('const')
      expect(initReceipts!.seeds[0].description).toBe('receipts')
    })

    test('returns seed info for arg seeds with type', () => {
      const pdas = listPdaAccounts(sampleIdl)
      const initReceipts = pdas.find(
        (p) => p.instruction === 'initialize' && p.account === 'receipts',
      )
      expect(initReceipts!.seeds[1].kind).toBe('arg')
      expect(initReceipts!.seeds[1].name).toBe('store_name')
      expect(initReceipts!.seeds[1].type).toBe('string')
    })

    test('detects cross-program PDAs', () => {
      const pdas = listPdaAccounts(sampleIdl)
      const senderAta = pdas.find((p) => p.account === 'sender_token_account')
      expect(senderAta).toBeDefined()
      expect(senderAta!.customProgram).toBeTruthy()
      // ATA program ID
      expect(senderAta!.seeds.length).toBe(3)
      expect(senderAta!.seeds.every((s) => s.kind === 'account')).toBe(true)
    })

    test('returns null customProgram for standard PDAs', () => {
      const pdas = listPdaAccounts(sampleIdl)
      const initReceipts = pdas.find(
        (p) => p.instruction === 'initialize' && p.account === 'receipts',
      )
      expect(initReceipts!.customProgram).toBeNull()
    })
  })

  describe('derivePda', () => {
    test('derives a PDA with const + string arg seeds', async () => {
      const result = await derivePda(
        sampleIdl,
        TEST_PROGRAM_ID,
        'initialize',
        'receipts',
        { store_name: 'my-store' },
      )

      expect(result.pda).toBeTruthy()
      expect(typeof result.pda).toBe('string')
      expect(result.pda.length).toBeGreaterThanOrEqual(32)
      expect(result.bump).toBeGreaterThanOrEqual(0)
      expect(result.bump).toBeLessThanOrEqual(255)
      expect(result.programId).toBe(TEST_PROGRAM_ID)
      expect(result.seeds.length).toBe(2)
      expect(result.seeds[0].kind).toBe('const')
      expect(result.seeds[1].kind).toBe('arg')
      expect(result.seeds[1].name).toBe('store_name')
      expect(result.seeds[1].value).toBe('my-store')
    })

    test('same inputs produce same PDA (deterministic)', async () => {
      const r1 = await derivePda(sampleIdl, TEST_PROGRAM_ID, 'initialize', 'receipts', { store_name: 'alpha' })
      const r2 = await derivePda(sampleIdl, TEST_PROGRAM_ID, 'initialize', 'receipts', { store_name: 'alpha' })
      expect(r1.pda).toBe(r2.pda)
      expect(r1.bump).toBe(r2.bump)
    })

    test('different seed values produce different PDAs', async () => {
      const r1 = await derivePda(sampleIdl, TEST_PROGRAM_ID, 'initialize', 'receipts', { store_name: 'store-a' })
      const r2 = await derivePda(sampleIdl, TEST_PROGRAM_ID, 'initialize', 'receipts', { store_name: 'store-b' })
      expect(r1.pda).not.toBe(r2.pda)
    })

    test('throws for missing arg seed value', async () => {
      await expect(
        derivePda(sampleIdl, TEST_PROGRAM_ID, 'initialize', 'receipts', {}),
      ).rejects.toThrow(/Missing seed value.*store_name/)
    })

    test('throws for nonexistent instruction', async () => {
      await expect(
        derivePda(sampleIdl, TEST_PROGRAM_ID, 'nonexistent', 'receipts', {}),
      ).rejects.toThrow(/not found/)
    })

    test('throws for nonexistent account', async () => {
      await expect(
        derivePda(sampleIdl, TEST_PROGRAM_ID, 'initialize', 'nonexistent', {}),
      ).rejects.toThrow(/not found/)
    })

    test('throws for account without PDA', async () => {
      await expect(
        derivePda(sampleIdl, TEST_PROGRAM_ID, 'initialize', 'authority', {}),
      ).rejects.toThrow(/no PDA seeds/)
    })

    test('derives cross-program PDA (ATA-style) with account seeds', async () => {
      // Use well-known Solana addresses for test
      const signerPubkey = '11111111111111111111111111111111'
      const tokenProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
      const mint = 'So11111111111111111111111111111111111111112'

      const result = await derivePda(
        sampleIdl,
        TEST_PROGRAM_ID,
        'make_purchase',
        'sender_token_account',
        { signer: signerPubkey, token_program: tokenProgram, mint },
      )

      expect(result.pda).toBeTruthy()
      expect(result.bump).toBeGreaterThanOrEqual(0)
      // Should use the ATA program, not the main program
      expect(result.programId).not.toBe(TEST_PROGRAM_ID)
      expect(result.seeds.length).toBe(3)
      expect(result.seeds.every((s) => s.kind === 'account')).toBe(true)
    })
  })
})
