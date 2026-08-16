import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { runProjectAnalysisPipeline } from '../services/project-analysis-pipeline'
import { recordWorkflowInstance } from '../services/workflow-registry'
import { hibernateEvery } from '../utils/workflow-helpers'
import { sendWorkflowReport } from '../services/telegram'

const TAG = '[verified-analysis-workflow]'

/**
 * Projects per instance. Keeps the step count (and step-1 output size) well
 * under Workflow limits; remaining work continues in a fresh instance.
 */
const CHUNK_SIZE = 200

/** Max self-continuation rounds (50 × 200 = 10k projects per full refresh). */
const MAX_ROUNDS = 50

type Env = {
  DB: any
  AI: any
  CACHE: any
  IDLS: any
  API_BASE_URL: string
  VERIFIED_ANALYSIS_WORKFLOW: any
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
}

type Params = {
  trigger?: 'manual' | 'admin' | 'cron' | 'continuation'
  force?: boolean
  /** Continuation round (0 = first instance) */
  round?: number
}

/** AI failures that will never succeed on retry (bad input, not rate limits). */
function isNonRetryableAiError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  if (/\b429\b|rate.?limit/i.test(msg)) return false
  return /\b4\d\d\b|invalid|too large|context length|bad request/i.test(msg)
}

type ProjectRow = {
  id: string
  name: string
  program_id: string
  version_id: string
  version: number
}

