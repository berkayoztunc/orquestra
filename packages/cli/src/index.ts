#!/usr/bin/env bun
/**
 * orquestra-scan CLI
 *
 * Usage:
 *   bun run packages/cli/src/index.ts scan [options]        — Discover all programs on cluster
 *   bun run packages/cli/src/index.ts check-idl [options]   — Check Anchor IDL for each program
 *   bun run packages/cli/src/index.ts queue [options]        — Queue program IDs for cron auto-import
 *   bun run packages/cli/src/index.ts full [options]         — Run scan + check-idl sequentially
 *   bun run packages/cli/src/index.ts funnel [options]       — Run scan + verified-build gated ingest
 *
 * Options:
 *   --rpc-url <url>          Solana RPC endpoint (required, or set SOLANA_RPC_URL env)
 *   --out-dir <dir>          Output directory (default: ./output)
 *   --max-programs <n>       Limit number of programs (0 = unlimited, default: 0)
 *   --batch-size <n>         IDL check batch size (default: 50)
 *   --concurrency <n>        Concurrent RPC calls per batch (default: 10)
 *   --include-legacy-v1      Include BPF Loader v1 programs (default: false)
 *   --no-legacy-v2           Exclude BPF Loader v2 programs (default: included)
 *   --resume                 Resume from checkpoint if available
 *   --input-file <path>      Custom program list JSON for check-idl
 *   --rps <n>                Max requests per second (default: 10)
 *   --enable-ingest          Enable AI description + DB ingest for each discovered IDL
 *   --skip-ai                Skip AI description step (ingest IDL only, no AI call)
 *   --ingest-concurrency <n> Max concurrent AI+ingest calls (default: 5)
 *   --verified-build-api-url <url>  Verified build endpoint template (must include {programId})
 *   --verified-build-list-api-url <url>  Verified programs list endpoint template (must include {page})
 *   --verified-build-source <name>  Source label for reports (default: official)
 *   --verified-build-concurrency <n>  Max concurrent verification requests (default: 10)
 *   --verified-build-rps <n>  Max verification requests/second (default: 3)
 *   --help                   Show this help
 */

import { scanPrograms, type ScanProgramsOptions } from './commands/scan-programs'
import { checkIdl, type CheckIdlOptions } from './commands/check-idl'
import { analysis, type AnalysisOptions } from './commands/analysis'
import { queuePrograms, type QueueProgramsOptions } from './commands/queue-programs'
import { checkVerifiedBuildBatch } from './lib/verified-build'
import { CsvWriter } from './lib/csv'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ─── Argument Parsing ────────────────────────────────────────────────
function parseArgs(argv: string[]): { command: string; flags: Record<string, string | boolean> } {
  const flags: Record<string, string | boolean> = {}
  let command = ''

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (!arg.startsWith('-') && !command) {
      command = arg
      continue
    }

    if (arg === '--help' || arg === '-h') {
      flags.help = true
      continue
    }

    if (arg === '--resume') {
      flags.resume = true
      continue
    }

    if (arg === '--include-legacy-v1') {
      flags['include-legacy-v1'] = true
      continue
    }

    if (arg === '--no-legacy-v2') {
      flags['no-legacy-v2'] = true
      continue
    }

    if (arg === '--enable-ingest') {
      flags['enable-ingest'] = true
      continue
    }

    if (arg === '--skip-ai') {
      flags['skip-ai'] = true
      continue
    }

    if (arg === '--fast') {
      flags['fast'] = true
      continue
    }

    if (arg.startsWith('--') && i + 1 < argv.length) {
      const key = arg.slice(2)
      flags[key] = argv[++i]
      continue
    }
  }

  return { command, flags }
}

