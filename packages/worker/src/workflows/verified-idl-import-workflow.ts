import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { fetchIdlWithSource, hasProgramOwnedAnchorIdlAccount } from '../services/idl-fetcher'
import { buildMainnetRpcUrlList } from '../utils/solana-rpc'
import { categorizeProgramWithAI, extractInstructionNames, extractAccountNames, toTitleCase } from '../services/ai-categorization'
import { setCategoryAndAliases } from '../services/search'
import { generateId } from '../utils/id'
import { fetchOsecVerifiedProgramIds } from '../services/osec'
import { hashIdl } from '../utils/crypto'
import { deriveIdlProgramName } from '../utils/idl-naming'

const TAG = '[verified-idl-import]'
const DB_BATCH = 100      // max IDs per IN() clause
const IDL_BATCH = 5       // programs per IDL-fetch step (~10-15s each, safe under 3min)
const RPC_THROTTLE_MS = 350 // delay between each program's on-chain RPC fetch — buffer against rate limits

type Env = {
  DB: any
  AI: any
  IDLS: any
  CACHE: any
  SOLANA_RPC_URL: string
  SOLANA_MAINNET_RPC_URL?: string
  SOLANA_FALLBACK_RPC_URLS?: string
  SOLANA_MAINNET_FALLBACK_RPC_URLS?: string
  VERIFIED_ANALYSIS_WORKFLOW: any
}

type Params = { trigger?: 'admin' | 'manual' | 'cron' }

type Target = { programId: string; projectId: string | null }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Fetches on-chain IDL for OSEC-verified programs that are either missing
 * from the DB entirely, or already tracked but missing an idl_versions row.
 * Deliberately throttles RPC calls with a fixed delay between requests to
 * avoid the rate-limit issues seen in the combined VerifiedBuildsWorkflow.
 */
