import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { runProjectAnalysisPipeline } from '../services/project-analysis-pipeline'

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

    const result = await runProjectAnalysisPipeline(this.env, step, { projectId, force, writeIdlSummary: false })

    const finalResult = {
      projectId: result.projectId,
      analysisId: result.analysisId,
      shortDescription: result.shortDescription,
      generatedAt: result.generatedAt,
      steps: 5,
    }
    console.log(`${TAG} workflow complete`, finalResult)
    return finalResult
  }
}
