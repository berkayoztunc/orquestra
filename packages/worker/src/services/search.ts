/**
 * Full-text search service with relevance scoring
 * Replaces the simple LIKE pattern matching with intelligent search
 */

import type { D1Database } from '@cloudflare/workers-types'
import { generateId } from '../utils/id'

export interface SearchResult {
  id: string
  name: string
  description: string | null
  program_id: string
  is_public: boolean | number
  updated_at: string
  username: string
  avatar_url: string | null
  category: string | null
  tags: string | null
  aliases: string | null
  relevance_score: number
  match_type: 'name' | 'description' | 'category' | 'tags' | 'aliases'
  is_verified: number | null
  unique_users_7d: number | null
  tx_count_7d: number | null
  fees_sol_7d: number | null
  has_ai_docs: number | null
}

interface FTSRow {
  rank: number
  id: string
  name: string
  description: string | null
  program_id: string
  is_public: boolean | number
  updated_at: string
  username: string
  avatar_url: string | null
  category: string | null
  tags: string | null
  aliases: string | null
  is_verified: number | null
  unique_users_7d: number | null
  tx_count_7d: number | null
  fees_sol_7d: number | null
  has_ai_docs: number | null
}

/**
 * Escape a single token for use inside an FTS5 quoted phrase: "token"*
 * Only double-quotes need escaping within quoted terms.
 */
