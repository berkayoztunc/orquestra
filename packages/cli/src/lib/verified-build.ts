/**
 * Verified Build checker
 *
 * Resolves program verification status from an external source endpoint.
 * Endpoint URL must contain a "{programId}" placeholder.
 */

const DEFAULT_ENDPOINT_TEMPLATE = 'https://verify.osec.io/status/{programId}'

export interface VerifiedBuildCheckOptions {
  /** Endpoint template like: https://example.com/verify/{programId} */
  endpointTemplate: string
  /** Optional paginated endpoint template like: https://.../verified-programs/{page} */
  verifiedProgramsListEndpoint?: string
  /** Optional bearer token for authenticated verification source */
  apiToken?: string
  /** Maximum parallel verification requests */
  concurrency?: number
  /** Max outgoing requests/second across all workers */
  requestsPerSecond?: number
  /** Request timeout per verification lookup */
  timeoutMs?: number
  /** Max retries for 429/5xx responses */
  maxRetries?: number
  /** Free-form source label written to CSV */
  sourceName?: string
}

export interface VerifiedBuildStatus {
  programId: string
  isVerifiedBuild: boolean
  source: string
  error: string | null
}

export interface OsecVerifiedBuildResponse {
  is_verified?: boolean
  message?: string
  on_chain_hash?: string
  executable_hash?: string
  repo_url?: string
  commit?: string | null
  last_verified_at?: string
  is_frozen?: boolean
  is_closed?: boolean
}

interface JsonObject {
  [key: string]: unknown
}

const VERIFIED_KEYS = ['verifiedBuild', 'verified_build', 'isVerifiedBuild', 'verified', 'is_verified']

function parseVerifiedFlag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
    if (normalized === 'verified') return true
    if (normalized === 'unverified') return false
  }
  return null
}

function extractVerifiedFlag(payload: unknown): boolean | null {
  if (typeof payload === 'boolean') return payload
  if (!payload || typeof payload !== 'object') return null

  const obj = payload as JsonObject
  for (const key of VERIFIED_KEYS) {
    const parsed = parseVerifiedFlag(obj[key])
    if (parsed !== null) return parsed
  }

  const status = obj.status
  if (typeof status === 'string') {
    const normalized = status.trim().toLowerCase()
    if (normalized.includes('verified')) return true
    if (normalized.includes('unverified')) return false
  }

  const message = obj.message
  if (typeof message === 'string') {
    const normalized = message.trim().toLowerCase()
    if (normalized.includes('verified')) return true
    if (normalized.includes('unverified')) return false
  }

  return null
}

function buildUrl(template: string, programId: string): string {
  return template.replace('{programId}', encodeURIComponent(programId))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseRetryAfterMs(value: string | null): number {
  if (!value) return 1000
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric >= 0) return numeric * 1000
  const dateMs = Date.parse(value)
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now())
  }
  return 1000
}

function extractProgramIdFromItem(item: unknown): string | null {
  if (typeof item === 'string') {
    const s = item.trim()
    return s ? s : null
  }
  if (!item || typeof item !== 'object') return null

  const obj = item as JsonObject
  const keys = ['program_id', 'programId', 'address', 'pubkey', 'id']
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function extractProgramIdsFromPayload(payload: unknown): string[] {
  if (!payload) return []

  if (Array.isArray(payload)) {
    return payload
      .map((item) => extractProgramIdFromItem(item))
      .filter((value): value is string => Boolean(value))
  }

  if (typeof payload !== 'object') return []

  const obj = payload as JsonObject
  const containers = ['data', 'results', 'items', 'programs', 'verified_programs']
  for (const key of containers) {
    if (obj[key] !== undefined) {
      const nested = extractProgramIdsFromPayload(obj[key])
      if (nested.length > 0) return nested
    }
  }

  const single = extractProgramIdFromItem(obj)
  return single ? [single] : []
}

async function fetchVerifiedProgramsSet(options: {
  endpointTemplate: string
  apiToken?: string
  timeoutMs: number
  maxRetries: number
  requestsPerSecond: number
}): Promise<Set<string>> {
  if (!options.endpointTemplate.includes('{page}')) {
    throw new Error('Verified programs list endpoint must include "{page}" placeholder')
  }

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.apiToken) headers.Authorization = `Bearer ${options.apiToken}`

  const minIntervalMs = Math.ceil(1000 / Math.max(0.1, options.requestsPerSecond))
  let nextRequestAt = 0
  const out = new Set<string>()

  async function waitForRateLimit(): Promise<void> {
    const now = Date.now()
    const waitMs = Math.max(0, nextRequestAt - now)
    nextRequestAt = Math.max(nextRequestAt, now) + minIntervalMs
    if (waitMs > 0) await sleep(waitMs)
  }

  for (let page = 1; page <= 2000; page++) {
    const url = options.endpointTemplate.replace('{page}', String(page))
    let attempt = 0
    let pageIds: string[] = []

    while (attempt <= options.maxRetries) {
      await waitForRateLimit()
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs)
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        })

        if (res.status === 429 || res.status >= 500) {
          if (attempt < options.maxRetries) {
            const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'))
            await sleep(retryAfterMs)
            attempt++
            continue
          }
          throw new Error(`verified program list returned ${res.status} for page ${page}`)
        }

        if (!res.ok) {
          throw new Error(`verified program list returned ${res.status} for page ${page}`)
        }

        const json = (await res.json()) as unknown
        pageIds = extractProgramIdsFromPayload(json)
        break
      } catch (err: any) {
        if (attempt < options.maxRetries) {
          await sleep(1000 * (attempt + 1))
          attempt++
          continue
        }
        throw new Error(`failed loading verified programs page ${page}: ${String(err?.message || err)}`)
      } finally {
        clearTimeout(timeoutId)
      }
    }

    if (pageIds.length === 0) break
    for (const id of pageIds) out.add(id)
  }

  return out
}

