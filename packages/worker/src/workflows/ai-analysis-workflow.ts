import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { runProjectAnalysisPipeline } from '../services/project-analysis-pipeline'
import { sendWorkflowReport } from '../services/telegram'

const TAG = '[ai-analysis-workflow]'

type Env = {
  DB: any
  AI: Ai
  CACHE: any
  API_BASE_URL: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
}

type Params = {
  projectId: string
  force?: boolean
}

export class AiAnalysisWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const { projectId, force = true } = event.payload
    const startedAt = Date.now()
    console.log(`${TAG} started for project ${projectId} (force=${force})`)

    try {

    const result = await runProjectAnalysisPipeline(this.env, step, { projectId, force, writeIdlSummary: false })

    const finalResult = {
      projectId: result.projectId,
      analysisId: result.analysisId,
      shortDescription: result.shortDescription,
      generatedAt: result.generatedAt,
      steps: 5,
    }
    console.log(`${TAG} workflow complete`, finalResult)
    await sendWorkflowReport(this.env, { workflow: 'ai-analysis', trigger: 'manual', instanceId: event.instanceId, startedAt, ok: true, result: finalResult })
    return finalResult

    } catch (err) {
      await sendWorkflowReport(this.env, {
        workflow: 'ai-analysis',
        trigger: 'manual',
        instanceId: event.instanceId,
        startedAt,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }
}