function escapeToken(token: string): string {
  return token.replace(/"/g, '""')
}

/**
 * Build an FTS5 query from one or more tokens.
 *
 * Each token must appear in at least one text column (AND between tokens).
 * Uses "token"* form to avoid FTS5 operator conflicts with special chars
 * like hyphens, colons, and asterisks that appear in real program names.
 *
 * Column order in projects_fts:
 *   project_id(UNINDEXED=0), name(10), description(2), category(5), tags(8), aliases(8)
 */
function buildFtsQuery(tokens: string[]): string {
  return tokens
    .map((t) => {
      const e = escapeToken(t)
      return (
        `(name:"${e}"* OR aliases:"${e}"* OR tags:"${e}"* OR ` +
        `category:"${e}"* OR description:"${e}"*)`
      )
    })
    .join(' AND ')
}

/**
 * Determine which field most likely matched the search term.
 */
function detectMatchType(row: FTSRow, query: string): SearchResult['match_type'] {
  const q = query.toLowerCase()
  if (row.name?.toLowerCase().includes(q)) return 'name'
  if (row.aliases?.toLowerCase().includes(q)) return 'aliases'
  if (row.tags?.toLowerCase().includes(q)) return 'tags'
  if (row.category?.toLowerCase().includes(q)) return 'category'
  return 'description'
}

/**
 * Search projects with full-text search and relevance ranking.
 * Falls back to LIKE search if FTS fails or FTS index is unavailable.
 */
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export async function searchProjects(
  db: D1Database,
  searchQuery: string,
  limit: number = 20,
  offset: number = 0,
  userId?: string,
  filters?: { verified?: boolean; has_ai_docs?: boolean }
): Promise<{ results: SearchResult[]; total: number }> {
  const trimmed = searchQuery.trim()

  // Build filter conditions (shared across all query paths)
  const filterParts: string[] = []
  if (filters?.verified) filterParts.push('p.is_verified = 1')
  if (filters?.has_ai_docs) filterParts.push('aa.short_description IS NOT NULL')
  const filterSQL = filterParts.length > 0 ? ` AND ${filterParts.join(' AND ')}` : ''

  // Fast path: exact program_id lookup (base58 Solana address)
  if (BASE58_RE.test(trimmed)) {
    const visibilityCond = userId ? '(p.is_public = 1 OR p.user_id = ?)' : 'p.is_public = 1'
    const sql = `
      SELECT p.id, p.name, p.description, p.program_id, p.is_public, p.updated_at,
             u.username, u.avatar_url,
             COALESCE(pc.category, '') as category,
             COALESCE(pc.tags, '') as tags,
             COALESCE(pc.aliases, '') as aliases,
             p.is_verified, pm.unique_users_7d, pm.tx_count_7d, pm.fees_sol_7d,
             CASE WHEN aa.short_description IS NOT NULL THEN 1 ELSE 0 END AS has_ai_docs
      FROM projects p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN program_categories pc ON p.id = pc.project_id
      LEFT JOIN program_metrics pm ON p.program_id = pm.program_id
      LEFT JOIN ai_analyses aa ON aa.project_id = p.id
      WHERE p.program_id = ? AND ${visibilityCond}${filterSQL}
      LIMIT 1`

    const params = userId ? [trimmed, userId] : [trimmed]
    const row = await db.prepare(sql).bind(...params).first<FTSRow>()
    if (row) {
      const { rank: _rank, ...rest } = row
      return {
        results: [{ ...rest, relevance_score: 0, match_type: 'name' as const }],
        total: 1,
      }
    }
    // Not found by exact address — fall through to FTS
  }

  const tokens = trimmed
    .split(/\s+/)
    .filter(Boolean)
    .map(escapeToken)

  if (tokens.length === 0) {
    return { results: [], total: 0 }
  }

  const ftsQuery = buildFtsQuery(tokens)

  try {
    // BM25 weights: project_id(0), name(10), description(2), category(5), tags(8), aliases(8)
    const visibilityFts = userId ? '(p.is_public = 1 OR p.user_id = ?)' : 'p.is_public = 1'

    const countSQL = `
      SELECT COUNT(*) as count
      FROM projects_fts
      JOIN projects p ON projects_fts.project_id = p.id
      LEFT JOIN ai_analyses aa ON aa.project_id = p.id
      WHERE projects_fts MATCH ? AND ${visibilityFts}${filterSQL}`

    const countParams = userId ? [ftsQuery, userId] : [ftsQuery]
    const countResult = await db.prepare(countSQL).bind(...countParams).first<{ count: number }>()
    const total = countResult?.count || 0

    const resultSQL = `
      SELECT
        bm25(projects_fts, 0, 10, 2, 5, 8, 8) as rank,
        p.id, p.name, p.description, p.program_id, p.is_public, p.updated_at,
        u.username, u.avatar_url,
        COALESCE(pc.category, '') as category,
        COALESCE(pc.tags, '') as tags,
        COALESCE(pc.aliases, '') as aliases,
        p.is_verified, pm.unique_users_7d, pm.tx_count_7d, pm.fees_sol_7d,
        CASE WHEN aa.short_description IS NOT NULL THEN 1 ELSE 0 END AS has_ai_docs
      FROM projects_fts
      JOIN projects p ON projects_fts.project_id = p.id
      JOIN users u ON p.user_id = u.id
      LEFT JOIN program_categories pc ON p.id = pc.project_id
      LEFT JOIN program_metrics pm ON p.program_id = pm.program_id
      LEFT JOIN ai_analyses aa ON aa.project_id = p.id
      WHERE projects_fts MATCH ? AND ${visibilityFts}${filterSQL}
      ORDER BY COALESCE(pm.unique_users_7d, 0) DESC, COALESCE(pm.tx_count_7d, 0) DESC, rank ASC
      LIMIT ? OFFSET ?`

    const resultParams = userId ? [ftsQuery, userId, limit, offset] : [ftsQuery, limit, offset]

    const rows = await db.prepare(resultSQL).bind(...resultParams).all<FTSRow>()
    const results = (rows.results || []).map((row) => ({
      ...row,
      relevance_score: Math.abs(row.rank),
      match_type: detectMatchType(row, searchQuery),
    }))

    return { results, total }
  } catch (error) {
    console.error('FTS search error:', error)
    return fallbackLikeSearch(db, searchQuery, limit, offset, userId, filters)
  }
}

/**
 * Fallback to LIKE search when FTS is unavailable.
 * Covers all text fields: name, description, category, aliases, tags.
 */
async function fallbackLikeSearch(
  db: D1Database,
  searchQuery: string,
  limit: number,
  offset: number,
  userId?: string,
  filters?: { verified?: boolean; has_ai_docs?: boolean }
): Promise<{ results: SearchResult[]; total: number }> {
  const searchTerm = `%${searchQuery.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`

  const filterParts: string[] = []
  if (filters?.verified) filterParts.push('p.is_verified = 1')
  if (filters?.has_ai_docs) filterParts.push('aa.short_description IS NOT NULL')
  const filterSQL = filterParts.length > 0 ? ` AND ${filterParts.join(' AND ')}` : ''

  const likeCondition = `(
    LOWER(p.name) LIKE LOWER(?) ESCAPE '\\'
    OR LOWER(COALESCE(p.description,'')) LIKE LOWER(?) ESCAPE '\\'
    OR LOWER(COALESCE(pc.aliases,'')) LIKE LOWER(?) ESCAPE '\\'
    OR LOWER(COALESCE(pc.tags,'')) LIKE LOWER(?) ESCAPE '\\'
    OR LOWER(COALESCE(pc.category,'')) LIKE LOWER(?) ESCAPE '\\'
    OR p.program_id LIKE ? ESCAPE '\\'
  )`

  const visibilityCount = userId ? '(p.is_public = 1 OR p.user_id = ?)' : 'p.is_public = 1'
  const countSQL = `
    SELECT COUNT(*) as count FROM projects p
    LEFT JOIN program_categories pc ON p.id = pc.project_id
    LEFT JOIN ai_analyses aa ON aa.project_id = p.id
    WHERE ${visibilityCount} AND ${likeCondition}${filterSQL}`

  const countParams: any[] = userId
    ? [userId, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm]
    : [searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm]

  const countResult = await db.prepare(countSQL).bind(...countParams).first<{ count: number }>()
  const total = countResult?.count || 0

  const visibilityResult = userId ? '(p.is_public = 1 OR p.user_id = ?)' : 'p.is_public = 1'
  const resultSQL = `
    SELECT p.id, p.name, p.description, p.program_id, p.is_public, p.updated_at, p.is_verified,
           u.username, u.avatar_url,
           COALESCE(pc.category, '') as category,
           COALESCE(pc.tags, '') as tags,
           COALESCE(pc.aliases, '') as aliases,
           pm.unique_users_7d, pm.tx_count_7d, pm.fees_sol_7d,
           CASE WHEN aa.short_description IS NOT NULL THEN 1 ELSE 0 END AS has_ai_docs
    FROM projects p
    JOIN users u ON p.user_id = u.id
    LEFT JOIN program_categories pc ON p.id = pc.project_id
    LEFT JOIN program_metrics pm ON p.program_id = pm.program_id
    LEFT JOIN ai_analyses aa ON aa.project_id = p.id
    WHERE ${visibilityResult} AND ${likeCondition}${filterSQL}
    ORDER BY COALESCE(pm.unique_users_7d, 0) DESC, COALESCE(pm.tx_count_7d, 0) DESC, p.updated_at DESC
    LIMIT ? OFFSET ?`

  const resultParams: any[] = userId
    ? [userId, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, limit, offset]
    : [searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, limit, offset]

  const rows = await db.prepare(resultSQL).bind(...resultParams).all<FTSRow>()
  const results = (rows.results || []).map((row) => ({
    ...row,
    relevance_score: 0,
    match_type: detectMatchType(row, searchQuery),
  }))

  return { results, total }
}

/**
 * Add program category and aliases (call when creating/updating a project)
 */
export async function setCategoryAndAliases(
  db: D1Database,
  projectId: string,
  category: string,
  tags: string[] = [],
  aliases: string[] = []
): Promise<void> {
  const tagStr = tags.join(',')
  const aliasStr = aliases.join(',')

  const upsertSQL = `
    INSERT INTO program_categories (id, project_id, category, tags, aliases)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      category = excluded.category,
      tags = excluded.tags,
      aliases = excluded.aliases,
      created_at = CURRENT_TIMESTAMP
  `

  const id = generateId()
  await db.prepare(upsertSQL).bind(id, projectId, category, tagStr, aliasStr).run()
}

/**
 * Popular alias mappings to improve search UX
 * Maps common misspellings and variations to canonical names
 */
export const KNOWN_ALIASES: Record<string, { category: string; aliases: string[] }> = {
  pumpfun: {
    category: 'token-launch',
    aliases: ['pump', 'pump.fun', 'pumpfun', 'pump fun'],
  },
  magic_eden: {
    category: 'nft-marketplace',
    aliases: ['magiceden', 'magic eden', 'me'],
  },
  raydium: {
    category: 'dex-amm',
    aliases: ['ray', 'raydium', 'ray dium'],
  },
  orca: {
    category: 'dex-amm',
    aliases: ['orca swap', 'orca protocol'],
  },
  marinade: {
    category: 'staking',
    aliases: ['marin', 'marinade stake'],
  },
  marinade_finance: {
    category: 'staking',
    aliases: ['marin', 'marinade finance'],
  },
}