function printHelp(): void {
  console.log(`
orquestra-scan — Solana Program Scanner & IDL Checker

USAGE:
  bun run packages/cli/src/index.ts <command> [options]

COMMANDS:
  scan        Discover all executable programs on the cluster → programs.csv
  check-idl   Check on-chain Anchor IDL for each program → program_idl_status.csv
  queue       Queue all program IDs from programs.csv for cron auto-import (fast!)
  full        Run scan + check-idl sequentially
  funnel      Run scan + verified-build gated check-idl + AI ingest
  analysis    Print summary stats from existing output CSVs (no RPC needed)

OPTIONS:
  --rpc-url <url>          Solana RPC endpoint (required, or SOLANA_RPC_URL env)
  --out-dir <dir>          Output directory (default: ./output)
  --max-programs <n>       Limit number of programs, 0 = unlimited (default: 0)
  --batch-size <n>         IDL check batch size (default: 50)
  --concurrency <n>        Concurrent RPC calls per batch (default: 10)
  --include-legacy-v1      Include BPF Loader v1 programs
  --no-legacy-v2           Exclude BPF Loader v2 programs
  --resume                 Resume from checkpoint if available
  --input-file <path>      Custom program list JSON for check-idl
  --rps <n>                Max requests per second (default: 10)
  --enable-ingest          Generate AI description & save to Orquestra DB for each IDL found
  --skip-ai                Skip AI step (ingest IDL without AI description)
  --fast                   Fast IDL scan: only check new-style PDA, skip decode (no IDL data saved)
  --ingest-concurrency <n> Max concurrent AI+ingest calls (default: 5)
  --verified-build-api-url <url>
                          Verified build endpoint template (must include {programId})
  --verified-build-list-api-url <url>
                          Verified programs list endpoint template (must include {page})
  --verified-build-source <name>
                          Source label for reports (default: official)
  --verified-build-concurrency <n>
                          Max concurrent verified-build requests (default: 10)
  --verified-build-rps <n>
                          Max verification requests/second (default: 3)
  --help                   Show this help

AI INGEST ENV VARS (required when --enable-ingest):
  ORQUESTRA_API_URL        Worker base URL (e.g. https://api.orquestra.dev)
  ORQUESTRA_INGEST_KEY     Secret ingest key matching INGEST_API_KEY on the Worker
  CF_ACCOUNT_ID            Cloudflare account ID (for AI descriptions)
  CF_API_TOKEN             Cloudflare API token with Workers AI:Run permission
  CF_AI_MODEL              AI model (default: @cf/meta/llama-3.1-8b-instruct)
  SOLANA_VERIFIED_BUILD_API_URL
                          Verified build endpoint template (must include {programId})
  SOLANA_VERIFIED_BUILD_LIST_API_URL
                          Verified programs list endpoint template (must include {page})
  SOLANA_VERIFIED_BUILD_API_TOKEN
                          Optional bearer token for verified build endpoint

EXAMPLES:
  # Scan all programs on mainnet
  bun run packages/cli/src/index.ts scan --rpc-url https://api.mainnet-beta.solana.com

  # Scan with custom RPC and limit
  bun run packages/cli/src/index.ts scan --rpc-url $SOLANA_RPC_URL --max-programs 100

  # Check IDL for previously scanned programs
  bun run packages/cli/src/index.ts check-idl --rpc-url $SOLANA_RPC_URL

  # Check IDL + generate AI descriptions + ingest to DB
  bun run packages/cli/src/index.ts check-idl --rpc-url $SOLANA_RPC_URL --enable-ingest

  # Full pipeline with ingest
  bun run packages/cli/src/index.ts full --rpc-url $SOLANA_RPC_URL --out-dir ./results --enable-ingest

  # Funnel pipeline: scan all programs, verify build, check IDL, ingest + AI
  bun run packages/cli/src/index.ts funnel --rpc-url $SOLANA_RPC_URL --out-dir ./results

  # Resume interrupted IDL check
  bun run packages/cli/src/index.ts check-idl --rpc-url $SOLANA_RPC_URL --resume
`)
}

