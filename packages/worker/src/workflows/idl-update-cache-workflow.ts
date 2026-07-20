import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { runProjectAnalysisPipeline } from '../services/project-analysis-pipeline'

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

    const result = await runProjectAnalysisPipeline(this.env, step, { projectId, force, writeIdlSummary: true })

    const finalResult = { projectId: result.projectId, analysisId: result.analysisId, steps: 6 }
    console.log(`${TAG} workflow complete`, finalResult)
    return finalResult
  }
}
