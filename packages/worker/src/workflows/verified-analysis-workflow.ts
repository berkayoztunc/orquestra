import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { generateDocumentation } from '../services/doc-generator'
import { generateAndStoreAIAnalysis } from '../services/ai-analysis'
import { categorizeProgramWithAI, extractInstructionNames, extractAccountNames } from '../services/ai-categorization'
import { setCategoryAndAliases } from '../services/search'
import { generateId } from '../utils/id'

const TAG = '[verified-analysis-workflow]'

type Env = {
  DB: any
  AI: any
  CACHE: any
  API_BASE_URL: string
}

type Params = { trigger?: 'manual' | 'admin' }

type ProjectRow = {
  id: string
  name: string
  program_id: string
  version_id: string
  idl_json: string
  cpi_md: string | null
}

export class VerifiedAnalysisWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const trigger = event.payload?.trigger ?? 'manual'
    console.log(`${TAG} started (trigger=${trigger})`)

    // ── Step 1: query eligible projects ──────────────────────────────────────
    // Verified build + has IDL + no existing AI analysis
    const projects = await step.do(
      'query eligible projects',
      { timeout: '30 seconds', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        const { results } = await this.env.DB
          .prepare(`
            SELECT p.id, p.name, p.program_id,
                   v.id AS version_id, v.idl_json, v.cpi_md
            FROM projects p
            JOIN idl_versions v ON v.project_id = p.id
            LEFT JOIN ai_analyses aa ON aa.project_id = p.id
            WHERE p.is_verified = 1
              AND p.is_public = 1
              AND aa.id IS NULL
            GROUP BY p.id
            ORDER BY p.name ASC
          `)
          .all()

        const list = (results ?? []) as ProjectRow[]
        console.log(`${TAG} found ${list.length} verified programs needing AI analysis`)
        return list
      },
    )

    if (projects.length === 0) {
      console.log(`${TAG} nothing to process`)
      return { processed: 0, errors: 0, total: 0 }
    }

    // ── Steps 2..N: one step per project — full analysis pipeline ────────────
    let processed = 0
    let errors = 0

    for (let i = 0; i < projects.length; i++) {
      const p = projects[i]

      const ok = await step.do(
        `analyze ${p.name} (${i + 1}/${projects.length})`,
        { timeout: '3 minutes', retries: { limit: 2, delay: 15000, backoff: 'exponential' } },
        async () => {
          console.log(`${TAG} [${i + 1}/${projects.length}] starting: ${p.name} (${p.program_id})`)

          const idl = JSON.parse(p.idl_json)

          // Generate docs
          const docs = generateDocumentation(idl, p.program_id, this.env.API_BASE_URL, p.id, p.cpi_md)
          const docsText = docs.full ?? ''

          // Cache docs
          await this.env.CACHE.put(`docs:${p.id}`, docsText, { expirationTtl: 604800 })

          // Run AI analysis
          const analysisId = generateId()
          await generateAndStoreAIAnalysis({
            db: this.env.DB,
            ai: this.env.AI,
            id: analysisId,
            projectId: p.id,
            idlVersionId: p.version_id,
            idl,
            docsText,
            programId: p.program_id,
            projectName: p.name,
          })

          // Categorize
          const instructions = extractInstructionNames(idl)
          const accounts = extractAccountNames(idl)
          const cat = await categorizeProgramWithAI(this.env.AI, {
            name: p.name,
            programId: p.program_id,
            instructions,
            accounts,
          })
          await setCategoryAndAliases(this.env.DB, p.id, cat.category, cat.tags, cat.aliases)

          // Invalidate stale cache
          await this.env.CACHE.delete(`docs:${p.id}`)

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
