/**
 * Where a project's IDL came from, and how much to trust it.
 *
 * `idl_versions.idl_source` records the origin of each IDL version:
 *   - 'anchor' | 'pmp' — fetched from the chain (legacy Anchor IDL account / Program Metadata Program)
 *   - 'manual'         — uploaded by a user; NO verified on-chain IDL backs it
 *
 * Why this matters: Orquestra builds real transactions from IDLs, and program IDs are
 * claimed first-come-first-served. An IDL that did not come from the chain is only the
 * uploader's word for what the program's instructions and accounts look like, so every
 * surface that hands an IDL to a person or an agent must say so.
 */

export type IdlSource = 'anchor' | 'pmp' | 'manual'

export interface IdlProvenance {
  /** 'onchain' = read from the chain; 'manual' = uploaded by the project owner. */
  origin: 'onchain' | 'manual'
  /** Raw `idl_source` value ('anchor' when the column is NULL — the historical default). */
  idlSource: IdlSource
  /** True only when the IDL itself was read from an on-chain IDL account. */
  verifiedOnChain: boolean
  /** Human/agent-readable disclosure; null when the IDL is on-chain sourced. */
  notice: string | null
}

export const MANUAL_IDL_NOTICE =
  'No verified on-chain IDL exists for this program (none was found on Solana mainnet-beta). ' +
  'This IDL was uploaded manually by the project owner and has NOT been verified against the chain — ' +
  'treat its instruction names, accounts and arguments as unverified, and check them before signing anything.'

export function idlProvenance(idlSource: string | null | undefined): IdlProvenance {
  if (idlSource === 'manual') {
    return { origin: 'manual', idlSource: 'manual', verifiedOnChain: false, notice: MANUAL_IDL_NOTICE }
  }
  return {
    origin: 'onchain',
    idlSource: idlSource === 'pmp' ? 'pmp' : 'anchor',
    verifiedOnChain: true,
    notice: null,
  }
}

/** One-line markdown banner for text outputs (llms.txt, MCP tool results). Empty string when on-chain sourced. */
export function provenanceBanner(idlSource: string | null | undefined): string {
  const p = idlProvenance(idlSource)
  return p.notice ? `> ⚠️ **Manually uploaded IDL — no on-chain IDL.** ${p.notice}\n\n` : ''
}

// ─── Comparing an uploaded IDL with the on-chain one ─────────────────────────

function normalizeName(name: string): string {
  // snake_case / camelCase / kebab-case all collapse to the same key.
  return name.replace(/[_\-\s]/g, '').toLowerCase()
}

/** Instruction names of an Anchor (`instructions[]`) or Codama (`program.instructions[]`) IDL. */
export function instructionNames(idl: any): string[] {
  const list: unknown =
    (Array.isArray(idl?.instructions) && idl.instructions) ||
    (Array.isArray(idl?.program?.instructions) && idl.program.instructions) ||
    []
  return (list as Array<{ name?: unknown }>)
    .map((ix) => (typeof ix?.name === 'string' ? ix.name : null))
    .filter((n): n is string => n !== null)
}

export interface IdlComparison {
  matches: boolean
  /** Instructions the uploaded IDL declares that the on-chain IDL does not. */
  onlyInUploaded: string[]
  /** Instructions the on-chain IDL declares that the uploaded IDL lacks. */
  onlyOnChain: string[]
}

/**
 * Compares the instruction surface of an uploaded IDL with the on-chain one. The instruction
 * set is the part that decides which transactions Orquestra will build, and it is stable
 * across the cosmetic differences (docs, field renames, metadata) that two honest copies of
 * the same IDL routinely have.
 */
export function compareInstructionSets(uploaded: any, onChain: any): IdlComparison {
  const up = new Map(instructionNames(uploaded).map((n) => [normalizeName(n), n]))
  const chain = new Map(instructionNames(onChain).map((n) => [normalizeName(n), n]))
  const onlyInUploaded = [...up].filter(([k]) => !chain.has(k)).map(([, n]) => n)
  const onlyOnChain = [...chain].filter(([k]) => !up.has(k)).map(([, n]) => n)
  return { matches: onlyInUploaded.length === 0 && onlyOnChain.length === 0, onlyInUploaded, onlyOnChain }
}

/**
 * `idl_source` of a project's latest IDL version (null when the project has no version).
 * The banner/provenance is applied from this at SERVE time — never baked into cached docs and
 * never overridable by `custom_docs` — so an owner cannot strip the disclosure from their own
 * manually uploaded IDL.
 */
export async function latestIdlSource(
  db: { prepare: (sql: string) => { bind: (...v: unknown[]) => { first: <T = unknown>() => Promise<T | null> } } } | undefined | null,
  projectId: string,
): Promise<string | null> {
  if (!db) return null
  const row = await db
    .prepare('SELECT idl_source FROM idl_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1')
    .bind(projectId)
    .first<{ idl_source: string | null }>()
  return row?.idl_source ?? null
}

// ─── Default visibility of manual-IDL projects ───────────────────────────────

/**
 * SQL predicate (alias `p` = projects) that is true unless the project's LATEST IDL version is a
 * manual upload. Used to keep manually uploaded IDLs out of search, lists, sitemaps and MCP by
 * default; callers opt in with `secure=false`.
 */
export const NOT_MANUAL_IDL_SQL =
  `NOT EXISTS (SELECT 1 FROM idl_versions mv WHERE mv.project_id = p.id AND mv.idl_source = 'manual' ` +
  `AND mv.version = (SELECT MAX(version) FROM idl_versions mx WHERE mx.project_id = p.id))`

/**
 * Parses the `secure` flag. Default (undefined/anything else) is `true` = hide manual-IDL projects.
 * Only an explicit `false` / `"false"` / `"0"` opts in to seeing them.
 */
export function parseSecure(value: unknown): boolean {
  if (value === false) return false
  if (typeof value === 'string' && ['false', '0', 'no'].includes(value.trim().toLowerCase())) return false
  return true
}

export const SECURE_FALSE_HINT =
  'This program\'s IDL was uploaded manually and no on-chain IDL exists, so it is hidden by default. ' +
  'Pass secure=false to include it, and only if you trust the uploader.'
