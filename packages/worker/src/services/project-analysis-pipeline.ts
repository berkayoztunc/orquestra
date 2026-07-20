import type { WorkflowStep } from 'cloudflare:workers'
import { generateDocumentation } from './doc-generator'
import { generateAndStoreAIAnalysis } from './ai-analysis'
import { categorizeProgramWithAI, extractInstructionNames, extractAccountNames } from './ai-categorization'
import { setCategoryAndAliases } from './search'
import { writeIdlSummaryCache } from './idl-summary'
import { generateId } from '../utils/id'

export interface ProjectAnalysisPipelineEnv {
  DB: any
  AI: any
  CACHE: any
  IDLS?: any
  API_BASE_URL: string
}

export interface PreloadedProject {
  id: string
  name: string
  program_id: string
  version_id: string
  idl_json: string
  cpi_md: string | null
  version?: number
}

export interface ProjectAnalysisPipelineParams {
  projectId: string
  force?: boolean
  /** Also refresh the IDL summary in the IDLS KV namespace. */
  writeIdlSummary?: boolean
  /**
   * Skips the internal "fetch project data" query/step — pass the row when
   * the caller already fetched it (e.g. to stay under the 1MiB Workflow
   * step-output cap on a bulk query). Required when `step` is omitted.
   */
  preloadedProject?: PreloadedProject
  /**
   * Called on AI-analysis/categorize failure. Return true to swallow the
   * error and resolve with `skipped: true` instead of rethrowing (used to
   * soft-skip non-retryable AI errors during bulk runs).
   */
  onNonRetryableAiError?: (err: unknown) => boolean
}

export interface ProjectAnalysisPipelineResult {
  projectId: string
  analysisId: string
  shortDescription?: string
  generatedAt?: string
  category: string
  tags: string[]
  skipped?: boolean
}

interface StepOpts {
  timeout: string
  retries: { limit: number; delay: number; backoff: 'constant' | 'exponential' }
}

const CATEGORIZE_STEP_OPTS: StepOpts = { timeout: '30 seconds', retries: { limit: 2, delay: 5000, backoff: 'exponential' } }

/**
 * Runs `step.do` when `step` is provided (durable, retriable stages — used
 * by single-project workflows called directly from `run()`), or just
 * executes inline when `step` is omitted (used when the caller is already
 * inside its own outer `step.do`, e.g. a bulk per-project loop — Workflow
 * steps cannot nest, and the outer step already provides the durability).
 */
function runStage<T>(
  step: WorkflowStep | undefined,
  name: string,
  opts: StepOpts,
  fn: () => Promise<T>,
): Promise<T> {
  return step ? (step.do as any)(name, opts, fn) : fn()
}

/**
 * Fetch project + latest IDL version → optionally refresh IDL summary KV →
 * generate docs → run AI analysis → categorize → invalidate cache.
 * Shared by AiAnalysisWorkflow, IdlUpdateCacheWorkflow, and
 * VerifiedAnalysisWorkflow's per-project bulk loop.
 */
export async function runProjectAnalysisPipeline(
  env: ProjectAnalysisPipelineEnv,
  step: WorkflowStep | undefined,
  params: ProjectAnalysisPipelineParams,
): Promise<ProjectAnalysisPipelineResult> {
  const { projectId, force = false, writeIdlSummary = false, preloadedProject, onNonRetryableAiError } = params

  const project = preloadedProject ?? await runStage(
    step,
    'fetch project data',
    { timeout: '15 seconds', retries: { limit: 3, delay: 3000, backoff: 'exponential' } },
    async () => {
      const row = await env.DB
        .prepare(`
          SELECT p.id, p.name, p.program_id,
                 v.id AS version_id, v.idl_json, v.cpi_md, v.version
          FROM projects p
          JOIN idl_versions v ON v.project_id = p.id
          WHERE p.id = ? OR p.program_id = ?
          ORDER BY v.version DESC
          LIMIT 1
        `)
        .bind(projectId, projectId)
        .first()

      if (!row) throw new Error(`Project not found: ${projectId} (tried project ID and program ID)`)
      return row as PreloadedProject
    },
  )

  const idl = JSON.parse(project.idl_json)

  if (writeIdlSummary && env.IDLS) {
    await runStage(
      step,
      'update idl summary cache',
      { timeout: '30 seconds', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        await writeIdlSummaryCache({
          kv: env.IDLS,
          projectId: project.id,
          programId: project.program_id,
          version: project.version ?? null,
          idl,
        })
      },
    )
  }

  const docsText = await runStage(
    step,
    'generate documentation',
    { timeout: '30 seconds', retries: { limit: 2, delay: 5000, backoff: 'exponential' } },
    async () => {
      const docs = generateDocumentation(idl, project.program_id, env.API_BASE_URL, project.id, project.cpi_md)
      const text = docs.full ?? ''
      await env.CACHE.put(`docs:${project.id}`, text, { expirationTtl: 604800 })
      return text
    },
  )

  let analysisId = ''
  let shortDescription: string | undefined
  let generatedAt: string | undefined
  let category = 'skipped'
  let tags: string[] = []

  try {
    const analysis = await runStage(
      step,
      'run ai analysis',
      { timeout: '3 minutes', retries: { limit: 2, delay: 15000, backoff: 'exponential' } },
      async () => {
        if (force) {
          await env.DB.prepare(`DELETE FROM ai_analyses WHERE project_id = ?`).bind(project.id).run()
        }
        const id = generateId()
        const result = await generateAndStoreAIAnalysis({
          db: env.DB,
          ai: env.AI,
          id,
          projectId: project.id,
          idlVersionId: project.version_id,
          idl,
          docsText,
          programId: project.program_id,
          projectName: project.name,
        })
        return { analysisId: result.id, shortDescription: result.shortDescription, generatedAt: result.generatedAt }
      },
    )
    analysisId = analysis.analysisId
    shortDescription = analysis.shortDescription
    generatedAt = analysis.generatedAt

    const cat = await runStage(step, 'categorize program', CATEGORIZE_STEP_OPTS, async () => {
      const instructions = extractInstructionNames(idl)
      const accounts = extractAccountNames(idl)
      const result = await categorizeProgramWithAI(env.AI, {
        name: project.name,
        programId: project.program_id,
        instructions,
        accounts,
      })
      await setCategoryAndAliases(env.DB, project.id, result.category, result.tags, result.aliases)
      return result
    })
    category = cat.category
    tags = cat.tags
  } catch (err) {
    if (onNonRetryableAiError?.(err)) {
      return { projectId: project.id, analysisId: '', category: 'skipped', tags: [], skipped: true }
    }
    throw err
  }

  await runStage(
    step,
    'invalidate cache',
    { timeout: '15 seconds', retries: { limit: 3, delay: 3000, backoff: 'exponential' } },
    async () => {
      await Promise.allSettled([
        env.CACHE.delete(`docs:${project.id}`),
        env.CACHE.delete(`project:${project.id}`),
      ])
    },
  )

  return { projectId: project.id, analysisId, shortDescription, generatedAt, category, tags }
}
