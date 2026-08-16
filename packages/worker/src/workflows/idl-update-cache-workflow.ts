import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { runProjectAnalysisPipeline } from '../services/project-analysis-pipeline'
import { sendWorkflowReport } from '../services/telegram'

const TAG = '[idl-update-cache-workflow]'

type Env = {
  DB: any
  IDLS: any
  CACHE: any
  AI: any
  API_BASE_URL: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
}

type Params = {
  projectId: string
  force?: boolean
}

export class IdlUpdateCacheWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const { projectId, force = false } = event.payload
    const startedAt = Date.now()
    console.log(`${TAG} started (projectId=${projectId} force=${force})`)

    try {

    const result = await runProjectAnalysisPipeline(this.env, step, { projectId, force, writeIdlSummary: true })

    const finalResult = { projectId: result.projectId, analysisId: result.analysisId, steps: 6 }
    console.log(`${TAG} workflow complete`, finalResult)
    await sendWorkflowReport(this.env, { workflow: 'idl-update-cache', trigger: 'manual', instanceId: event.instanceId, startedAt, ok: true, result: finalResult })
    return finalResult

    } catch (err) {
      await sendWorkflowReport(this.env, {
        workflow: 'idl-update-cache',
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
