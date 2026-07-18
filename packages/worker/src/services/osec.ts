/**
 * Shared OtterSec (OSEC) verified-programs list client.
 * Used by VerifiedMatchWorkflow and VerifiedIdlImportWorkflow.
 */

import { fetchWithTimeout } from '../utils/solana-rpc'

export const OSEC_URL = 'https://verify.osec.io/verified-programs'

export interface OsecFetchOptions {
  baseUrl?: string
}

export interface OsecFetchResult {
  programIds: string[]
  total: number
  /** True only when every advertised page was fetched and non-empty. */
  complete: boolean
}

export async function fetchOsecVerifiedProgramIds(opts: OsecFetchOptions = {}): Promise<OsecFetchResult> {
  const baseUrl = opts.baseUrl ?? OSEC_URL

  const fetchPage = async (page: number) => {
    const res = await fetchWithTimeout(`${baseUrl}/${page}`, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`OSEC API ${res.status} on page ${page}`)
    const json = await res.json() as any
    const ids: string[] = (json.verified_programs ?? [])
      .map((p: any) => typeof p === 'string' ? p : (p?.program_id ?? ''))
      .filter((id: string) => id.length > 0)
    return { ids, totalPages: json.meta?.total_pages ?? 1 }
  }

  const first = await fetchPage(1)
  const all: string[] = [...first.ids]
  for (let page = 2; page <= first.totalPages; page++) {
    const { ids } = await fetchPage(page)
    if (ids.length === 0) {
      // A truncated list must never be treated as the full verified set —
      // consumers clear is_verified flags based on it.
      throw new Error(`OSEC pagination truncated: empty page ${page} of ${first.totalPages}`)
    }
    all.push(...ids)
  }

  return { programIds: all, total: all.length, complete: true }
}
