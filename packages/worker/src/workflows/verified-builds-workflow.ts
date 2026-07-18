/**
 * DEPRECATED: replaced by the split chain
 *   osec-discover (daily) → candidates-import (hourly) → verified-match (weekly)
 *   → verified-analysis.
 * Unscheduled since 2026-07; kept as a manual fallback via
 * POST /api/admin/sync/trigger-verified-builds. Remove binding + class once
 * the split chain has run clean for a few weeks.
 */
import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { fetchIdlWithSource, hasProgramOwnedAnchorIdlAccount } from '../services/idl-fetcher'
import { buildMainnetRpcUrlList } from '../utils/solana-rpc'
import { categorizeProgramWithAI, extractInstructionNames, extractAccountNames, toTitleCase } from '../services/ai-categorization'
import { setCategoryAndAliases } from '../services/search'
import { generateId } from '../utils/id'

const OSEC_URL = 'https://verify.osec.io/verified-programs'
const TAG = '[verified-builds]'
const DB_BATCH = 100  // max IDs per IN() clause
const IDL_BATCH = 5   // programs per IDL-fetch step (~10-15s each, safe under 3min)

type Env = {
  DB: any
  AI: any
  IDLS: any
  CACHE: any
  API_BASE_URL: string
  SOLANA_RPC_URL: string
  SOLANA_MAINNET_RPC_URL?: string
  SOLANA_FALLBACK_RPC_URLS?: string
  SOLANA_MAINNET_FALLBACK_RPC_URLS?: string
  VERIFIED_ANALYSIS_WORKFLOW: any
}

type Params = { trigger?: 'cron' | 'manual' }

