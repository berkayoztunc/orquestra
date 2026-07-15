/**
 * Command: verified-analysis
 * Trigger or check status of the existing VerifiedAnalysisWorkflow — generates
 * AI docs + analysis + category for every verified+IDL program missing an
 * ai_analyses row (or all, with --force, for a full refresh).
 */

import { triggerVerifiedAnalysis, getVerifiedAnalysisQueue } from '../lib/api-client'

export interface VerifiedAnalysisOptions {
  action: 'trigger' | 'status'
  apiUrl: string
  ingestKey?: string
  force?: boolean
}

export async function verifiedAnalysis(opts: VerifiedAnalysisOptions): Promise<void> {
  console.log('═══════════════════════════════════════════════════')
  console.log('  Orquestra — Verified AI Analysis')
  console.log('═══════════════════════════════════════════════════')

  if (opts.action === 'trigger') {
    if (!opts.ingestKey) {
      console.error(
        'Error: verified-analysis --trigger requires an ingest key.\n' +
        '  --ingest-key <key>  or  export ORQUESTRA_INGEST_KEY=your-key',
      )
      process.exit(1)
    }
    const result = await triggerVerifiedAnalysis({ baseUrl: opts.apiUrl, ingestKey: opts.ingestKey }, !!opts.force)
    if (!result.success) {
      console.error(`  Failed to trigger: ${result.error}`)
      process.exit(1)
    }
    console.log(`  Triggered   : ${result.message}`)
    console.log(`  Instance ID : ${result.instanceId}`)
    return
  }

  const status = await getVerifiedAnalysisQueue(opts.apiUrl)
  if ('error' in status) {
    console.error(`  Failed to fetch status: ${status.error}`)
    process.exit(1)
  }
  console.log(`  Verified programs pending AI analysis : ${status.pending}`)
}