async function checkOneProgram(
  programId: string,
  opts: Required<
    Pick<VerifiedBuildCheckOptions, 'endpointTemplate' | 'timeoutMs' | 'sourceName' | 'maxRetries'>
  > &
    Pick<VerifiedBuildCheckOptions, 'apiToken'>,
): Promise<VerifiedBuildStatus> {
  const url = buildUrl(opts.endpointTemplate, programId)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.apiToken) headers.Authorization = `Bearer ${opts.apiToken}`

  let attempt = 0
  while (attempt <= opts.maxRetries) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs)
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      })

      if (res.status === 429 || res.status >= 500) {
        if (attempt < opts.maxRetries) {
          const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'))
          await sleep(retryAfterMs)
          attempt++
          continue
        }
        return {
          programId,
          isVerifiedBuild: false,
          source: opts.sourceName,
          error: `verification source returned ${res.status}`,
        }
      }

      if (!res.ok) {
        return {
          programId,
          isVerifiedBuild: false,
          source: opts.sourceName,
          error: `verification source returned ${res.status}`,
        }
      }

      const json = (await res.json()) as OsecVerifiedBuildResponse | unknown
      const verified = extractVerifiedFlag(json)
      if (verified === null) {
        return {
          programId,
          isVerifiedBuild: false,
          source: opts.sourceName,
          error: 'verification response missing verified flag',
        }
      }

      return {
        programId,
        isVerifiedBuild: verified,
        source: opts.sourceName,
        error: null,
      }
    } catch (err: any) {
      if (attempt < opts.maxRetries) {
        await sleep(1000 * (attempt + 1))
        attempt++
        continue
      }
      return {
        programId,
        isVerifiedBuild: false,
        source: opts.sourceName,
        error: err?.name === 'AbortError' ? 'verification request timed out' : String(err?.message || err),
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  return {
    programId,
    isVerifiedBuild: false,
    source: opts.sourceName,
    error: 'verification retry budget exhausted',
  }
}

export async function checkVerifiedBuildBatch(
  programIds: string[],
  options: VerifiedBuildCheckOptions,
): Promise<Map<string, VerifiedBuildStatus>> {
  const endpointTemplate = options.endpointTemplate.trim() || DEFAULT_ENDPOINT_TEMPLATE
  if (!endpointTemplate.includes('{programId}')) {
    throw new Error('Verified build endpoint must include "{programId}" placeholder')
  }

  const timeoutMs = options.timeoutMs ?? 6000
  const sourceName = options.sourceName ?? 'verified-build-source'
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 50))
  const requestsPerSecond = Math.max(0.1, options.requestsPerSecond ?? 3)
  const maxRetries = Math.max(0, options.maxRetries ?? 3)
  const minIntervalMs = Math.ceil(1000 / requestsPerSecond)

  const results = new Map<string, VerifiedBuildStatus>()

  if (options.verifiedProgramsListEndpoint) {
    const verifiedSet = await fetchVerifiedProgramsSet({
      endpointTemplate: options.verifiedProgramsListEndpoint,
      apiToken: options.apiToken,
      timeoutMs,
      maxRetries,
      requestsPerSecond,
    })

    for (const programId of programIds) {
      results.set(programId, {
        programId,
        isVerifiedBuild: verifiedSet.has(programId),
        source: sourceName,
        error: null,
      })
    }

    return results
  }

  let index = 0
  let nextRequestAt = 0

  async function waitForRateLimit(): Promise<void> {
    const now = Date.now()
    const waitMs = Math.max(0, nextRequestAt - now)
    nextRequestAt = Math.max(nextRequestAt, now) + minIntervalMs
    if (waitMs > 0) await sleep(waitMs)
  }

  async function worker(): Promise<void> {
    while (true) {
      const current = index
      index++
      if (current >= programIds.length) return

      const programId = programIds[current]
      await waitForRateLimit()
      const status = await checkOneProgram(programId, {
        endpointTemplate,
        apiToken: options.apiToken,
        timeoutMs,
        sourceName,
        maxRetries,
      })
      results.set(programId, status)
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return results
}
