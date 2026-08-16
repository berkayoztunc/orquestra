import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { identifyProgram, extractInstructionNames, extractAccountNames } from '../services/ai-categorization'
import { lookupProgramIdentity, mapHeliusCategory } from '../services/helius-identity'
import { setCategoryAndAliases } from '../services/search'
import { hibernateEvery } from '../utils/workflow-helpers'

const TAG = '[bulk-recategorize-workflow]'
const QUERY_LIMIT = 500
const BATCH_SIZE = 25

type Env = {
  DB: any
  AI: any
  HELIUS_API_KEY?: string
}

type Params = {
  trigger?: 'manual' | 'admin'
  /**
   * 'uncategorized' (default): the original behavior — categorize projects
   * with no program_categories row yet, via identifyProgram (Helius, AI
   * fallback).
   * 'backfill': re-check ALREADY-categorized projects against Helius ONLY
   * (no AI fallback — a miss just leaves the existing AI-guessed row
   * untouched, since re-guessing isn't the point of a backfill) and
   * overwrite with verified data wherever Helius has a match. One-time pass
   * for rows categorized before Helius integration existed.
   */
  mode?: 'uncategorized' | 'backfill'
}

type ProjectRow = {
  id: string; name: string; program_id: string; idl_json: string
}

export class BulkRecategorizeWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const trigger = event.payload?.trigger ?? 'manual'
    const mode = event.payload?.mode ?? 'uncategorized'
    console.log(`${TAG} started (trigger=${trigger}, mode=${mode})`)

    // ── Step 1: query target projects ──────────────────────────────────────
    const projects = await step.do(
      `query ${mode} projects`,
      { timeout: '30 seconds', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        const { results } = await this.env.DB
          .prepare(
            mode === 'backfill'
              ? `
                SELECT p.id, p.name, p.program_id, v.idl_json
                FROM projects p
                JOIN idl_versions v ON v.project_id = p.id
                JOIN program_categories pc ON pc.project_id = p.id
                WHERE p.is_public = 1 AND pc.source IS NOT 'helius'
                GROUP BY p.id
                ORDER BY p.created_at DESC
                LIMIT ?
              `
              : `
                SELECT p.id, p.name, p.program_id, v.idl_json
                FROM projects p
                JOIN idl_versions v ON v.project_id = p.id
                LEFT JOIN program_categories pc ON pc.project_id = p.id
                WHERE pc.id IS NULL
                  AND p.is_public = 1
                GROUP BY p.id
                ORDER BY p.created_at DESC
                LIMIT ?
              `,
          )
          .bind(QUERY_LIMIT)
          .all()

        console.log(`${TAG} found ${results?.length ?? 0} ${mode} projects`)
        return (results ?? []) as ProjectRow[]
      },
    )

    if (!projects.length) {
      console.log(`${TAG} nothing to process, done`)
      return { categorized: 0, upgraded: 0, errors: 0, total: 0 }
    }

    // ── Steps 2..N: process in batches of 25 ─────────────────────────────────
    const totalBatches = Math.ceil(projects.length / BATCH_SIZE)
    let categorized = 0, upgraded = 0, errors = 0

    for (let i = 0; i < totalBatches; i++) {
      const batch = projects.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)

      const result = await step.do(
        `${mode} batch ${i + 1} of ${totalBatches}`,
        { timeout: '2 minutes', retries: { limit: 1, delay: 10000, backoff: 'exponential' } },
        async () => {
          let batchOk = 0, batchUpgraded = 0, batchErr = 0

          for (const p of batch) {
            try {
              if (mode === 'backfill') {
                // Helius only — a miss leaves the existing row exactly as it
                // was, since the goal is upgrading rows Helius can verify,
                // not re-running AI guesses on everything else.
                const identity = await lookupProgramIdentity(p.program_id, this.env)
                if (identity) {
                  await setCategoryAndAliases(this.env.DB, p.id, mapHeliusCategory(identity.category), [], [], {
                    source: 'helius',
                    website: identity.website,
                    iconUrl: identity.iconUrl,
                    twitter: identity.twitter,
                    discord: identity.discord,
                  })
                  batchUpgraded++
                }
                batchOk++
                continue
              }

              const idl = JSON.parse(p.idl_json)
              const instructions = extractInstructionNames(idl)
              const accounts = extractAccountNames(idl)
              const cat = await identifyProgram(this.env, {
                name: p.name,
                programId: p.program_id,
                instructions,
                accounts,
              })
              await setCategoryAndAliases(this.env.DB, p.id, cat.category, cat.tags, cat.aliases, {
                source: cat.source,
                website: cat.website,
                iconUrl: cat.iconUrl,
                twitter: cat.twitter,
                discord: cat.discord,
              })
              batchOk++
            } catch (err) {
              console.error(`${TAG} failed to process ${p.id}:`, err)
              batchErr++
            }
          }

          console.log(`${TAG} batch ${i + 1}/${totalBatches}: ok=${batchOk} upgraded=${batchUpgraded} err=${batchErr}`)
          return { ok: batchOk, upgraded: batchUpgraded, err: batchErr }
        },
      )

      categorized += result.ok
      upgraded += result.upgraded
      errors += result.err

      // Fast batches (esp. backfill's Helius-only lookups) can pile up
      // subrequests within one isolate invocation — same pattern other
      // per-batch workflows in this repo use.
      await hibernateEvery(step, i + 1, 10, `batch ${i + 1}`)
    }

    const final = { categorized, upgraded, errors, total: projects.length, mode }
    console.log(`${TAG} workflow complete`, final)
    return final
  }
}
