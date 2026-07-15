/**
 * Command: verified-idl-import
 * Trigger or check status of VerifiedIdlImportWorkflow (WF2) — fetches
 * on-chain IDL (RPC-throttled) for OSEC-verified programs that are missing
 * from the DB or missing an idl_versions row.
 */

import { triggerVerifiedIdlImport, getVerifiedIdlImportStatus } from '../lib/api-client'

export interface VerifiedIdlImportOptions {
  action: 'trigger' | 'status'
  apiUrl: string
  ingestKey?: string
}

export async function verifiedIdlImport(opts: VerifiedIdlImportOptions): Promise<void> {
  console.log('═══════════════════════════════════════════════════')
  console.log('  Orquestra — Verified IDL Import (WF2)')
  console.log('═══════════════════════════════════════════════════')

  if (opts.action === 'trigger') {
    if (!opts.ingestKey) {
      console.error(
        'Error: verified-idl-import --trigger requires an ingest key.\n' +
        '  --ingest-key <key>  or  export ORQUESTRA_INGEST_KEY=your-key',
      )
      process.exit(1)
    }
    const result = await triggerVerifiedIdlImport({ baseUrl: opts.apiUrl, ingestKey: opts.ingestKey })
    if (!result.success) {
      console.error(`  Failed to trigger: ${result.error}`)
      process.exit(1)
    }
    console.log(`  Triggered   : ${result.message}`)
    console.log(`  Instance ID : ${result.instanceId}`)
    return
  }

  const status = await getVerifiedIdlImportStatus(opts.apiUrl)
  if ('error' in status) {
    console.error(`  Failed to fetch status: ${status.error}`)
    process.exit(1)
  }
  console.log(`  Verified programs missing IDL : ${status.verified_missing_idl}`)
}
