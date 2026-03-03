/**
 * Command: scan-programs
 * Scans the Solana cluster for all executable programs and outputs a CSV.
 */

import { RpcClient } from '../lib/rpc'
import { discoverPrograms, type DiscoveredProgram } from '../lib/program-discovery'
import { CsvWriter } from '../lib/csv'
import { Checkpoint } from '../lib/checkpoint'
import { resolve } from 'node:path'

export interface ScanProgramsOptions {
  rpcUrl: string
  outDir: string
  maxPrograms: number
  includeLegacyV2: boolean
  includeLegacyV1: boolean
  resume: boolean
  requestsPerSecond: number
}

export async function scanPrograms(opts: ScanProgramsOptions): Promise<void> {
  const {
    rpcUrl,
    outDir,
    maxPrograms,
    includeLegacyV2,
    includeLegacyV1,
    resume,
    requestsPerSecond,
  } = opts

  console.log('═══════════════════════════════════════════════════')
  console.log('  Solana Program Scanner')
  console.log('═══════════════════════════════════════════════════')
  console.log(`  RPC URL     : ${maskUrl(rpcUrl)}`)
  console.log(`  Output Dir  : ${resolve(outDir)}`)
  console.log(`  Max Programs: ${maxPrograms === 0 ? 'unlimited' : maxPrograms}`)
  console.log(`  Legacy v2   : ${includeLegacyV2 ? 'yes' : 'no'}`)
  console.log(`  Legacy v1   : ${includeLegacyV1 ? 'yes' : 'no'}`)
  console.log(`  Rate Limit  : ${requestsPerSecond} req/s`)
  console.log('═══════════════════════════════════════════════════')
  console.log()

  const rpc = new RpcClient({
    url: rpcUrl,
    maxRetries: 5,
    baseDelayMs: 1000,
    requestsPerSecond,
  })

  // Checkpoint
  const checkpointPath = resolve(outDir, '.checkpoint-scan.json')
  const checkpoint = new Checkpoint(checkpointPath, 'scan-programs')
  if (resume && checkpoint.tryResume()) {
    console.log('Resuming from previous checkpoint...')
  }

  const csvPath = resolve(outDir, 'programs.csv')

  console.log('Scanning cluster for executable programs...')
  const startTime = Date.now()

  const programs: DiscoveredProgram[] = await discoverPrograms(rpc, {
    includeLegacyV2,
    includeLegacyV1,
    maxPrograms,
    onProgress: (msg) => console.log(msg),
  })

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log()
  console.log(`Discovered ${programs.length} programs in ${elapsed}s`)

  // Filter out already-processed if resuming
  const processedSet = checkpoint.getProcessedSet()
  const toWrite = resume
    ? programs.filter((p) => !processedSet.has(p.programId))
    : programs

  // Write CSV
  const csv = new CsvWriter(csvPath, ['program_id', 'loader'])

  csv.writeRows(
    toWrite.map((p) => ({
      program_id: p.programId,
      loader: p.loader,
    }))
  )

  checkpoint.setTotalItems(programs.length)
  checkpoint.update(
    toWrite.map((p) => p.programId),
    0
  )

  console.log()
  console.log(`CSV written: ${csvPath}`)
  console.log(`  Total rows: ${csv.getRowCount()}`)

  // Save program list for check-idl command to pick up
  const programListPath = resolve(outDir, '.program-list.json')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(
    programListPath,
    JSON.stringify(programs.map((p) => p.programId)),
    'utf-8'
  )
  console.log(`  Program list saved: ${programListPath}`)

  checkpoint.clear()
  console.log()
  console.log('Scan complete.')
}

/** Mask RPC URL for display (hide API key portions) */
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
