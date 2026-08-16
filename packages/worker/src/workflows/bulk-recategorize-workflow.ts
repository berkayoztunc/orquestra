import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { identifyProgram, extractInstructionNames, extractAccountNames } from '../services/ai-categorization'
import { setCategoryAndAliases } from '../services/search'

const TAG = '[bulk-recategorize-workflow]'
const QUERY_LIMIT = 500
const BATCH_SIZE = 25

type Env = {
  DB: any
  AI: any
  HELIUS_API_KEY?: string
}

type Params = { trigger?: 'manual' | 'admin' }

type UncategorizedRow = {
  id: string; name: string; program_id: string; idl_json: string
}

export class BulkRecategorizeWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const trigger = event.payload?.trigger ?? 'manual'
    console.log(`${TAG} started (trigger=${trigger})`)

    // ── Step 1: query uncategorized projects ──────────────────────────────────
    const projects = await step.do(
      'query uncategorized projects',
      { timeout: '30 seconds', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        const { results } = await this.env.DB
          .prepare(`
            SELECT p.id, p.name, p.program_id, v.idl_json
            FROM projects p
            JOIN idl_versions v ON v.project_id = p.id
            LEFT JOIN program_categories pc ON pc.project_id = p.id
            WHERE pc.id IS NULL
              AND p.is_public = 1
            GROUP BY p.id
            ORDER BY p.created_at DESC
            LIMIT ?
          `)
          .bind(QUERY_LIMIT)
          .all()

        console.log(`${TAG} found ${results?.length ?? 0} uncategorized projects`)
        return (results ?? []) as UncategorizedRow[]
      },
    )

    if (!projects.length) {
      console.log(`${TAG} nothing to categorize, done`)
      return { categorized: 0, errors: 0, total: 0 }
    }

    // ── Steps 2..N: categorize in batches of 25 ───────────────────────────────
    const totalBatches = Math.ceil(projects.length / BATCH_SIZE)
    let categorized = 0, errors = 0

    for (let i = 0; i < totalBatches; i++) {
      const batch = projects.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)

      const result = await step.do(
        `categorize batch ${i + 1} of ${totalBatches}`,
        { timeout: '2 minutes', retries: { limit: 1, delay: 10000, backoff: 'exponential' } },
        async () => {
          let batchOk = 0, batchErr = 0

          for (const p of batch) {
            try {
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
              console.error(`${TAG} failed to categorize ${p.id}:`, err)
              batchErr++
            }
          }

          console.log(`${TAG} batch ${i + 1}/${totalBatches}: ok=${batchOk} err=${batchErr}`)
          return { ok: batchOk, err: batchErr }
        },
      )

      categorized += result.ok
      errors += result.err
    }

    const final = { categorized, errors, total: projects.length }
    console.log(`${TAG} workflow complete`, final)
    return final
  }
}
