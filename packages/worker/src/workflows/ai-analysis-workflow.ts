import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { generateAndStoreAIAnalysis } from '../services/ai-analysis'
import { generateDocumentation } from '../services/doc-generator'
import { categorizeProgramWithAI, extractInstructionNames, extractAccountNames } from '../services/ai-categorization'
import { setCategoryAndAliases } from '../services/search'
import { generateId } from '../utils/id'

const TAG = '[ai-analysis-workflow]'

type Env = {
  DB: any
  AI: Ai
  CACHE: any
  API_BASE_URL: string
}

type Params = {
  projectId: string
  force?: boolean
}

export class AiAnalysisWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const { projectId, force = true } = event.payload
    console.log(`${TAG} started for project ${projectId} (force=${force})`)

    // ── Step 1: fetch project + latest IDL version ────────────────────────────
    const project = await step.do(
      'fetch project data',
      { timeout: '15 seconds', retries: { limit: 2, delay: 3000, backoff: 'exponential' } },
      async () => {
        console.log(`${TAG} fetching project data for ${projectId}`)
        const row = await this.env.DB
          .prepare(`
            SELECT p.id, p.name, p.program_id,
                   v.id AS version_id, v.idl_json, v.cpi_md
            FROM projects p
            JOIN idl_versions v ON v.project_id = p.id
            WHERE p.id = ? OR p.program_id = ?
            ORDER BY v.version DESC
            LIMIT 1
          `)
          .bind(projectId, projectId)
          .first()

        if (!row) throw new Error(`Project not found: ${projectId} (tried project ID and program ID)`)

        console.log(`${TAG} found project "${(row as any).name}" (${(row as any).program_id})`)
        return {
          projectId: (row as any).id as string,
          projectName: (row as any).name as string,
          programId: (row as any).program_id as string,
          idlVersionId: (row as any).version_id as string,
          idlJson: (row as any).idl_json as string,
          cpiMd: (row as any).cpi_md as string | null,
        }
      },
    )

    // ── Step 2: generate documentation ───────────────────────────────────────
    const docsText = await step.do(
      'generate documentation',
      { timeout: '30 seconds', retries: { limit: 2, delay: 5000, backoff: 'exponential' } },
      async () => {
        console.log(`${TAG} generating docs for ${project.projectName}`)
        const idl = JSON.parse(project.idlJson)
        const docs = generateDocumentation(idl, project.programId, this.env.API_BASE_URL, project.projectId, project.cpiMd)

        await this.env.CACHE.put(`docs:${project.projectId}`, docs.full, { expirationTtl: 60 * 60 * 24 * 7 })
        console.log(`${TAG} docs generated (${docs.full.length} chars), written to KV`)
        return docs.full
      },
    )

    // ── Step 3: run AI analysis ───────────────────────────────────────────────
    const analysis = await step.do(
      'run ai analysis',
      { timeout: '3 minutes', retries: { limit: 2, delay: 15000, backoff: 'exponential' } },
      async () => {
        if (force) {
          console.log(`${TAG} force=true — deleting existing analysis for ${project.projectId}`)
          await this.env.DB.prepare(`DELETE FROM ai_analyses WHERE project_id = ?`).bind(project.projectId).run()
        }

        const idl = JSON.parse(project.idlJson)
        const analysisId = generateId()
        console.log(`${TAG} calling Workers AI (id=${analysisId})`)

        const result = await generateAndStoreAIAnalysis({
          db: this.env.DB,
          ai: this.env.AI,
          id: analysisId,
          projectId: project.projectId,
          idlVersionId: project.idlVersionId,
          idl,
          docsText,
          programId: project.programId,
          projectName: project.projectName,
        })

        console.log(`${TAG} AI analysis complete — "${result.shortDescription.slice(0, 80)}..."`)
        return { analysisId: result.id, shortDescription: result.shortDescription, generatedAt: result.generatedAt }
      },
    )

    // ── Step 4: categorize program ────────────────────────────────────────────
    await step.do(
      'categorize program',
      { timeout: '30 seconds', retries: { limit: 2, delay: 5000, backoff: 'exponential' } },
      async () => {
        console.log(`${TAG} categorizing program ${project.programId}`)
        const idl = JSON.parse(project.idlJson)
        const instructions = extractInstructionNames(idl)
        const accounts = extractAccountNames(idl)

        const result = await categorizeProgramWithAI(this.env.AI, {
          name: project.projectName,
          programId: project.programId,
          instructions,
          accounts,
        })

        await setCategoryAndAliases(
          this.env.DB,
          project.projectId,
          result.category,
          result.tags,
          result.aliases,
        )

        console.log(`${TAG} categorized as "${result.category}" tags=[${result.tags.join(', ')}]`)
        return { category: result.category, tags: result.tags }
      },
    )

    // ── Step 5: invalidate cache ──────────────────────────────────────────────
    await step.do(
      'invalidate cache',
      { timeout: '10 seconds', retries: { limit: 2, delay: 2000, backoff: 'constant' } },
      async () => {
        await this.env.CACHE.delete(`docs:${project.projectId}`)
        console.log(`${TAG} cache invalidated for docs:${project.projectId}`)
        return { done: true }
      },
    )

    const result = {
      projectId: project.projectId,
      analysisId: analysis.analysisId,
      shortDescription: analysis.shortDescription,
      generatedAt: analysis.generatedAt,
      steps: 5,
    }
    console.log(`${TAG} workflow complete`, result)
    return result
  }
}
