import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { identifyProgram, extractInstructionNames, extractAccountNames } from '../services/ai-categorization'
import { batchLookupProgramIdentity, mapHeliusCategory } from '../services/helius-identity'
import { setCategoryAndAliases } from '../services/search'
import { hibernateEvery } from '../utils/workflow-helpers'

const TAG = '[bulk-recategorize-workflow]'
const QUERY_LIMIT = 500
// Backfill rows carry no idl_json (see below), so one query can safely cover
// the whole catalog in a single instance instead of chunking across reruns.
const BACKFILL_QUERY_LIMIT = 10_000
const BATCH_SIZE = 25
// Helius's batch-identity endpoint caps at 100 addresses per call. Using it
// (one HTTP call per batch) instead of BATCH_SIZE sequential single lookups
// is the real speed lever for backfill: 1/4 the Workflow steps for the same
// catalog size, which also means 1/4 the `step.sleep` hibernation points —
// each of which was observed stalling for hours on this account (a Workflows
// platform resume issue, not anything in this code).
const BACKFILL_BATCH_SIZE = 100

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
  id: string; name: string; program_id: string
  /** Only present in 'uncategorized' mode — 'backfill' never parses the IDL, so omitting it here keeps step 1's output well under the 1MiB cap even for thousands of rows. */
  idl_json?: string
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
        // Backfill never touches idl_json (Helius is looked up by program_id
        // alone), so it's dropped from the SELECT entirely — the first run
        // hit Cloudflare's 1MiB step-output cap fetching every row's IDL blob
        // at once for data the mode never uses. Rows are tiny without it, so
        // one instance can comfortably cover the whole backfill in one pass.
        const { results } = await this.env.DB
          .prepare(
            mode === 'backfill'
              ? `
                SELECT p.id, p.name, p.program_id
                FROM projects p
                JOIN program_categories pc ON pc.project_id = p.id
                WHERE p.is_public = 1 AND pc.source IS NOT 'helius'
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
          .bind(mode === 'backfill' ? BACKFILL_QUERY_LIMIT : QUERY_LIMIT)
          .all()

        console.log(`${TAG} found ${results?.length ?? 0} ${mode} projects`)
        return (results ?? []) as ProjectRow[]
      },
    )

    if (!projects.length) {
      console.log(`${TAG} nothing to process, done`)
      return { categorized: 0, upgraded: 0, errors: 0, total: 0 }
    }

    // ── Steps 2..N: process in batches ───────────────────────────────────────
    const batchSize = mode === 'backfill' ? BACKFILL_BATCH_SIZE : BATCH_SIZE
    const totalBatches = Math.ceil(projects.length / batchSize)
    let categorized = 0, upgraded = 0, errors = 0

    for (let i = 0; i < totalBatches; i++) {
      const batch = projects.slice(i * batchSize, (i + 1) * batchSize)

      const result = await step.do(
        `${mode} batch ${i + 1} of ${totalBatches}`,
        // Backfill: one 15s-capped batch call covers up to 100 programs.
        // Uncategorized: worst case 25 x 6s single lookups = 150s.
        { timeout: mode === 'backfill' ? '1 minute' : '3 minutes', retries: { limit: 1, delay: 10000, backoff: 'exponential' } },
        async () => {
          let batchOk = 0, batchUpgraded = 0, batchErr = 0

          if (mode === 'backfill') {
            // One HTTP call for the whole batch — see BACKFILL_BATCH_SIZE.
            // A miss for any given program just leaves its existing
            // AI-guessed row untouched; re-guessing isn't the point here.
            const identities = await batchLookupProgramIdentity(batch.map((p) => p.program_id), this.env)
            for (const p of batch) {
              try {
                const identity = identities.get(p.program_id)
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
              } catch (err) {
                console.error(`${TAG} failed to write ${p.id}:`, err)
                batchErr++
              }
            }
          } else {
            for (const p of batch) {
              try {
                if (!p.idl_json) { batchErr++; continue } // uncategorized mode's query always selects it; guards the type only
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
          }

          console.log(`${TAG} batch ${i + 1}/${totalBatches}: ok=${batchOk} upgraded=${batchUpgraded} err=${batchErr}`)
          return { ok: batchOk, upgraded: batchUpgraded, err: batchErr }
        },
      )

      categorized += result.ok
      upgraded += result.upgraded
      errors += result.err

      // Every 30 batches, not 10: each sleep was observed stalling for hours
      // on this account (a Workflows platform resume issue), so the fewer of
      // them the better — this is purely a subrequest-budget safety net now
      // that backfill needs far fewer steps overall.
      await hibernateEvery(step, i + 1, 30, `batch ${i + 1}`)
    }

    const final = { categorized, upgraded, errors, total: projects.length, mode }
    console.log(`${TAG} workflow complete`, final)
    return final
  }
}