function parseProgramsCsv(content: string): string[] {
  const lines = content.trim().split('\n')
  const out: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('program_id')) continue
    const id = trimmed.split(',')[0]?.trim()
    if (id) out.push(id)
  }
  return out
}

async function runVerifiedStage(options: {
  outDir: string
  verifiedBuildApiUrl: string
  verifiedBuildListApiUrl: string
  verifiedBuildApiToken: string
  verifiedBuildSource: string
  verifiedBuildConcurrency: number
  verifiedBuildRps: number
}): Promise<string> {
  const programsCsvPath = resolve(options.outDir, 'programs.csv')
  if (!existsSync(programsCsvPath)) {
    throw new Error(`programs.csv not found at ${programsCsvPath}`)
  }

  const csvRaw = readFileSync(programsCsvPath, 'utf-8')
  const ids = parseProgramsCsv(csvRaw)
  const validProgramIds = [...new Set(ids.filter((id) => id.length >= 32 && id.length <= 44))]

  if (validProgramIds.length === 0) {
    throw new Error('No valid program IDs found in programs.csv')
  }

  console.log()
  console.log('Step 1/3: programs.csv validation')
  console.log(`  programs.csv rows: ${ids.length}`)
  console.log(`  valid program ids: ${validProgramIds.length}`)

  console.log()
  console.log('Step 2/3: checking verified build status for all valid programs')

  const checks = await checkVerifiedBuildBatch(validProgramIds, {
    endpointTemplate: options.verifiedBuildApiUrl,
    verifiedProgramsListEndpoint: options.verifiedBuildListApiUrl || undefined,
    apiToken: options.verifiedBuildApiToken || undefined,
    sourceName: options.verifiedBuildSource,
    concurrency: options.verifiedBuildConcurrency,
    requestsPerSecond: options.verifiedBuildRps,
    maxRetries: 3,
  })

  const verifiedCsvPath = resolve(options.outDir, 'programs_verified.csv')
  const verifiedCsv = new CsvWriter(verifiedCsvPath, [
    'program_id',
    'verified_build',
    'verification_source',
    'verification_error',
  ])

  const verifiedProgramIds: string[] = []
  let verificationErrors = 0
  for (const pid of validProgramIds) {
    const status = checks.get(pid)
    const verified = status?.isVerifiedBuild === true
    if (status?.error) verificationErrors++
    if (verified) verifiedProgramIds.push(pid)
    verifiedCsv.writeRow({
      program_id: pid,
      verified_build: verified ? 'true' : 'false',
      verification_source: status?.source ?? options.verifiedBuildSource,
      verification_error: status?.error ?? '',
    })
  }

  console.log(`  verified programs: ${verifiedProgramIds.length}`)
  console.log(`  verification errors: ${verificationErrors}`)
  console.log(`  verified csv: ${verifiedCsvPath}`)

  if (verificationErrors > 0) {
    throw new Error(
      `Verification returned ${verificationErrors} errors; rerun with lower --verified-build-rps to avoid false negatives.`,
    )
  }

  const verifiedListPath = resolve(options.outDir, '.program-list.verified.json')
  writeFileSync(verifiedListPath, JSON.stringify(verifiedProgramIds), 'utf-8')
  return verifiedListPath
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2)
  const { command, flags } = parseArgs(args)

  if (flags.help || !command) {
    printHelp()
    process.exit(0)
  }

  // Resolve RPC URL (required only for scan/check-idl/full/funnel)
  const rpcUrl = (flags['rpc-url'] as string) || process.env.SOLANA_RPC_URL
  const rpcRequiredCommands = new Set(['scan', 'check-idl', 'full', 'funnel'])
  if (!rpcUrl && rpcRequiredCommands.has(command)) {
    console.error('Error: --rpc-url is required or set SOLANA_RPC_URL environment variable')
    process.exit(1)
  }

  const outDir = (flags['out-dir'] as string) || './output'
  const maxPrograms = parseInt((flags['max-programs'] as string) || '0', 10)
  const batchSize = parseInt((flags['batch-size'] as string) || '50', 10)
  const concurrency = parseInt((flags.concurrency as string) || '10', 10)
  const resume = !!flags.resume
  const includeLegacyV1 = !!flags['include-legacy-v1']
  const includeLegacyV2 = !flags['no-legacy-v2']
  const inputFile = (flags['input-file'] as string) || ''
  const requestsPerSecond = parseInt((flags.rps as string) || '10', 10)
  const enableIngest = !!flags['enable-ingest']
  const skipAi = !!flags['skip-ai']
  const ingestConcurrency = parseInt((flags['ingest-concurrency'] as string) || '5', 10)
  const fast = !!flags['fast']
  const verifiedBuildApiUrl =
    (flags['verified-build-api-url'] as string) ||
    process.env.SOLANA_VERIFIED_BUILD_API_URL ||
    'https://verify.osec.io/status/{programId}'
  const verifiedBuildListApiUrl =
    (flags['verified-build-list-api-url'] as string) ||
    process.env.SOLANA_VERIFIED_BUILD_LIST_API_URL ||
    'https://verify.osec.io/verified-programs/{page}'
  const verifiedBuildSource = (flags['verified-build-source'] as string) || 'osec-verify'
  const verifiedBuildApiToken = process.env.SOLANA_VERIFIED_BUILD_API_TOKEN || ''
  const verifiedBuildConcurrency = parseInt((flags['verified-build-concurrency'] as string) || '10', 10)
  const verifiedBuildRps = Number((flags['verified-build-rps'] as string) || '3')

  const scanOpts: ScanProgramsOptions = {
    rpcUrl: rpcUrl!,
    outDir,
    maxPrograms,
    includeLegacyV2,
    includeLegacyV1,
    resume,
    requestsPerSecond,
  }

  const idlOpts: CheckIdlOptions = {
    rpcUrl: rpcUrl!,
    outDir,
    inputFile,
    batchSize,
    concurrency,
    resume,
    requestsPerSecond,
    enableIngest,
    skipAi,
    ingestConcurrency,
    fast,
    verifiedBuildApiUrl,
    verifiedBuildSource,
    verifiedBuildApiToken,
    verifiedBuildConcurrency,
  }

  switch (command) {
    case 'scan':
      await scanPrograms(scanOpts)
      break

    case 'check-idl':
      await checkIdl(idlOpts)
      break

    case 'full':
      await scanPrograms(scanOpts)
      console.log()
      console.log('─'.repeat(55))
      console.log()
      await checkIdl(idlOpts)
      break

    case 'funnel': {
      await scanPrograms(scanOpts)
      console.log()
      console.log('─'.repeat(55))
      console.log()
      const verifiedListPath = await runVerifiedStage({
        outDir,
        verifiedBuildApiUrl,
        verifiedBuildListApiUrl,
        verifiedBuildApiToken,
        verifiedBuildSource,
        verifiedBuildConcurrency,
        verifiedBuildRps,
      })

      console.log()
      console.log('Step 3/3: checking IDL + ingesting verified program list')
      console.log(`  input list: ${verifiedListPath}`)

      await checkIdl({
        ...idlOpts,
        inputFile: verifiedListPath,
        enableIngest: true,
        skipAi: false,
        skipVerifiedBuildCheck: true,
      })
      break
    }

    case 'analysis': {
      const analysisOpts: AnalysisOptions = { outDir }
      await analysis(analysisOpts)
      break
    }

    case 'queue': {
      const queueOpts: QueueProgramsOptions = {
        outDir,
        inputFile,
        batchSize: parseInt((flags['batch-size'] as string) || '500', 10),
      }
      await queuePrograms(queueOpts)
      break
    }

    default:
      console.error(`Unknown command: ${command}`)
      console.error('Run with --help for usage info.')
      process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message || err)
  process.exit(1)
})
