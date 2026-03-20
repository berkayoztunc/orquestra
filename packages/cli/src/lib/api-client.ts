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
