/**
 * Tiny module-scope TTL + LRU cache.
 * Lives only for the lifetime of a warm Workers isolate — no cross-isolate
 * consistency, so keep TTLs short and treat cached values as immutable.
 */
export class MemoCache<T> {
  private map = new Map<string, { value: T; expiresAt: number }>()

  constructor(
    private maxEntries = 50,
    private ttlMs = 60_000,
  ) {}

  get(key: string): T | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key)
      return undefined
    }
    // Re-insert to mark as most recently used
    this.map.delete(key)
    this.map.set(key, entry)
    return entry.value
  }

  set(key: string, value: T): void {
    if (this.map.has(key)) {
      this.map.delete(key)
    } else if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }

  deleteByPrefix(prefix: string): void {
    for (const key of this.map.keys()) {
      if (key.startsWith(prefix)) this.map.delete(key)
    }
  }

  clear(): void {
    this.map.clear()
  }
}
