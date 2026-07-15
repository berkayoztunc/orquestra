/**
 * Shared OtterSec (OSEC) verified-programs list client.
 * Used by VerifiedMatchWorkflow and VerifiedIdlImportWorkflow.
 */

export const OSEC_URL = 'https://verify.osec.io/verified-programs'

export interface OsecFetchOptions {
  baseUrl?: string
}

export interface OsecFetchResult {
  programIds: string[]
  total: number
}

export async function fetchOsecVerifiedProgramIds(opts: OsecFetchOptions = {}): Promise<OsecFetchResult> {
  const baseUrl = opts.baseUrl ?? OSEC_URL

  const fetchPage = async (page: number) => {
    const res = await fetch(`${baseUrl}?page=${page}`, { headers: { Accept: 'application/json' } })
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
    if (ids.length === 0) break
    all.push(...ids)
  }

  return { programIds: all, total: all.length }
}