export class VerifiedAnalysisWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const trigger = event.payload?.trigger ?? 'manual'
    const force = event.payload?.force ?? false
    const round = event.payload?.round ?? 0
    const startedAt = Date.now()
    console.log(`${TAG} started (trigger=${trigger} force=${force} round=${round})`)

    try {

    // ── Step 1: query verified programs that have IDLs ────────────────────────
    // force=false → only programs missing AI analysis (new programs)
    // force=true  → ALL verified+IDL programs (full refresh)
    const projects = await step.do(
      'query eligible projects',
      { timeout: '30 seconds', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        // NOTE: only lightweight columns here — idl_json/cpi_md can be large and
        // Cloudflare Workflow step outputs are capped at 1MiB. Fetching the full
        // IDL for every eligible project in this single step blows past that cap
        // once the queue grows past a couple dozen programs, so each project's
        // IDL/cpi_md is fetched individually inside its own step below instead.
        // Chunked to CHUNK_SIZE per instance — remaining work self-continues.
        // force=false: the eligible set shrinks as analyses are inserted, so
        //   each round re-selects from the top (no OFFSET).
        // force=true: rows stay eligible all refresh long, so pages advance
        //   by round using OFFSET.
        const { results } = await this.env.DB
          .prepare(
            force
              ? `
                SELECT p.id, p.name, p.program_id,
                       v.id AS version_id, v.version
                FROM projects p
                JOIN idl_versions v ON v.project_id = p.id
                WHERE p.is_verified = 1 AND p.is_public = 1
                GROUP BY p.id
                ORDER BY p.name ASC
                LIMIT ? OFFSET ?
              `
              : `
                SELECT p.id, p.name, p.program_id,
                       v.id AS version_id, v.version
                FROM projects p
                JOIN idl_versions v ON v.project_id = p.id
                LEFT JOIN ai_analyses aa ON aa.project_id = p.id
                WHERE p.is_verified = 1 AND p.is_public = 1 AND aa.id IS NULL
                GROUP BY p.id
                ORDER BY p.name ASC
                LIMIT ?
              `,
          )
          .bind(...(force ? [CHUNK_SIZE, round * CHUNK_SIZE] : [CHUNK_SIZE]))
          .all()

        const list = (results ?? []) as ProjectRow[]
        console.log(`${TAG} round ${round}: ${list.length} programs to process (force=${force})`)
        return list
      },
    )

    if (projects.length === 0) {
      console.log(`${TAG} nothing to process`)
      const result = { processed: 0, errors: 0, total: 0 }
      await sendWorkflowReport(this.env, { workflow: 'verified-analysis', trigger, instanceId: event.instanceId, startedAt, ok: true, result })
      return result
    }

    // ── Steps 2..N: full pipeline per project ─────────────────────────────────
    let processed = 0
    let errors = 0

    for (let i = 0; i < projects.length; i++) {
      const p = projects[i]

      const ok = await step.do(
        `process ${p.name} (${i + 1}/${projects.length})`,
        { timeout: '3 minutes', retries: { limit: 2, delay: 15000, backoff: 'exponential' } },
        async () => {
          console.log(`${TAG} [${i + 1}/${projects.length}] ${p.name} (${p.program_id})`)

          // Fetch idl_json/cpi_md here (not in step 1) — keeps step 1's output
          // small enough to stay under the 1MiB Workflow step-output cap.
          const versionRow = await this.env.DB
            .prepare(`SELECT idl_json, cpi_md FROM idl_versions WHERE id = ?`)
            .bind(p.version_id)
            .first() as { idl_json: string; cpi_md: string | null } | null
          if (!versionRow) {
            console.error(`${TAG} [${i + 1}/${projects.length}] ${p.name} — idl_versions row missing`)
            return false
          }

          // step=undefined: this per-project pipeline runs inline inside this
          // outer step.do rather than as its own nested steps (Workflow steps
          // can't nest — this outer step already provides the durability).
          const result = await runProjectAnalysisPipeline(this.env, undefined, {
            projectId: p.id,
            force,
            writeIdlSummary: true,
            preloadedProject: {
              id: p.id,
              name: p.name,
              program_id: p.program_id,
              version_id: p.version_id,
              idl_json: versionRow.idl_json,
              cpi_md: versionRow.cpi_md,
              version: p.version,
            },
            onNonRetryableAiError: (err) => {
              if (!isNonRetryableAiError(err)) return false
              console.error(`${TAG} [${i + 1}/${projects.length}] non-retryable AI error for ${p.name} — skipping:`, String(err))
              return true
            },
          })

          if (result.skipped) return false

          console.log(`${TAG} [${i + 1}/${projects.length}] done: ${p.name} → ${result.category}`)
          return true
        },
      ).catch((err) => {
        console.error(`${TAG} [${i + 1}/${projects.length}] failed: ${p.name}`, err)
        return false
      })

      if (ok) processed++; else errors++

      // Periodic hibernation — consecutive fast steps can share one Worker
      // invocation's 1000-subrequest budget; sleeping resets it.
      await hibernateEvery(step, i + 1, 20, `project ${i + 1}`)
    }

    // Self-continue while a full chunk was returned (more rows likely remain).
    // force=false with zero progress must NOT continue — the same failing
    // projects would be re-selected forever.
    const mayHaveMore = projects.length === CHUNK_SIZE
    const madeProgress = force || processed > 0
    const willContinue = mayHaveMore && madeProgress && round < MAX_ROUNDS
    if (willContinue) {
      await step.do(
        'spawn continuation',
        { timeout: '30 seconds', retries: { limit: 2, delay: 5000, backoff: 'exponential' } },
        async () => {
          const instance = await this.env.VERIFIED_ANALYSIS_WORKFLOW.create({
            params: { trigger: 'continuation', force, round: round + 1 },
          })
          await recordWorkflowInstance(this.env.DB, {
            instanceId: instance.id,
            workflow: 'verified-analysis',
            trigger: 'continuation',
          })
          console.log(`${TAG} continuation spawned (round ${round + 1}, instance ${instance.id})`)
        },
      )
    }

    const result = { processed, errors, total: projects.length, round }
    console.log(`${TAG} complete`, result)
    // Only the final instance of a logical run reports.
    if (!willContinue) {
      await sendWorkflowReport(this.env, { workflow: 'verified-analysis', trigger, instanceId: event.instanceId, startedAt, ok: true, result })
    }
    return result

    } catch (err) {
      await sendWorkflowReport(this.env, {
        workflow: 'verified-analysis',
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
