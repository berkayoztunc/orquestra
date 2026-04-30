/**
 * Command: analysis
 * Reads output CSVs and prints a quick summary:
 *   - Total programs discovered
 *   - Breakdown by loader type
 *   - How many have a published on-chain Anchor IDL
 */

import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

export interface AnalysisOptions {
  outDir: string
}

function parseCsv(content: string): Record<string, string>[] {
  const lines = content.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((h) => h.trim())
  return lines.slice(1).map((line) => {
    const values = line.split(',')
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = (values[i] ?? '').trim()
    })
    return row
  })
}

export async function analysis(opts: AnalysisOptions): Promise<void> {
  const programsCsv = resolve(opts.outDir, 'programs.csv')
  const idlCsv = resolve(opts.outDir, 'program_idl_status.csv')

  const hasProgramsCsv = existsSync(programsCsv)
  const hasIdlCsv = existsSync(idlCsv)

  if (!hasProgramsCsv && !hasIdlCsv) {
    console.error(`No output files found in ${opts.outDir}.`)
    console.error('Run "scan" and/or "check-idl" first to generate data.')
    process.exit(1)
  }

  console.log('\n─────────────────────────────────────────────')
  console.log('  Orquestra — Solana Program Analysis')
  console.log('─────────────────────────────────────────────\n')

  // ── Programs ──────────────────────────────────────────────────────
  if (hasProgramsCsv) {
    const programs = parseCsv(readFileSync(programsCsv, 'utf8'))
    const total = programs.length

    const byLoader: Record<string, number> = {}
    for (const row of programs) {
      const loader = row.loader || 'unknown'
      byLoader[loader] = (byLoader[loader] ?? 0) + 1
    }

    console.log(`Programs discovered:   ${total.toLocaleString()}`)
    for (const [loader, count] of Object.entries(byLoader).sort((a, b) => b[1] - a[1])) {
      const pct = ((count / total) * 100).toFixed(1)
      console.log(`  ${loader.padEnd(20)} ${count.toLocaleString()} (${pct}%)`)
    }
    console.log()
  } else {
    console.log('programs.csv not found — skipping program count.\n')
  }

  // ── IDL Status ────────────────────────────────────────────────────
  if (hasIdlCsv) {
    const rows = parseCsv(readFileSync(idlCsv, 'utf8'))
    const total = rows.length
    const published = rows.filter((r) => r.has_onchain_idl === 'true').length
    const noIdl = rows.filter((r) => r.has_onchain_idl === 'false' && !r.error).length
    const errors = rows.filter((r) => !!r.error).length
    const pct = total > 0 ? ((published / total) * 100).toFixed(2) : '0.00'

    console.log(`IDL check coverage:    ${total.toLocaleString()} programs checked`)
    console.log(`  Published IDL        ${published.toLocaleString()} (${pct}%)`)
    console.log(`  No IDL               ${noIdl.toLocaleString()}`)
    if (errors > 0) console.log(`  Errors               ${errors.toLocaleString()}`)
    console.log()
  } else {
    console.log('program_idl_status.csv not found — skipping IDL stats.\n')
  }

  console.log('─────────────────────────────────────────────\n')
}
