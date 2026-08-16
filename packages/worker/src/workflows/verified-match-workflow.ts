import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { fetchOsecVerifiedProgramIds } from '../services/osec'
import { recordWorkflowInstance } from '../services/workflow-registry'
import { checkExistingIds } from '../services/db-batch'
import { sendWorkflowReport } from '../services/telegram'

const TAG = '[verified-match]'
const DB_BATCH = 100 // max IDs per IN() clause

/**
 * Refuse to unmark verified programs when the fetched OSEC list is smaller
 * than this fraction of our current verified count — a partial/broken OSEC
 * response must never mass-clear is_verified flags.
 */
const UNMARK_SAFETY_RATIO = 0.8

type Env = {
  DB: any
  VERIFIED_ANALYSIS_WORKFLOW: any
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
}

type Params = { trigger?: 'admin' | 'manual' | 'cron' }

/**
 * Matches the OSEC verified-programs list against programs already tracked
 * in the DB, updates is_verified flags, and triggers AI analysis for the
 * matched set. Does NOT import programs missing from the DB — that is
 * VerifiedIdlImportWorkflow's job.
 */
export class VerifiedMatchWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const trigger = event.payload?.trigger ?? 'manual'
    const startedAt = Date.now()
    console.log(`${TAG} started (trigger=${trigger})`)

    try {

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
      console.log(`${TAG} OSEC list empty — aborting to protect existing flags`)
      const result = { total: 0, matched: 0, missing: 0, marked: 0, unmarked: 0 }
      await sendWorkflowReport(this.env, { workflow: 'verified-match', trigger, instanceId: event.instanceId, startedAt, ok: true, result })
      return result
    }

    // ── Step 2: match against DB ────────────────────────────────────────────
    const { matchedIds, missingIds, toUnmark } = await step.do(
      'step 2: match against db',
      { timeout: '60 seconds', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        const inDb = await checkExistingIds(this.env.DB, 'projects', 'program_id', programIds, DB_BATCH)

        const osecSet = new Set(programIds)
        const { results: verifiedRows } = await this.env.DB
          .prepare(`SELECT program_id FROM projects WHERE is_verified = 1`).all()
        const currentVerified = (verifiedRows ?? []).length
        let toUnmarkIds = (verifiedRows ?? [])
          .map((r: any) => r.program_id as string)
          .filter((id: string) => !osecSet.has(id))

        // Safety: a suspiciously small OSEC list means partial data, not
        // mass de-verification. Keep existing flags in that case.
        if (currentVerified > 0 && programIds.length < currentVerified * UNMARK_SAFETY_RATIO) {
          console.warn(
            `${TAG} [2] OSEC list (${programIds.length}) < ${UNMARK_SAFETY_RATIO} × current verified (${currentVerified}) — skipping unmark`,
          )
          toUnmarkIds = []
        }

        const matchedIds = [...inDb]
        const missingIds = programIds.filter(id => !inDb.has(id))

        console.log(`${TAG} [2] ✓ ${matchedIds.length} matched in DB, ${missingIds.length} missing (skipped), ${toUnmarkIds.length} to unmark`)
        return { matchedIds, missingIds, toUnmark: toUnmarkIds }
      },
    )

    // ── Step 3: update is_verified flags ────────────────────────────────────
    const { marked, unmarked } = await step.do(
      'step 3: update verified flags',
      { timeout: '60 seconds', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        let marked = 0
        let unmarked = 0

        for (let i = 0; i < matchedIds.length; i += DB_BATCH) {
          const batch = matchedIds.slice(i, i + DB_BATCH)
          const ph = batch.map(() => '?').join(', ')
          const r = await this.env.DB
            .prepare(`UPDATE projects SET is_verified = 1, verified_at = CURRENT_TIMESTAMP WHERE program_id IN (${ph}) AND is_verified = 0`)
            .bind(...batch).run()
          marked += r?.meta?.changes ?? 0
        }

        for (let i = 0; i < toUnmark.length; i += DB_BATCH) {
          const batch = toUnmark.slice(i, i + DB_BATCH)
          const ph = batch.map(() => '?').join(', ')
          const r = await this.env.DB
            .prepare(`UPDATE projects SET is_verified = 0, verified_at = NULL WHERE program_id IN (${ph})`)
            .bind(...batch).run()
          unmarked += r?.meta?.changes ?? 0
        }

        console.log(`${TAG} [3] ✓ ${marked} newly marked verified, ${unmarked} unmarked`)
        return { marked, unmarked }
      },
    )

    // ── Step 4: trigger AI analysis for matched/verified programs ──────────
    await step.do(
      'step 4: trigger ai analysis',
      { timeout: '30 seconds', retries: { limit: 2, delay: 5000, backoff: 'exponential' } },
      async () => {
        try {
          const instance = await this.env.VERIFIED_ANALYSIS_WORKFLOW.create({ params: { trigger: 'admin' } })
          await recordWorkflowInstance(this.env.DB, {
            instanceId: instance.id,
            workflow: 'verified-analysis',
            trigger: 'continuation',
          })
          console.log(`${TAG} [4] ✓ VerifiedAnalysisWorkflow started`)
        } catch (err) {
          console.error(`${TAG} [4] Failed to trigger VerifiedAnalysisWorkflow:`, String(err))
        }
      },
    )

    const finalResult = { total, matched: matchedIds.length, missing: missingIds.length, marked, unmarked }
    console.log(`${TAG} complete`, finalResult)
    await sendWorkflowReport(this.env, { workflow: 'verified-match', trigger, instanceId: event.instanceId, startedAt, ok: true, result: finalResult })
    return finalResult

    } catch (err) {
      await sendWorkflowReport(this.env, {
        workflow: 'verified-match',
        trigger,
        instanceId: event.instanceId,
        startedAt,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }
}