export class VerifiedIdlImportWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const trigger = event.payload?.trigger ?? 'manual'
    console.log(`${TAG} started (trigger=${trigger})`)

    // ── Step 1: fetch OSEC verified list ───────────────────────────────────
    const { programIds, total } = await step.do(
      'step 1: fetch osec verified list',
      { timeout: '3 minutes', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        const result = await fetchOsecVerifiedProgramIds()
        console.log(`${TAG} [1] ✓ ${result.total} verified program IDs fetched from OSEC`)
        return result
      },
    )

    if (total === 0) {
      console.log(`${TAG} OSEC list empty — aborting`)
      return { total: 0, missingFromDb: 0, missingIdl: 0, imported: 0, noIdl: 0 }
    }

    // ── Step 2: compute target set ──────────────────────────────────────────
    const { targets, missingFromDbCount, missingIdlCount } = await step.do(
      'step 2: compute target set',
      { timeout: '60 seconds', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        const existing = new Map<string, string>() // program_id -> project id
        for (let i = 0; i < programIds.length; i += DB_BATCH) {
          const batch = programIds.slice(i, i + DB_BATCH)
          const ph = batch.map(() => '?').join(', ')
          const { results } = await this.env.DB
            .prepare(`SELECT id, program_id FROM projects WHERE program_id IN (${ph})`)
            .bind(...batch).all()
          for (const r of (results ?? [])) existing.set((r as any).program_id, (r as any).id)
        }

        const missingFromDbIds = programIds.filter(id => !existing.has(id))

        const existingIds = [...existing.values()]
        const missingIdlProjectIds = new Set<string>()
        for (let i = 0; i < existingIds.length; i += DB_BATCH) {
          const batch = existingIds.slice(i, i + DB_BATCH)
          const ph = batch.map(() => '?').join(', ')
          const { results } = await this.env.DB
            .prepare(
              `SELECT p.id FROM projects p LEFT JOIN idl_versions v ON v.project_id = p.id
               WHERE p.id IN (${ph}) AND v.id IS NULL`,
            )
            .bind(...batch).all()
          for (const r of (results ?? [])) missingIdlProjectIds.add((r as any).id)
        }

        const targets: Target[] = [
          ...missingFromDbIds.map((programId) => ({ programId, projectId: null })),
          ...[...existing.entries()]
            .filter(([, projectId]) => missingIdlProjectIds.has(projectId))
            .map(([programId, projectId]) => ({ programId, projectId })),
        ]

        console.log(`${TAG} [2] ✓ ${missingFromDbIds.length} missing from DB, ${missingIdlProjectIds.size} missing IDL — ${targets.length} targets total`)
        return { targets, missingFromDbCount: missingFromDbIds.length, missingIdlCount: missingIdlProjectIds.size }
      },
    )

    // ── Steps 3..N: throttled on-chain IDL import ───────────────────────────
    const idlBatchCount = Math.ceil(targets.length / IDL_BATCH)
    console.log(`${TAG} [3] Importing IDL for ${targets.length} programs — ${idlBatchCount} batches × ${IDL_BATCH}, ${RPC_THROTTLE_MS}ms throttle`)

    const rpcUrls = buildMainnetRpcUrlList(this.env as any)
    let imported = 0
    let noIdl = 0

    for (let i = 0; i < idlBatchCount; i++) {
      const batch = targets.slice(i * IDL_BATCH, (i + 1) * IDL_BATCH)

      const result = await step.do(
        `step 3.${i + 1}: import batch ${i + 1}/${idlBatchCount}`,
        { timeout: '3 minutes', retries: { limit: 2, delay: 15000, backoff: 'exponential' } },
        async () => {
          let bImported = 0, bNoIdl = 0

          for (const target of batch) {
            const { programId } = target
            const short = programId.slice(0, 8) + '...'
            try {
              const onChain = await fetchIdlWithSource(programId, rpcUrls)
              if (!onChain) {
                console.log(`${TAG} [3.${i + 1}]   ${short} — no on-chain IDL`)
                bNoIdl++
                await sleep(RPC_THROTTLE_MS)
                continue
              }

              if (onChain.source === 'anchor') {
                const owned = await hasProgramOwnedAnchorIdlAccount(programId, rpcUrls)
                if (!owned) {
                  console.log(`${TAG} [3.${i + 1}]   ${short} — IDL ownership mismatch, skip`)
                  bNoIdl++
                  await sleep(RPC_THROTTLE_MS)
                  continue
                }
              }

              const rawName = deriveIdlProgramName(onChain.idl, programId)
              const projectName = toTitleCase(rawName)

              let projectId = target.projectId
              if (!projectId) {
                const proposedId = generateId()
                await this.env.DB.prepare(
                  `INSERT OR IGNORE INTO projects (id, user_id, name, description, program_id, is_public, is_verified, verified_at, created_at, updated_at)
                   VALUES (?, 'system', ?, '', ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                ).bind(proposedId, projectName, programId).run()

                const project = await this.env.DB
                  .prepare(`SELECT id FROM projects WHERE program_id = ? LIMIT 1`)
                  .bind(programId).first() as { id: string } | null
                projectId = project?.id ?? null
                if (!projectId) { bNoIdl++; await sleep(RPC_THROTTLE_MS); continue }
              } else {
                await this.env.DB.prepare(
                  `UPDATE projects SET is_verified = 1, verified_at = CURRENT_TIMESTAMP WHERE id = ? AND is_verified = 0`,
                ).bind(projectId).run()
              }

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

              console.log(`${TAG} [3.${i + 1}]   ${short} ✓ "${projectName}" → ${category}`)
              bImported++
            } catch (err) {
              console.error(`${TAG} [3.${i + 1}]   ${short} error:`, String(err))
              bNoIdl++
            }

            await sleep(RPC_THROTTLE_MS)
          }

          console.log(`${TAG} [3.${i + 1}] batch done: ${bImported} imported, ${bNoIdl} no IDL`)
          return { imported: bImported, noIdl: bNoIdl }
        },
      )

      imported += result.imported
      noIdl += result.noIdl
    }

    console.log(`${TAG} [3] ✓ Import complete: ${imported} imported, ${noIdl} had no on-chain IDL`)

    // ── Final step: trigger AI analysis ─────────────────────────────────────
    await step.do(
      'step 4: trigger verified analysis',
      { timeout: '30 seconds', retries: { limit: 2, delay: 5000, backoff: 'exponential' } },
      async () => {
        try {
          await this.env.VERIFIED_ANALYSIS_WORKFLOW.create({ params: { trigger: 'admin' } })
          console.log(`${TAG} [4] ✓ VerifiedAnalysisWorkflow started`)
        } catch (err) {
          console.error(`${TAG} [4] Failed to trigger VerifiedAnalysisWorkflow:`, String(err))
        }
      },
    )

    const finalResult = { total, missingFromDb: missingFromDbCount, missingIdl: missingIdlCount, imported, noIdl }
    console.log(`${TAG} complete`, finalResult)
    return finalResult
  }
}
