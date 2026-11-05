/**
 * Name similarity for uploads. Program IDs are first-come-first-served, so impersonating a
 * well-known program usually means uploading an IDL under a name that is the same as, or a
 * near-copy of, an existing project's name. Manual uploads are rejected when that happens.
 */

const NOISE_WORDS = /\b(program|protocol|finance|labs|v\d+)\b/g

/** Lowercase, drop noise words, keep only letters and digits ("Meteora AMM" → "meteoraamm"). */
export function normalizeProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[_\-.]/g, ' ')
    .replace(NOISE_WORDS, ' ')
    .replace(/[^a-z0-9]/g, '')
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/** True when two names are the same or close enough to be confused with each other. */
export function namesAreSimilar(a: string, b: string): boolean {
  const x = normalizeProjectName(a)
  const y = normalizeProjectName(b)
  if (x.length < 3 || y.length < 3) return false
  if (x === y) return true

  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  // One name wholly contains the other ("metaplex" vs "metaplexcore").
  if (short.length >= 6 && long.includes(short) && short.length / long.length >= 0.6) return true

  if (short.length >= 4) {
    const similarity = 1 - levenshtein(x, y) / Math.max(x.length, y.length)
    if (similarity >= 0.85) return true
  }
  return false
}

/** First existing entry whose name is similar to any of `candidates` (the project name and the IDL's own name). */
export function findSimilarName<T extends { name: string }>(candidates: string[], existing: T[]): T | null {
  const names = candidates.filter((n) => typeof n === 'string' && n.trim().length > 0)
  for (const row of existing) {
    if (names.some((n) => namesAreSimilar(n, row.name))) return row
  }
  return null
}

/** The IDL's own program name (Anchor legacy `name`, Anchor 0.30+ `metadata.name`, Codama `program.name`). */
export function idlOwnName(idl: any): string | null {
  const n = idl?.metadata?.name ?? idl?.name ?? idl?.program?.name
  return typeof n === 'string' && n.trim() ? n : null
}
