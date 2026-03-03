/**
 * Anchor On-Chain IDL Checker
 *
 * Anchor programs store their IDL in a deterministic PDA:
 *   seeds = ["anchor:idl", programId]
 *   owner = programId
 *
 * For newer Anchor versions (≥0.30), the IDL account PDA is:
 *   seeds = ["anchor:idl", programId]
 *   but may also be at a legacy address derived differently.
 *
 * This module checks if such an account exists for a given program.
 * It does NOT download or parse the full IDL — just checks existence.
 */

import { RpcClient } from './rpc'

/** Base58 alphabet for encoding */
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export interface IdlCheckResult {
  programId: string
  hasOnchainIdl: boolean
  idlAccount: string | null
  error: string | null
}

/**
 * Derive the Anchor IDL account address for a given program.
 * PDA = findProgramAddress(["anchor:idl", programId], programId)
 */
function deriveIdlAddress(programIdBase58: string): string {
  // We'll use @solana/web3.js PublicKey for PDA derivation
  // but to avoid heavy deps, we do it via the RPC client approach:
  // Actually, we need crypto for PDA derivation. Let's use a lightweight approach.
  // Since we're running in Bun, we can use the full PublicKey.
  // We'll defer to the batch checker which uses getAccountInfo directly
  // on the well-known IDL address.
  //
  // For now, we produce the address string and let the caller use it.
  // The actual derivation happens in checkIdlBatch using web3.js.
  throw new Error('Use checkIdlBatch which handles PDA derivation internally')
}

/**
 * Check a batch of programs for on-chain Anchor IDL.
 * Derives both old-style (createWithSeed) and new-style (PDA) IDL addresses,
 * then checks if either account exists.
 */
export async function checkIdlBatch(
  rpc: RpcClient,
  programIds: string[],
  concurrency: number = 10
): Promise<IdlCheckResult[]> {
  const { PublicKey } = await import('@solana/web3.js')

  // Step 1: Derive IDL addresses for all programs (both old and new Anchor format)
  const derivations: Array<{
    programId: string
    /** Old Anchor (<0.30): createWithSeed(base, "anchor:idl", program) */
    oldIdlAddress: string | null
    /** New Anchor (>=0.30): PDA(["anchor:idl", program], program) */
    newIdlAddress: string | null
    error: string | null
  }> = []

  for (const pid of programIds) {
    try {
      const programPubkey = new PublicKey(pid)

      // Old-style: base = PDA([], program), then createWithSeed(base, "anchor:idl", program)
      const [base] = PublicKey.findProgramAddressSync([], programPubkey)
      const oldIdl = await PublicKey.createWithSeed(base, 'anchor:idl', programPubkey)

      // New-style: PDA(["anchor:idl", program], program)
      const [newIdl] = PublicKey.findProgramAddressSync(
        [Buffer.from('anchor:idl'), programPubkey.toBuffer()],
        programPubkey
      )

      derivations.push({
        programId: pid,
        oldIdlAddress: oldIdl.toBase58(),
        newIdlAddress: newIdl.toBase58(),
        error: null,
      })
    } catch (err: any) {
      derivations.push({
        programId: pid,
        oldIdlAddress: null,
        newIdlAddress: null,
        error: `PDA derivation failed: ${err.message}`,
      })
    }
  }

  // Step 2: Check all IDL addresses via getMultipleAccounts
  const results: IdlCheckResult[] = []

  const chunkSize = Math.min(concurrency, 50) // keep chunks manageable
  for (let i = 0; i < derivations.length; i += chunkSize) {
    const chunk = derivations.slice(i, i + chunkSize)
    const addressesToCheck = chunk.filter((d) => d.oldIdlAddress !== null)

    if (addressesToCheck.length === 0) {
      for (const d of chunk) {
        results.push({
          programId: d.programId,
          hasOnchainIdl: false,
          idlAccount: null,
          error: d.error,
        })
      }
      continue
    }

    try {
      // Collect all addresses to check: old + new for each program
      // getMultipleAccounts can handle up to 100 addresses per call
      const allAddresses: string[] = []
      for (const d of addressesToCheck) {
        allAddresses.push(d.oldIdlAddress!)
        allAddresses.push(d.newIdlAddress!)
      }

      let accountInfos: (any | null)[]
      try {
        const result = await rpc.call<{ value: (any | null)[] }>('getMultipleAccounts', [
          allAddresses,
          { encoding: 'base64', commitment: 'confirmed' },
        ])
        accountInfos = result.value
      } catch {
        // Fallback: individual sequential calls
        accountInfos = []
        for (const addr of allAddresses) {
          try {
            const res = await rpc.call<{ value: any | null }>('getAccountInfo', [
              addr,
              { encoding: 'base64', commitment: 'confirmed' },
            ])
            accountInfos.push(res.value)
          } catch (e: any) {
            accountInfos.push(new Error(e.message))
          }
        }
      }

      let pairIdx = 0
      for (const d of chunk) {
        if (d.oldIdlAddress === null) {
          results.push({
            programId: d.programId,
            hasOnchainIdl: false,
            idlAccount: null,
            error: d.error,
          })
        } else {
          const oldInfo = accountInfos[pairIdx * 2]
          const newInfo = accountInfos[pairIdx * 2 + 1]
          pairIdx++

          const oldErr = oldInfo instanceof Error ? oldInfo.message : null
          const newErr = newInfo instanceof Error ? newInfo.message : null

          const oldExists = !(oldInfo instanceof Error) && oldInfo !== null && oldInfo !== undefined
          const newExists = !(newInfo instanceof Error) && newInfo !== null && newInfo !== undefined

          if (oldExists) {
            results.push({
              programId: d.programId,
              hasOnchainIdl: true,
              idlAccount: d.oldIdlAddress,
              error: null,
            })
          } else if (newExists) {
            results.push({
              programId: d.programId,
              hasOnchainIdl: true,
              idlAccount: d.newIdlAddress,
              error: null,
            })
          } else {
            results.push({
              programId: d.programId,
              hasOnchainIdl: false,
              idlAccount: d.oldIdlAddress,
              error: oldErr || newErr || null,
            })
          }
        }
      }
    } catch (err: any) {
      // If entire batch failed, mark all as error
      for (const d of chunk) {
        results.push({
          programId: d.programId,
          hasOnchainIdl: false,
          idlAccount: d.oldIdlAddress,
          error: `Batch RPC error: ${err.message}`,
        })
      }
    }
  }

  return results
}

/**
 * Stream-check IDL for programs, yielding results as they come.
 * Processes programs in batches and calls onBatch for each completed batch.
 */
export async function checkIdlStream(
  rpc: RpcClient,
  programIds: string[],
  batchSize: number,
  concurrency: number,
  onBatch: (results: IdlCheckResult[], batchIndex: number) => void | Promise<void>
): Promise<{ total: number; withIdl: number; withoutIdl: number; errors: number }> {
  let total = 0
  let withIdl = 0
  let withoutIdl = 0
  let errors = 0
  let batchIndex = 0

  for (let i = 0; i < programIds.length; i += batchSize) {
    const batch = programIds.slice(i, i + batchSize)
    const results = await checkIdlBatch(rpc, batch, concurrency)

    for (const r of results) {
      total++
      if (r.error) errors++
      else if (r.hasOnchainIdl) withIdl++
      else withoutIdl++
    }

    await onBatch(results, batchIndex++)
  }

  return { total, withIdl, withoutIdl, errors }
}
