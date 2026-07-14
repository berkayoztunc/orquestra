import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { generateDocumentation } from '../services/doc-generator'
import { generateAndStoreAIAnalysis } from '../services/ai-analysis'
import { categorizeProgramWithAI, extractInstructionNames, extractAccountNames } from '../services/ai-categorization'
import { setCategoryAndAliases } from '../services/search'
import { writeIdlSummaryCache } from '../services/idl-summary'
import { generateId } from '../utils/id'

const TAG = '[idl-update-cache-workflow]'

type Env = {
  DB: any
  IDLS: any
  CACHE: any
  AI: any
  API_BASE_URL: string
}

type Params = {
  projectId: string
  force?: boolean
}

export class IdlUpdateCacheWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const { projectId, force = false } = event.payload
    console.log(`${TAG} started (projectId=${projectId} force=${force})`)

    // ── Step 1: fetch project + latest IDL version ────────────────────────────
    const project = await step.do(
      'fetch project data',
      { timeout: '15 seconds', retries: { limit: 3, delay: 3000, backoff: 'exponential' } },
      async () => {
        const row = await this.env.DB
          .prepare(`
            SELECT p.id, p.name, p.program_id, p.slug,
                   v.id as version_id, v.idl_json, v.cpi_md, v.version
            FROM projects p
            JOIN idl_versions v ON v.project_id = p.id
            WHERE p.id = ?
            ORDER BY v.version DESC LIMIT 1
          `)
          .bind(projectId)
          .first()

        if (!row) throw new Error(`project not found: ${projectId}`)
        console.log(`${TAG} fetched project: ${(row as any).name} (program=${(row as any).program_id})`)
        return row as {
          id: string; name: string; program_id: string; slug: string
          version_id: string; idl_json: string; cpi_md: string | null; version: number
        }
      },
    )

    const idl = JSON.parse(project.idl_json)

    // ── Step 2: update IDL summary in IDLS KV ────────────────────────────────
    await step.do(
      'update idl summary cache',
      { timeout: '30 seconds', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        await writeIdlSummaryCache({
          kv: this.env.IDLS,
          projectId,
          programId: project.program_id,
          version: project.version,
          idl,
        })
        console.log(`${TAG} IDL summary written to KV (version=${project.version})`)
      },
    )

    // ── Step 3: generate documentation ───────────────────────────────────────
    const docsText = await step.do(
      'generate documentation',
      { timeout: '30 seconds', retries: { limit: 2, delay: 5000, backoff: 'exponential' } },
      async () => {
        const docs = generateDocumentation(idl, project.program_id, this.env.API_BASE_URL, project.slug, project.cpi_md)
        const text = docs.full ?? ''
        await this.env.CACHE.put(`docs:${projectId}`, text, { expirationTtl: 604800 })
        console.log(`${TAG} docs generated (${text.length} chars), written to CACHE`)
        return text
      },
    )

    // ── Step 4: run AI analysis ───────────────────────────────────────────────
    const analysisId = await step.do(
      'run ai analysis',
      { timeout: '3 minutes', retries: { limit: 2, delay: 15000, backoff: 'exponential' } },
      async () => {
        if (force) {
          await this.env.DB
            .prepare(`DELETE FROM ai_analyses WHERE project_id = ?`)
            .bind(projectId)
            .run()
          console.log(`${TAG} deleted existing ai_analyses (force=true)`)
        }

        const id = generateId()
        await generateAndStoreAIAnalysis({
          db: this.env.DB,
          ai: this.env.AI,
          id,
          projectId,
          idlVersionId: project.version_id,
          idl,
          docsText,
          programId: project.program_id,
          projectName: project.name,
        })
        console.log(`${TAG} AI analysis stored (id=${id})`)
        return id
      },
    )

    // ── Step 5: categorize program ────────────────────────────────────────────
    await step.do(
      'categorize program',
      { timeout: '30 seconds', retries: { limit: 2, delay: 5000, backoff: 'exponential' } },
      async () => {
        const instructions = extractInstructionNames(idl)
        const accounts = extractAccountNames(idl)
        const cat = await categorizeProgramWithAI(this.env.AI, {
          name: project.name,
          programId: project.program_id,
          instructions,
          accounts,
        })
        await setCategoryAndAliases(this.env.DB, projectId, cat.category, cat.tags, cat.aliases)
        console.log(`${TAG} categorized as '${cat.category}'`)
      },
    )

    // ── Step 6: invalidate stale CACHE keys ───────────────────────────────────
    await step.do(
      'invalidate cache',
      { timeout: '15 seconds', retries: { limit: 3, delay: 3000, backoff: 'exponential' } },
      async () => {
        await Promise.allSettled([
          this.env.CACHE.delete(`docs:${projectId}`),
          this.env.CACHE.delete(`project:${projectId}`),
        ])
        console.log(`${TAG} cache invalidated for projectId=${projectId}`)
      },
    )

    const result = { projectId, analysisId, steps: 6 }
    console.log(`${TAG} workflow complete`, result)
    return result
  }
}
