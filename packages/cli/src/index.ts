#!/usr/bin/env bun
/**
 * orquestra-scan CLI
 *
 * Usage:
 *   bun run packages/cli/src/index.ts scan [options]        — Discover all programs on cluster
 *   bun run packages/cli/src/index.ts check-idl [options]   — Check Anchor IDL for each program
 *   bun run packages/cli/src/index.ts full [options]         — Run scan + check-idl sequentially
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
 *   --help                   Show this help
 */

import { scanPrograms, type ScanProgramsOptions } from './commands/scan-programs'
import { checkIdl, type CheckIdlOptions } from './commands/check-idl'

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
  full        Run scan + check-idl sequentially

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
  --help                   Show this help

EXAMPLES:
  # Scan all programs on mainnet
  bun run packages/cli/src/index.ts scan --rpc-url https://api.mainnet-beta.solana.com

  # Scan with custom RPC and limit
  bun run packages/cli/src/index.ts scan --rpc-url $SOLANA_RPC_URL --max-programs 100

  # Check IDL for previously scanned programs
  bun run packages/cli/src/index.ts check-idl --rpc-url $SOLANA_RPC_URL

  # Full pipeline
  bun run packages/cli/src/index.ts full --rpc-url $SOLANA_RPC_URL --out-dir ./results

  # Resume interrupted IDL check
  bun run packages/cli/src/index.ts check-idl --rpc-url $SOLANA_RPC_URL --resume
`)
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2)
  const { command, flags } = parseArgs(args)

  if (flags.help || !command) {
    printHelp()
    process.exit(0)
  }

  // Resolve RPC URL
  const rpcUrl = (flags['rpc-url'] as string) || process.env.SOLANA_RPC_URL
  if (!rpcUrl) {
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

  const scanOpts: ScanProgramsOptions = {
    rpcUrl,
    outDir,
    maxPrograms,
    includeLegacyV2,
    includeLegacyV1,
    resume,
    requestsPerSecond,
  }

  const idlOpts: CheckIdlOptions = {
    rpcUrl,
    outDir,
    inputFile,
    batchSize,
    concurrency,
    resume,
    requestsPerSecond,
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
