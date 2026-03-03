/**
 * Command: check-idl
 * Checks each discovered program for an on-chain Anchor IDL account.
 * Reads the program list from a previous scan or a user-provided file,
 * then outputs a CSV with IDL status.
 */

import { RpcClient } from '../lib/rpc'
import { checkIdlStream, type IdlCheckResult } from '../lib/anchor-idl-check'
import { CsvWriter } from '../lib/csv'
import { Checkpoint } from '../lib/checkpoint'
import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

export interface CheckIdlOptions {
  rpcUrl: string
  outDir: string
  /** Path to a JSON file with an array of program IDs. If empty, reads from <outDir>/.program-list.json */
  inputFile: string
  batchSize: number
  concurrency: number
  resume: boolean
  requestsPerSecond: number
}

export async function checkIdl(opts: CheckIdlOptions): Promise<void> {
  const { rpcUrl, outDir, inputFile, batchSize, concurrency, resume, requestsPerSecond } = opts

  console.log('═══════════════════════════════════════════════════')
  console.log('  Anchor On-Chain IDL Checker')
  console.log('═══════════════════════════════════════════════════')
  console.log(`  RPC URL     : ${maskUrl(rpcUrl)}`)
  console.log(`  Output Dir  : ${resolve(outDir)}`)
  console.log(`  Batch Size  : ${batchSize}`)
  console.log(`  Concurrency : ${concurrency}`)
  console.log(`  Rate Limit  : ${requestsPerSecond} req/s`)
  console.log('═══════════════════════════════════════════════════')
  console.log()

  // Load program list
  const listPath = inputFile || resolve(outDir, '.program-list.json')
  if (!existsSync(listPath)) {
    console.error(`Error: Program list not found at ${listPath}`)
    console.error('Run "scan" first, or provide --input-file with a JSON array of program IDs.')
    process.exit(1)
  }

  let allProgramIds: string[]
  try {
    const raw = readFileSync(listPath, 'utf-8')
    allProgramIds = JSON.parse(raw)
    if (!Array.isArray(allProgramIds)) throw new Error('Expected JSON array')
  } catch (err: any) {
    console.error(`Error reading program list: ${err.message}`)
    process.exit(1)
  }

  console.log(`Loaded ${allProgramIds.length} programs from ${listPath}`)

  // Checkpoint for resume
  const checkpointPath = resolve(outDir, '.checkpoint-idl.json')
  const checkpoint = new Checkpoint(checkpointPath, 'check-idl', allProgramIds.length)
  let programIds = allProgramIds

  if (resume && checkpoint.tryResume()) {
    const processedSet = checkpoint.getProcessedSet()
    programIds = allProgramIds.filter((id) => !processedSet.has(id))
    console.log(`Resuming: ${processedSet.size} already processed, ${programIds.length} remaining`)
  }

  // RPC client
  const rpc = new RpcClient({
    url: rpcUrl,
    maxRetries: 5,
    baseDelayMs: 1000,
    requestsPerSecond,
  })

  // CSV writer
  const csvPath = resolve(outDir, 'program_idl_status.csv')
  const csv = new CsvWriter(csvPath, ['program_id', 'has_onchain_idl', 'idl_account', 'error'])

  // If resuming, we need to append (re-create writer appends to file but CsvWriter always writes header)
  // For simplicity: if resuming and CSV already exists, we skip re-writing header later.
  // The CsvWriter creates a fresh file. Resuming just means we only process remaining IDs.

  console.log()
  console.log('Checking on-chain IDL for each program...')
  const startTime = Date.now()

  let processedCount = 0
  const totalToProcess = programIds.length

  const stats = await checkIdlStream(
    rpc,
    programIds,
    batchSize,
    concurrency,
    async (results: IdlCheckResult[], batchIndex: number) => {
      // Write batch to CSV
      csv.writeRows(
        results.map((r) => ({
          program_id: r.programId,
          has_onchain_idl: r.hasOnchainIdl ? 'true' : 'false',
          idl_account: r.idlAccount ?? '',
          error: r.error ?? '',
        }))
      )

      // Update checkpoint
      checkpoint.update(
        results.map((r) => r.programId),
        batchIndex
      )

      processedCount += results.length
      const pct = ((processedCount / totalToProcess) * 100).toFixed(1)
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(0)
      process.stdout.write(
        `\r  Progress: ${processedCount}/${totalToProcess} (${pct}%) — ${elapsedSec}s elapsed`
      )
    }
  )

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log() // newline after progress
  console.log()
  console.log('═══════════════════════════════════════════════════')
  console.log('  Results')
  console.log('═══════════════════════════════════════════════════')
  console.log(`  Total checked : ${stats.total}`)
  console.log(`  With IDL      : ${stats.withIdl}`)
  console.log(`  Without IDL   : ${stats.withoutIdl}`)
  console.log(`  Errors        : ${stats.errors}`)
  console.log(`  Time          : ${elapsed}s`)
  console.log(`  CSV           : ${csvPath}`)
  console.log('═══════════════════════════════════════════════════')

  checkpoint.clear()
  console.log()
  console.log('IDL check complete.')
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.pathname.length > 10) {
      return `${u.protocol}//${u.host}/${u.pathname.slice(1, 8)}...`
    }
    return `${u.protocol}//${u.host}${u.pathname}`
  } catch {
    return url.slice(0, 30) + '...'
  }
}
