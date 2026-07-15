/**
 * Command: verified-match
 * Trigger or check status of VerifiedMatchWorkflow (WF1) — matches OSEC
 * verified-programs list against DB projects, marks is_verified, and
 * triggers AI analysis for the matched set. Does not import missing programs.
 */

import { triggerVerifiedMatch, getVerifiedMatchStatus } from '../lib/api-client'

export interface VerifiedMatchOptions {
  action: 'trigger' | 'status'
  apiUrl: string
  ingestKey?: string
}

export async function verifiedMatch(opts: VerifiedMatchOptions): Promise<void> {
  console.log('═══════════════════════════════════════════════════')
  console.log('  Orquestra — Verified Match (WF1)')
  console.log('═══════════════════════════════════════════════════')

  if (opts.action === 'trigger') {
    if (!opts.ingestKey) {
      console.error(
        'Error: verified-match --trigger requires an ingest key.\n' +
        '  --ingest-key <key>  or  export ORQUESTRA_INGEST_KEY=your-key',
      )
      process.exit(1)
    }
    const result = await triggerVerifiedMatch({ baseUrl: opts.apiUrl, ingestKey: opts.ingestKey })
    if (!result.success) {
      console.error(`  Failed to trigger: ${result.error}`)
      process.exit(1)
    }
    console.log(`  Triggered   : ${result.message}`)
    console.log(`  Instance ID : ${result.instanceId}`)
    return
  }

  const status = await getVerifiedMatchStatus(opts.apiUrl)
  if ('error' in status) {
    console.error(`  Failed to fetch status: ${status.error}`)
    process.exit(1)
  }
  console.log(`  Total projects     : ${status.total_projects}`)
  console.log(`  Verified count     : ${status.verified_count}`)
  console.log(`  Last verified at   : ${status.last_verified_at ?? 'never'}`)
}
