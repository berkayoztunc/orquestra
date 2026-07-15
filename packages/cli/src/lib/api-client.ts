/**
 * HTTP client for the Orquestra Worker ingest endpoint.
 *
 * Sends CLI-discovered IDL + AI analysis to the Worker which persists to D1.
 * Required env vars:
 *   ORQUESTRA_API_URL    — Worker base URL (e.g. https://api.orquestra.dev or http://localhost:8787)
 *   ORQUESTRA_INGEST_KEY — Secret ingest key matching INGEST_API_KEY on the Worker
 */

export interface IngestPayload {
  programId: string
  idl: Record<string, any>
  idlHash: string
  programName?: string
  programDescription?: string
  aiDescription: string | null
  aiAnalysisJson: string | null
  aiModelUsed: string | null
  aiGeneratedAt: string | null
  /** Whether the IDL was sourced from PMP or legacy Anchor account */
  idlSource?: 'pmp' | 'anchor'
}

export interface IngestResult {
  projectId: string
  idlVersionId: string
  aiAnalysisId: string | null
  created: boolean
  newVersion: boolean
}

export interface IngestOutcome {
  success: true
  result: IngestResult
}

export interface IngestError {
  success: false
  error: string
  status?: number
}

export type IngestResponse = IngestOutcome | IngestError

export interface APIClientOptions {
  baseUrl: string
  ingestKey: string
  timeoutMs?: number
  maxRetries?: number
}

/**
 * Send one IDL + AI result to the Worker ingest endpoint.
 * Retries up to maxRetries times with exponential backoff on transient errors (5xx/network).
 */
export async function ingestIDL(
  payload: IngestPayload,
  opts: APIClientOptions,
): Promise<IngestResponse> {
  const url = `${opts.baseUrl.replace(/\/$/, '')}/api/ingest/idl`
  const maxRetries = opts.maxRetries ?? 3
  const timeoutMs = opts.timeoutMs ?? 20_000

  let lastError = ''
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ingest-Key': opts.ingestKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (response.ok) {
        const data = await response.json() as IngestResult
        return { success: true, result: data }
      }

      if (response.status === 401 || response.status === 403) {
        const body = await response.text()
        return { success: false, error: `Auth error (${response.status}): ${body.slice(0, 200)}`, status: response.status }
      }

      if (response.status === 400 || response.status === 409) {
        const body = await response.text()
        return { success: false, error: `Client error (${response.status}): ${body.slice(0, 200)}`, status: response.status }
      }

      // 5xx — retryable
      lastError = `HTTP ${response.status}`
    } catch (err: any) {
      clearTimeout(timeoutId)
      if (err.name === 'AbortError') {
        lastError = 'Timeout'
      } else {
        lastError = err.message ?? String(err)
      }
    }

    if (attempt < maxRetries) {
      const delayMs = 500 * Math.pow(2, attempt - 1) // 500ms, 1s, 2s
      await sleep(delayMs)
    }
  }

  return { success: false, error: `Failed after ${maxRetries} retries: ${lastError}` }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Load API client options from environment variables. Returns null if required vars are missing. */
export function loadAPIClientOptions(): APIClientOptions | null {
  const baseUrl = process.env.ORQUESTRA_API_URL
  const ingestKey = process.env.ORQUESTRA_INGEST_KEY

  if (!baseUrl || !ingestKey) {
    return null
  }

  return { baseUrl, ingestKey }
}

export interface QueueCandidatesResult {
  queued: number
  skipped: number
}

export interface VerifiedBuildMetadataPayload {
  total_programs: number
  verified_programs: number
  verification_errors: number
  source?: string
}

export interface VerifiedBuildMetadataResult {
  ok: boolean
  metadata: {
    total_programs: number
    verified_programs: number
    verification_errors: number
    source: string
    scanned_at: string
  }
}

/**
 * Bulk-add program IDs to the Worker discovery queue.
 * The cron will verify each for an on-chain IDL and auto-import if one is found.
 */
export async function queueCandidates(
  programIds: string[],
  opts: APIClientOptions,
): Promise<QueueCandidatesResult> {
  const url = `${opts.baseUrl.replace(/\/$/, '')}/api/ingest/candidates`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ingest-Key': opts.ingestKey,
      },
      body: JSON.stringify({ programIds, source: 'cli' }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`)
    }

    return await response.json() as QueueCandidatesResult
  } catch (err) {
    clearTimeout(timeoutId)
    throw err
  }
}

export interface WorkflowTriggerResult {
  success: true
  instanceId: string
  message: string
}

export interface WorkflowTriggerError {
  success: false
  error: string
  status?: number
}

export type WorkflowTriggerResponse = WorkflowTriggerResult | WorkflowTriggerError

async function triggerWorkflow(path: string, opts: APIClientOptions): Promise<WorkflowTriggerResponse> {
  const url = `${opts.baseUrl.replace(/\/$/, '')}${path}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'X-Ingest-Key': opts.ingestKey },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    const body = await response.json().catch(() => ({})) as any
    if (!response.ok) {
      return { success: false, error: body?.error ?? `HTTP ${response.status}`, status: response.status }
    }
    return { success: true, instanceId: body.instanceId, message: body.message ?? 'triggered' }
  } catch (err: any) {
    clearTimeout(timeoutId)
    return { success: false, error: err.name === 'AbortError' ? 'Timeout' : (err.message ?? String(err)) }
  }
}

async function getStatus<T>(baseUrl: string, path: string): Promise<T | { error: string }> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`
  try {
    const response = await fetch(url)
    const body = await response.json().catch(() => ({})) as any
    if (!response.ok) return { error: body?.error ?? `HTTP ${response.status}` }
    return body as T
  } catch (err: any) {
    return { error: err.message ?? String(err) }
  }
}

export interface VerifiedMatchStatus {
  total_projects: number
  verified_count: number
  last_verified_at: string | null
}

export interface VerifiedIdlImportStatus {
  verified_missing_idl: number
}

/** Trigger WF1: match OSEC verified list against DB + AI analysis. */
export async function triggerVerifiedMatch(opts: APIClientOptions): Promise<WorkflowTriggerResponse> {
  return triggerWorkflow('/api/admin/sync/trigger-verified-match', opts)
}

export async function getVerifiedMatchStatus(baseUrl: string): Promise<VerifiedMatchStatus | { error: string }> {
  return getStatus<VerifiedMatchStatus>(baseUrl, '/api/admin/sync/verified-match-status')
}

/** Trigger WF2: throttled on-chain IDL backfill for missing/IDL-less OSEC programs. */
export async function triggerVerifiedIdlImport(opts: APIClientOptions): Promise<WorkflowTriggerResponse> {
  return triggerWorkflow('/api/admin/sync/trigger-verified-idl-import', opts)
}

export async function getVerifiedIdlImportStatus(baseUrl: string): Promise<VerifiedIdlImportStatus | { error: string }> {
  return getStatus<VerifiedIdlImportStatus>(baseUrl, '/api/admin/sync/verified-idl-import-status')
}

/**
 * Store verified-build summary so the Sync dashboard can display latest count.
 */
export async function postVerifiedBuildMetadata(
  payload: VerifiedBuildMetadataPayload,
  opts: APIClientOptions,
): Promise<VerifiedBuildMetadataResult> {
  const url = `${opts.baseUrl.replace(/\/$/, '')}/api/ingest/verified-build-metadata`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ingest-Key': opts.ingestKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`)
    }

    return await response.json() as VerifiedBuildMetadataResult
  } catch (err) {
    clearTimeout(timeoutId)
    throw err
  }
}
