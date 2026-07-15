import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { generateDocumentation } from '../services/doc-generator'
import { generateAndStoreAIAnalysis } from '../services/ai-analysis'
import { categorizeProgramWithAI, extractInstructionNames, extractAccountNames } from '../services/ai-categorization'
import { setCategoryAndAliases } from '../services/search'
import { writeIdlSummaryCache } from '../services/idl-summary'
import { generateId } from '../utils/id'

const TAG = '[verified-analysis-workflow]'

type Env = {
  DB: any
  AI: any
  CACHE: any
  IDLS: any
  API_BASE_URL: string
}

type Params = {
  trigger?: 'manual' | 'admin' | 'cron'
  force?: boolean
}

type ProjectRow = {
  id: string
  name: string
  program_id: string
  version_id: string
  idl_json: string
  cpi_md: string | null
  version: number
}

export class VerifiedAnalysisWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const trigger = event.payload?.trigger ?? 'manual'
    const force = event.payload?.force ?? false
    console.log(`${TAG} started (trigger=${trigger} force=${force})`)

    // ── Step 1: query verified programs that have IDLs ────────────────────────
    // force=false → only programs missing AI analysis (new programs)
    // force=true  → ALL verified+IDL programs (full refresh)
    const projects = await step.do(
      'query eligible projects',
      { timeout: '30 seconds', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        const { results } = await this.env.DB
          .prepare(
            force
              ? `
                SELECT p.id, p.name, p.program_id,
                       v.id AS version_id, v.idl_json, v.cpi_md, v.version
                FROM projects p
                JOIN idl_versions v ON v.project_id = p.id
                WHERE p.is_verified = 1 AND p.is_public = 1
                GROUP BY p.id
                ORDER BY p.name ASC
              `
              : `
                SELECT p.id, p.name, p.program_id,
                       v.id AS version_id, v.idl_json, v.cpi_md, v.version
                FROM projects p
                JOIN idl_versions v ON v.project_id = p.id
                LEFT JOIN ai_analyses aa ON aa.project_id = p.id
                WHERE p.is_verified = 1 AND p.is_public = 1 AND aa.id IS NULL
                GROUP BY p.id
                ORDER BY p.name ASC
              `,
          )
          .all()

        const list = (results ?? []) as ProjectRow[]
        console.log(`${TAG} found ${list.length} programs to process (force=${force})`)
        return list
      },
    )

    if (projects.length === 0) {
      console.log(`${TAG} nothing to process`)
      return { processed: 0, errors: 0, total: 0 }
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

          const idl = JSON.parse(p.idl_json)

          // 1. Update IDL summary in IDLS KV
          await writeIdlSummaryCache({
            kv: this.env.IDLS,
            projectId: p.id,
            programId: p.program_id,
            version: p.version,
            idl,
          })

          // 2. Generate docs
          const docs = generateDocumentation(idl, p.program_id, this.env.API_BASE_URL, p.id, p.cpi_md)
          const docsText = docs.full ?? ''

          // 3. Delete existing analysis when force=true (INSERT not UPSERT)
          if (force) {
            await this.env.DB
              .prepare(`DELETE FROM ai_analyses WHERE project_id = ?`)
              .bind(p.id)
              .run()
          }

          // 4. Run AI analysis
          await generateAndStoreAIAnalysis({
            db: this.env.DB,
            ai: this.env.AI,
            id: generateId(),
            projectId: p.id,
            idlVersionId: p.version_id,
            idl,
            docsText,
            programId: p.program_id,
            projectName: p.name,
          })

          // 5. Categorize
          const instructions = extractInstructionNames(idl)
          const accounts = extractAccountNames(idl)
          const cat = await categorizeProgramWithAI(this.env.AI, {
            name: p.name,
            programId: p.program_id,
            instructions,
            accounts,
          })
          await setCategoryAndAliases(this.env.DB, p.id, cat.category, cat.tags, cat.aliases)

          // 6. Invalidate stale cache entries
          await Promise.allSettled([
            this.env.CACHE.delete(`docs:${p.id}`),
            this.env.CACHE.delete(`project:${p.id}`),
          ])

          console.log(`${TAG} [${i + 1}/${projects.length}] done: ${p.name} → ${cat.category}`)
          return true
        },
      ).catch((err) => {
        console.error(`${TAG} [${i + 1}/${projects.length}] failed: ${p.name}`, err)
        return false
      })

      if (ok) processed++; else errors++
    }

    const result = { processed, errors, total: projects.length }
    console.log(`${TAG} complete`, result)
    return result
  }
}
