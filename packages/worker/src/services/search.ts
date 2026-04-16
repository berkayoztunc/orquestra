/**
 * Full-text search service with relevance scoring
 * Replaces the simple LIKE pattern matching with intelligent search
 */

import type { D1Database } from '@cloudflare/workers-types'

export interface SearchResult {
  id: string
  name: string
  description: string | null
  program_id: string
  username: string
  avatar_url: string | null
  category: string | null
  tags: string | null
  aliases: string | null
  relevance_score: number
  match_type: 'name' | 'description' | 'category' | 'tags' | 'aliases'
}

interface FTSRow {
  rank: number
  id: string
  name: string
  description: string | null
  program_id: string
  username: string
  avatar_url: string | null
  category: string | null
  tags: string | null
  aliases: string | null
}

/**
 * Compute relevance score based on match position and field weight
 * Lower rank (closer to 0) = better match
 * Weight: name > tags/aliases > category > description
 */
function computeRelevanceScore(rank: number, matchType: string): number {
  // FTS5 rank is negative, closer to 0 is better
  // Higher relevance_score is better, so we negate and apply weights
  const weights: Record<string, number> = {
    name: 10,
    tags: 8,
    aliases: 8,
    category: 5,
    description: 2,
  }
  
  const weight = weights[matchType] || 1
  return Math.abs(rank) * (1 / weight)
}

/**
 * Search projects with full-text search and relevance ranking
 */
export async function searchProjects(
  db: D1Database,
  searchQuery: string,
  limit: number = 20,
  offset: number = 0,
  userId?: string
): Promise<{ results: SearchResult[]; total: number }> {
  // Escape FTS5 special characters: " : * -
  const escapedQuery = searchQuery
    .replace(/"/g, '""')
    .replace(/:/g, '\\:')
    .replace(/\*/g, '\\*')
    .replace(/-/g, '\\-')

  // Build FTS5 query with field-specific matching
  // Use OR to match any field, but rank by specificity
  const ftsQuery = `
    (name:${escapedQuery}* OR tags:${escapedQuery}* OR aliases:${escapedQuery}* OR category:${escapedQuery}* OR description:${escapedQuery}*)
  `

  try {
    // Get total count
    const countSQL = userId
      ? `SELECT COUNT(*) as count FROM projects_fts 
         JOIN projects p ON projects_fts.project_id = p.id
         WHERE projects_fts MATCH ? AND (p.is_public = 1 OR p.user_id = ?)`
      : `SELECT COUNT(*) as count FROM projects_fts 
         JOIN projects p ON projects_fts.project_id = p.id
         WHERE projects_fts MATCH ? AND p.is_public = 1`

    const countParams = userId ? [ftsQuery, userId] : [ftsQuery]
    const countResult = await db.prepare(countSQL).bind(...countParams).first<{ count: number }>()
    const total = countResult?.count || 0

    // Get ranked results
    const resultSQL = userId
      ? `
        SELECT 
          projects_fts.rank,
          p.id,
          p.name,
          p.description,
          p.program_id,
          u.username,
          u.avatar_url,
          COALESCE(pc.category, '') as category,
          COALESCE(pc.tags, '') as tags,
          COALESCE(pc.aliases, '') as aliases
        FROM projects_fts
        JOIN projects p ON projects_fts.project_id = p.id
        JOIN users u ON p.user_id = u.id
        LEFT JOIN program_categories pc ON p.id = pc.project_id
        WHERE projects_fts MATCH ? AND (p.is_public = 1 OR p.user_id = ?)
        ORDER BY projects_fts.rank ASC
        LIMIT ? OFFSET ?
      `
      : `
        SELECT 
          projects_fts.rank,
          p.id,
          p.name,
          p.description,
          p.program_id,
          u.username,
          u.avatar_url,
          COALESCE(pc.category, '') as category,
          COALESCE(pc.tags, '') as tags,
          COALESCE(pc.aliases, '') as aliases
        FROM projects_fts
        JOIN projects p ON projects_fts.project_id = p.id
        JOIN users u ON p.user_id = u.id
        LEFT JOIN program_categories pc ON p.id = pc.project_id
        WHERE projects_fts MATCH ? AND p.is_public = 1
        ORDER BY projects_fts.rank ASC
        LIMIT ? OFFSET ?
      `

    const resultParams = userId
      ? [ftsQuery, userId, limit, offset]
      : [ftsQuery, limit, offset]

    const rows = await db.prepare(resultSQL).bind(...resultParams).all<FTSRow>()
    const results = (rows.results || []).map((row) => ({
      ...row,
      relevance_score: computeRelevanceScore(row.rank, 'name'), // Simplified for now
      match_type: 'name' as const,
    }))

    return { results, total }
  } catch (error) {
    console.error('FTS search error:', error)
    // Fallback to LIKE search if FTS fails
    return fallbackLikeSearch(db, searchQuery, limit, offset, userId)
  }
}

/**
 * Fallback to simple LIKE search if FTS is unavailable
 * (e.g., during migration or if FTS table not created)
 */
async function fallbackLikeSearch(
  db: D1Database,
  searchQuery: string,
  limit: number,
  offset: number,
  userId?: string
): Promise<{ results: SearchResult[]; total: number }> {
  const searchTerm = `%${searchQuery.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`

  const countSQL = userId
    ? "SELECT COUNT(*) as count FROM projects WHERE (is_public = 1 OR user_id = ?) AND (LOWER(name) LIKE LOWER(?) ESCAPE '\\' OR LOWER(COALESCE(description,'')) LIKE LOWER(?) ESCAPE '\\')"
    : "SELECT COUNT(*) as count FROM projects WHERE is_public = 1 AND (LOWER(name) LIKE LOWER(?) ESCAPE '\\' OR LOWER(COALESCE(description,'')) LIKE LOWER(?) ESCAPE '\\')"

  const countParams = userId ? [userId, searchTerm, searchTerm] : [searchTerm, searchTerm]
  const countResult = await db.prepare(countSQL).bind(...countParams).first<{ count: number }>()
  const total = countResult?.count || 0

  const resultSQL = userId
    ? "SELECT p.*, u.username, u.avatar_url, CAST(0 AS INTEGER) as rank, '' as category, '' as tags, '' as aliases FROM projects p JOIN users u ON p.user_id = u.id WHERE (p.is_public = 1 OR p.user_id = ?) AND (LOWER(p.name) LIKE LOWER(?) ESCAPE '\\' OR LOWER(COALESCE(p.description,'')) LIKE LOWER(?) ESCAPE '\\') ORDER BY p.updated_at DESC LIMIT ? OFFSET ?"
    : "SELECT p.*, u.username, u.avatar_url, CAST(0 AS INTEGER) as rank, '' as category, '' as tags, '' as aliases FROM projects p JOIN users u ON p.user_id = u.id WHERE p.is_public = 1 AND (LOWER(p.name) LIKE LOWER(?) ESCAPE '\\' OR LOWER(COALESCE(p.description,'')) LIKE LOWER(?) ESCAPE '\\') ORDER BY p.updated_at DESC LIMIT ? OFFSET ?"

  const resultParams = userId
    ? [userId, searchTerm, searchTerm, limit, offset]
    : [searchTerm, searchTerm, limit, offset]

  const rows = await db.prepare(resultSQL).bind(...resultParams).all<FTSRow>()
  const results = (rows.results || []).map((row) => ({
    ...row,
    relevance_score: 0,
    match_type: 'name' as const,
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

  const id = `cat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
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
