/**
 * Command: queue-programs
 * Reads a list of Solana program IDs (from programs.csv or a JSON file)
 * and sends them to the Orquestra Worker discovery queue via
 * POST /api/ingest/candidates. The cron will then verify each program for
 * an on-chain IDL and auto-import those that have one.
 *
 * This is much faster than `check-idl --enable-ingest` because it does NOT
 * fetch or decode IDLs locally — it just queues the program IDs and lets
 * the Worker cron do the verification.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { queueCandidates, loadAPIClientOptions } from '../lib/api-client'

export interface QueueProgramsOptions {
  outDir: string
  inputFile: string
  batchSize: number
}

/** Parse programs.csv rows, return unique program IDs (skip header). */
function parseProgramsCsv(content: string): string[] {
  const lines = content.trim().split('\n')
  const ids: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('program_id')) continue // skip header
    const id = trimmed.split(',')[0]?.trim()
    if (id && id.length >= 32 && id.length <= 44) ids.push(id)
  }
  return [...new Set(ids)] // deduplicate
}

/** Parse a JSON array of program IDs. */
function parseProgramsJson(content: string): string[] {
  const parsed = JSON.parse(content)
  if (!Array.isArray(parsed)) throw new Error('Expected JSON array of program IDs')
  return parsed.filter((id): id is string => typeof id === 'string' && id.length >= 32)
}

export async function queuePrograms(opts: QueueProgramsOptions): Promise<void> {
  const apiOpts = loadAPIClientOptions()
  if (!apiOpts) {
    console.error(
      'Error: queue command requires ORQUESTRA_API_URL and ORQUESTRA_INGEST_KEY env vars.\n' +
      '  export ORQUESTRA_API_URL=https://api.orquestra.dev\n' +
      '  export ORQUESTRA_INGEST_KEY=your-key',
    )
    process.exit(1)
  }

  // Resolve input file: use --input-file if provided, else default to programs.csv
  let inputPath: string
  if (opts.inputFile) {
    inputPath = resolve(opts.inputFile)
  } else {
    inputPath = resolve(opts.outDir, 'programs.csv')
  }

  if (!existsSync(inputPath)) {
    console.error(`Error: Program list not found at ${inputPath}`)
    console.error('Run "bun run cli:scan" first to generate programs.csv.')
    process.exit(1)
  }

  console.log('═══════════════════════════════════════════════════')
  console.log('  Orquestra — Queue Programs for IDL Discovery')
  console.log('═══════════════════════════════════════════════════')
  console.log(`  Input       : ${inputPath}`)
  console.log(`  Worker URL  : ${apiOpts.baseUrl}`)
  console.log(`  Batch size  : ${opts.batchSize}`)
  console.log('═══════════════════════════════════════════════════')
  console.log()

  // Load and parse program IDs
  const content = readFileSync(inputPath, 'utf-8')
  let programIds: string[]

  try {
    if (inputPath.endsWith('.json')) {
      programIds = parseProgramsJson(content)
    } else {
      programIds = parseProgramsCsv(content)
    }
  } catch (err: any) {
    console.error(`Error parsing input file: ${err.message}`)
    process.exit(1)
  }

  if (programIds.length === 0) {
    console.error('Error: No valid program IDs found in input file.')
    process.exit(1)
  }

  console.log(`Loaded ${programIds.length} program IDs`)
  console.log()

  // Send in batches
  const batchSize = opts.batchSize
  let totalQueued = 0
  let totalSkipped = 0
  let batches = 0

  const startTime = Date.now()

  for (let i = 0; i < programIds.length; i += batchSize) {
    const batch = programIds.slice(i, i + batchSize)
    batches++

    try {
      const result = await queueCandidates(batch, apiOpts)
      totalQueued += result.queued
      totalSkipped += result.skipped

      const progress = Math.round(((i + batch.length) / programIds.length) * 100)
      process.stdout.write(
        `\r  Progress: ${i + batch.length}/${programIds.length} (${progress}%) — queued: ${totalQueued}`,
      )
    } catch (err: any) {
      console.error(`\n  Batch ${batches} failed: ${err.message}`)
      // Continue with next batch
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log()
  console.log()
  console.log('═══════════════════════════════════════════════════')
  console.log(`  Done in ${elapsed}s`)
  console.log(`  Submitted  : ${programIds.length}`)
  console.log(`  Queued     : ${totalQueued}`)
  console.log(`  Skipped    : ${totalSkipped}  (invalid IDs)`)
  console.log()
  console.log('  The Worker cron (every 6h) will now check each')
  console.log('  queued program for an on-chain IDL and auto-import')
  console.log('  programs that have one.')
  console.log('═══════════════════════════════════════════════════')
}