async function hashIdl(idlJson: string): Promise<string> {
  const bytes = new TextEncoder().encode(idlJson)
  const buf = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export class VerifiedBuildsWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const trigger = event.payload?.trigger ?? 'cron'
    console.log(`${TAG} ══════════════════════════════════════`)
    console.log(`${TAG} Verified builds pipeline — trigger=${trigger}`)
    console.log(`${TAG} ══════════════════════════════════════`)

    // ── Step 1: Fetch all OSEC verified program IDs ───────────────────────────
    const { programIds, total } = await step.do(
      'step 1: fetch osec verified list',
      { timeout: '3 minutes', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        console.log(`${TAG} [1] Fetching OSEC verified programs...`)

        const fetchPage = async (page: number) => {
          const res = await fetch(`${OSEC_URL}/${page}`, { headers: { Accept: 'application/json' } })
          if (!res.ok) throw new Error(`OSEC API ${res.status} on page ${page}`)
          const json = await res.json() as any
          const ids: string[] = (json.verified_programs ?? [])
            .map((p: any) => typeof p === 'string' ? p : (p?.program_id ?? ''))
            .filter((id: string) => id.length > 0)
          console.log(`${TAG} [1]   page ${page}/${json.meta?.total_pages ?? '?'} → ${ids.length} IDs`)
          return { ids, totalPages: json.meta?.total_pages ?? 1, metaTotal: json.meta?.total ?? 0 }
        }

        const first = await fetchPage(1)
        const all: string[] = [...first.ids]
        for (let p = 2; p <= first.totalPages; p++) {
          const { ids } = await fetchPage(p)
          if (ids.length === 0) break
          all.push(...ids)
        }

        console.log(`${TAG} [1] ✓ ${all.length} verified program IDs fetched from OSEC`)
        return { programIds: all, total: all.length }
      },
    )

    if (total === 0) {
      console.log(`${TAG} OSEC list empty — aborting to protect existing flags`)
      return { total: 0, inDb: 0, imported: 0, noIdl: 0, marked: 0, unmarked: 0 }
    }

    // ── Step 2: Compare OSEC list against Orquestra DB ────────────────────────
    const { inDbIds, missingIds, toUnmark } = await step.do(
      'step 2: compare osec list against db',
      { timeout: '60 seconds', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        console.log(`${TAG} [2] Comparing ${total} OSEC IDs against projects table...`)

        // Which OSEC programs are already in DB
        const inDb = new Set<string>()
        for (let i = 0; i < programIds.length; i += DB_BATCH) {
          const batch = programIds.slice(i, i + DB_BATCH)
          const ph = batch.map(() => '?').join(', ')
          const { results } = await this.env.DB
            .prepare(`SELECT program_id FROM projects WHERE program_id IN (${ph})`)
            .bind(...batch).all()
          for (const r of (results ?? [])) inDb.add((r as any).program_id)
        }

        // Which currently-verified programs dropped off OSEC list
        const osecSet = new Set(programIds)
        const { results: verifiedRows } = await this.env.DB
          .prepare(`SELECT program_id FROM projects WHERE is_verified = 1`).all()
        const toUnmarkIds = (verifiedRows ?? [])
          .map((r: any) => r.program_id as string)
          .filter((id: string) => !osecSet.has(id))

        const inDbIds = [...inDb]
        const missingIds = programIds.filter(id => !inDb.has(id))

        console.log(`${TAG} [2] ✓ DB comparison complete:`)
        console.log(`${TAG} [2]   • ${inDbIds.length} OSEC programs already in DB`)
        console.log(`${TAG} [2]   • ${missingIds.length} OSEC programs NOT in DB → will attempt on-chain IDL import`)
        console.log(`${TAG} [2]   • ${toUnmarkIds.length} programs to unmark (dropped off OSEC list)`)

        return { inDbIds, missingIds, toUnmark: toUnmarkIds }
      },
    )

    // ── Step 3: Diff-and-patch is_verified for existing DB programs ───────────
    const { marked, unmarked } = await step.do(
      'step 3: update verified flags',
      { timeout: '60 seconds', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        console.log(`${TAG} [3] Updating is_verified flags (no blackout — diff only)...`)
        let marked = 0
        let unmarked = 0

        // Mark existing programs newly added to OSEC (only is_verified = 0)
        for (let i = 0; i < inDbIds.length; i += DB_BATCH) {
          const batch = inDbIds.slice(i, i + DB_BATCH)
          const ph = batch.map(() => '?').join(', ')
          const r = await this.env.DB
            .prepare(`UPDATE projects SET is_verified = 1, verified_at = CURRENT_TIMESTAMP WHERE program_id IN (${ph}) AND is_verified = 0`)
            .bind(...batch).run()
          marked += r?.meta?.changes ?? 0
        }

        // Unmark programs that dropped off OSEC list
        for (let i = 0; i < toUnmark.length; i += DB_BATCH) {
          const batch = toUnmark.slice(i, i + DB_BATCH)
          const ph = batch.map(() => '?').join(', ')
          const r = await this.env.DB
            .prepare(`UPDATE projects SET is_verified = 0, verified_at = NULL WHERE program_id IN (${ph})`)
            .bind(...batch).run()
          unmarked += r?.meta?.changes ?? 0
        }

        console.log(`${TAG} [3] ✓ Flags updated: ${marked} newly marked verified, ${unmarked} unmarked`)
        return { marked, unmarked }
      },
    )

    // ── Steps 4..N: Import missing programs via on-chain IDL fetch ────────────
    const idlBatchCount = Math.ceil(missingIds.length / IDL_BATCH)
    console.log(`${TAG} [4] Importing ${missingIds.length} new programs from on-chain IDL...`)
    console.log(`${TAG} [4]   ${idlBatchCount} batch steps × ${IDL_BATCH} programs each`)

    const rpcUrls = buildMainnetRpcUrlList(this.env as any)
    let imported = 0
    let noIdl = 0
    let importedVerified = 0

    for (let i = 0; i < idlBatchCount; i++) {
      const batch = missingIds.slice(i * IDL_BATCH, (i + 1) * IDL_BATCH)

      const result = await step.do(
        `step 4.${i + 1}: import batch ${i + 1}/${idlBatchCount}`,
        { timeout: '3 minutes', retries: { limit: 2, delay: 15000, backoff: 'exponential' } },
        async () => {
          let bImported = 0, bNoIdl = 0, bVerified = 0

          for (const programId of batch) {
            const short = programId.slice(0, 8) + '...'
            try {
              // Fetch on-chain IDL
              const onChain = await fetchIdlWithSource(programId, rpcUrls)
              if (!onChain) {
                console.log(`${TAG} [4.${i+1}]   ${short} — no on-chain IDL`)
                bNoIdl++
                continue
              }

              // Verify IDL account ownership
              if (onChain.source === 'anchor') {
                const owned = await hasProgramOwnedAnchorIdlAccount(programId, rpcUrls)
                if (!owned) {
                  console.log(`${TAG} [4.${i+1}]   ${short} — IDL ownership mismatch, skip`)
                  bNoIdl++
                  continue
                }
              }

              // Derive program name from IDL metadata
              const rawName = (
                (typeof onChain.idl?.name === 'string' && onChain.idl.name) ||
                (typeof onChain.idl?.metadata?.name === 'string' && onChain.idl.metadata.name) ||
                (typeof onChain.idl?.program?.name === 'string' && onChain.idl.program.name) ||
                programId
              ).trim() || programId
              const projectName = toTitleCase(rawName)

              // Create project (INSERT OR IGNORE — safe if already exists from a retry)
              const proposedId = generateId()
              await this.env.DB.prepare(
                `INSERT OR IGNORE INTO projects (id, user_id, name, description, program_id, is_public, is_verified, verified_at, created_at, updated_at)
                 VALUES (?, 'system', ?, '', ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
              ).bind(proposedId, projectName, programId).run()

              // Fetch actual project id (may differ if INSERT was ignored)
              const project = await this.env.DB
                .prepare(`SELECT id FROM projects WHERE program_id = ? LIMIT 1`)
                .bind(programId).first() as { id: string } | null
              const projectId = project?.id
              if (!projectId) { bNoIdl++; continue }

              // Ensure is_verified set even if project pre-existed without it
              await this.env.DB.prepare(
                `UPDATE projects SET is_verified = 1, verified_at = CURRENT_TIMESTAMP WHERE id = ? AND is_verified = 0`,
              ).bind(projectId).run()

              // Insert IDL version if not already present
              const existingIdl = await this.env.DB
                .prepare(`SELECT id FROM idl_versions WHERE project_id = ? LIMIT 1`)
                .bind(projectId).first() as { id: string } | null
              if (!existingIdl) {
                const idlHash = await hashIdl(onChain.idlJson)
                await this.env.DB.prepare(
                  `INSERT INTO idl_versions (id, project_id, idl_json, idl_hash, version, idl_standard, idl_source)
                   VALUES (?, ?, ?, ?, 1, 'anchor', ?)`,
                ).bind(generateId(), projectId, onChain.idlJson, idlHash, onChain.source).run()
              }

              // AI categorization
              let category = 'unknown'
              if (this.env.AI && onChain.idl) {
                try {
                  const cat = await categorizeProgramWithAI(this.env.AI, {
                    name: rawName,
                    programId,
                    instructions: extractInstructionNames(onChain.idl),
                    accounts: extractAccountNames(onChain.idl),
                  })
                  await setCategoryAndAliases(this.env.DB, projectId, cat.category, cat.tags, cat.aliases)
                  category = cat.category
                } catch { /* categorization optional */ }
              }

              console.log(`${TAG} [4.${i+1}]   ${short} ✓ "${projectName}" → ${category}`)
              bImported++
              bVerified++
            } catch (err) {
              console.error(`${TAG} [4.${i+1}]   ${short} error:`, String(err))
              bNoIdl++
            }
          }

          console.log(`${TAG} [4.${i+1}] batch done: ${bImported} imported, ${bNoIdl} no IDL`)
          return { imported: bImported, noIdl: bNoIdl, verified: bVerified }
        },
      )

      imported += result.imported
      noIdl += result.noIdl
      importedVerified += result.verified
    }

    console.log(`${TAG} [4] ✓ Import complete: ${imported} imported, ${noIdl} had no on-chain IDL`)

    // ── Final step: trigger AI analysis for all verified programs ─────────────
    await step.do(
      'step 5: trigger verified analysis',
      { timeout: '30 seconds', retries: { limit: 2, delay: 5000, backoff: 'exponential' } },
      async () => {
        console.log(`${TAG} [5] Triggering VerifiedAnalysisWorkflow for AI docs generation...`)
        try {
          await this.env.VERIFIED_ANALYSIS_WORKFLOW.create({ params: { trigger: 'cron' } })
          console.log(`${TAG} [5] ✓ VerifiedAnalysisWorkflow started`)
        } catch (err) {
          console.error(`${TAG} [5] Failed to trigger VerifiedAnalysisWorkflow:`, String(err))
        }
      },
    )

    const finalResult = {
      total,
      inDb: inDbIds.length,
      imported,
      noOnChainIdl: noIdl,
      marked: marked + importedVerified,
      unmarked,
    }
    console.log(`${TAG} ══════════════════════════════════════`)
    console.log(`${TAG} Pipeline complete`)
    console.log(`${TAG}   OSEC total:        ${total}`)
    console.log(`${TAG}   Already in DB:     ${inDbIds.length}`)
    console.log(`${TAG}   Newly imported:    ${imported}`)
    console.log(`${TAG}   No on-chain IDL:   ${noIdl}`)
    console.log(`${TAG}   Marked verified:   ${marked + importedVerified}`)
    console.log(`${TAG}   Unmarked:          ${unmarked}`)
    console.log(`${TAG} ══════════════════════════════════════`)
    return finalResult
  }
}
