/**
 * Shared IDL fetch (KV cache → D1 fallback), extracted from `routes/mcp.ts`
 * so non-HTTP callers — notably the FlowAuthorAgent Durable Object — can reuse
 * exactly the same resolution path and warm-isolate memo instead of
 * duplicating it. Pure `(projectId, env)`, no Hono context.
 */

import type { D1Database, KVNamespace } from '@cloudflare/workers-types'
import type { AnchorIDL } from './idl-parser'
import { MemoCache } from '../utils/memo-cache'

export type FetchedIDL = {
  idl: AnchorIDL
  programId: string
  projectName: string
  cpiMd: string | null
}

export type IdlFetchEnv = {
  DB?: D1Database
  IDLS?: KVNamespace
}

// Warm-isolate memo: skips the KV read + JSON.parse of large IDLs on repeated
// tool calls. Cached objects are treated as immutable by all callers.
const idlMemo = new MemoCache<FetchedIDL>(50, 60_000)

export async function fetchIDL(projectId: string, env: IdlFetchEnv): Promise<FetchedIDL | null> {
  const memoized = idlMemo.get(projectId)
  if (memoized) return memoized

  const result = await fetchIDLUncached(projectId, env)
  if (result) idlMemo.set(projectId, result)
  return result
}

async function fetchIDLUncached(projectId: string, env: IdlFetchEnv): Promise<FetchedIDL | null> {
  // 1. Try KV cache first (same pattern as llms.ts and api.ts)
  const cached = await env.IDLS?.get(`project:${projectId}`)
  if (cached) {
    try {
      const parsed = JSON.parse(cached)
      return {
        idl: parsed.idl as AnchorIDL,
        programId: parsed.programId ?? '',
        projectName: parsed.projectName ?? projectId,
        cpiMd: null,
      }
    } catch {
      // fall through to DB
    }
  }

  // 2. Fall back to D1
  const row = await env.DB?.prepare(
    `SELECT p.name, p.program_id, p.is_public, v.idl_json, v.cpi_md
     FROM projects p
     JOIN idl_versions v ON v.project_id = p.id
     WHERE p.id = ?
     ORDER BY v.version DESC LIMIT 1`,
  )
    .bind(projectId)
    .first()

  if (!row) return null
  if (!row.is_public) return null // only public projects

  try {
    const idl = JSON.parse(row.idl_json as string) as AnchorIDL
    return {
      idl,
      programId: row.program_id as string,
      projectName: row.name as string,
      cpiMd: (row.cpi_md as string | null) ?? null,
    }
  } catch {
    return null
  }
}
