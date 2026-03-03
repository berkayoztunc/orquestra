/**
 * Solana JSON-RPC Client
 * Lightweight RPC wrapper with retry, backoff, and rate-limit awareness.
 * No Node.js builtins — uses global fetch.
 */

export interface RpcClientOptions {
  url: string
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  requestsPerSecond?: number
}

export interface RpcResponse<T = any> {
  jsonrpc: string
  id: number
  result?: T
  error?: { code: number; message: string; data?: any }
}

let _nextId = 1

export class RpcClient {
  private url: string
  private maxRetries: number
  private baseDelayMs: number
  private maxDelayMs: number
  private minIntervalMs: number
  private lastRequestTime = 0

  constructor(opts: RpcClientOptions) {
    this.url = opts.url
    this.maxRetries = opts.maxRetries ?? 5
    this.baseDelayMs = opts.baseDelayMs ?? 500
    this.maxDelayMs = opts.maxDelayMs ?? 30_000
    this.minIntervalMs = opts.requestsPerSecond
      ? Math.ceil(1000 / opts.requestsPerSecond)
      : 0
  }

  /** Throttle to stay under rate-limit */
  private async throttle(): Promise<void> {
    if (this.minIntervalMs <= 0) return
    const now = Date.now()
    const elapsed = now - this.lastRequestTime
    if (elapsed < this.minIntervalMs) {
      await sleep(this.minIntervalMs - elapsed)
    }
    this.lastRequestTime = Date.now()
  }

  /** Send a single JSON-RPC request with retry + exponential backoff */
  async call<T = any>(method: string, params: any[] = []): Promise<T> {
    const id = _nextId++
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params })

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.throttle()
      try {
        const res = await fetch(this.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        })

        if (res.status === 429) {
          const delay = this.backoff(attempt)
          console.warn(`[RPC] 429 rate-limited, retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries + 1})`)
          await sleep(delay)
          continue
        }

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
        }

        const json: RpcResponse<T> = await res.json()
        if (json.error) {
          // Some RPC errors are retryable (server overloaded, etc.)
          if (isRetryableRpcError(json.error.code) && attempt < this.maxRetries) {
            const delay = this.backoff(attempt)
            console.warn(`[RPC] error ${json.error.code}: ${json.error.message}, retrying in ${delay}ms`)
            await sleep(delay)
            continue
          }
          throw new Error(`RPC error ${json.error.code}: ${json.error.message}`)
        }

        return json.result as T
      } catch (err: any) {
        if (attempt >= this.maxRetries) throw err
        if (err.message?.includes('fetch failed') || err.message?.includes('ECONNRESET')) {
          const delay = this.backoff(attempt)
          console.warn(`[RPC] network error, retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries + 1})`)
          await sleep(delay)
          continue
        }
        throw err
      }
    }

    throw new Error('[RPC] max retries exceeded')
  }

  /** Batch multiple RPC calls in a single HTTP request, with retry on 429/network errors */
  async batch<T = any>(calls: Array<{ method: string; params: any[] }>): Promise<(T | Error)[]> {
    const startId = _nextId
    _nextId += calls.length

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const bodies = calls.map((c, i) => ({
        jsonrpc: '2.0' as const,
        id: startId + i,
        method: c.method,
        params: c.params,
      }))

      await this.throttle()
      try {
        const res = await fetch(this.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodies),
        })

        if (res.status === 429) {
          const delay = this.backoff(attempt)
          console.warn(`[RPC batch] 429 rate-limited, retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries + 1})`)
          await sleep(delay)
          continue
        }

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          if (attempt < this.maxRetries) {
            const delay = this.backoff(attempt)
            console.warn(`[RPC batch] HTTP ${res.status}, retrying in ${delay}ms`)
            await sleep(delay)
            continue
          }
          throw new Error(`HTTP ${res.status} on batch: ${text.slice(0, 200)}`)
        }

        const results: RpcResponse<T>[] = await res.json()
        const sorted = results.sort((a, b) => a.id - b.id)
        return sorted.map((r) =>
          r.error ? new Error(`RPC ${r.error.code}: ${r.error.message}`) : (r.result as T)
        )
      } catch (err: any) {
        if (attempt >= this.maxRetries) throw err
        if (err.message?.includes('fetch failed') || err.message?.includes('ECONNRESET') || err.message?.includes('429')) {
          const delay = this.backoff(attempt)
          console.warn(`[RPC batch] error, retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries + 1})`)
          await sleep(delay)
          continue
        }
        throw err
      }
    }

    throw new Error('[RPC batch] max retries exceeded')
  }

  /**
   * Make individual calls sequentially (fallback when batch isn't supported or gets rate-limited).
   * More reliable for public RPCs that rate-limit batch endpoints aggressively.
   */
  async callMany<T = any>(calls: Array<{ method: string; params: any[] }>): Promise<(T | Error)[]> {
    const results: (T | Error)[] = []
    for (const c of calls) {
      try {
        const result = await this.call<T>(c.method, c.params)
        results.push(result)
      } catch (err: any) {
        results.push(err instanceof Error ? err : new Error(String(err)))
      }
    }
    return results
  }

  private backoff(attempt: number): number {
    const delay = Math.min(
      this.baseDelayMs * Math.pow(2, attempt) + Math.random() * this.baseDelayMs,
      this.maxDelayMs
    )
    return Math.round(delay)
  }
}

function isRetryableRpcError(code: number): boolean {
  // -32005 = Node unhealthy, -32603 = Internal error
  return code === -32005 || code === -32603 || code === -32000
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
