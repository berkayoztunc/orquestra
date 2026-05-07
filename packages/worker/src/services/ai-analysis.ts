import { parseIDL } from './idl-parser'

export const DEFAULT_AI_ANALYSIS_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

export interface AIAnalysisResult {
  id: string
  projectId: string
  idlVersionId: string
  shortDescription: string
  detailedAnalysis: AIDetailedAnalysis
  modelUsed: string
  generatedAt: string
  createdAt: string
}

export interface AIDetailedAnalysis {
  summary: string
  tags: string[]
  instructionCount: number
  accountCount: number
  errorCount: number
  eventCount: number
  capabilities: string[]
  keyInstructions: Array<{ name: string; purpose: string }>
  accountsOverview: string[]
  risks: string[]
  integrationNotes: string[]
}

interface GenerateAIAnalysisInput {
  db: any
  ai: Ai
  id: string
  projectId: string
  idlVersionId: string
  idl: Record<string, any>
  docsText: string
  programId: string
  projectName: string
  model?: string | null
  now?: string
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n...[truncated]`
}

function normalizeStringArray(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max)
}

function normalizeKeyInstructions(value: unknown): Array<{ name: string; purpose: string }> {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const name = typeof row.name === 'string' ? row.name.trim() : ''
      const purpose = typeof row.purpose === 'string' ? row.purpose.trim() : ''
      if (!name || !purpose) return null
      return { name, purpose }
    })
    .filter((item): item is { name: string; purpose: string } => item !== null)
    .slice(0, 8)
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      // Fall through to extraction below.
    }
  }

  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

function getInstructionNames(idl: Record<string, any>): string[] {
  const instructions = Array.isArray(idl.instructions)
    ? idl.instructions
    : Array.isArray(idl.program?.instructions)
      ? idl.program.instructions
      : []
  return instructions
    .map((ix: any) => (typeof ix?.name === 'string' ? ix.name : null))
    .filter((name: string | null): name is string => Boolean(name))
    .slice(0, 40)
}

function fallbackDetailedAnalysis(
  idl: Record<string, any>,
  projectName: string,
  shortDescription: string,
): AIDetailedAnalysis {
  const parsed = parseIDL(idl)
  return {
    summary: shortDescription || `${projectName} is a Solana program generated from its IDL.`,
    tags: [],
    instructionCount: parsed.instructionCount,
    accountCount: parsed.accountCount,
    errorCount: parsed.errorCount,
    eventCount: parsed.eventCount,
    capabilities: [],
    keyInstructions: getInstructionNames(idl).slice(0, 5).map((name) => ({
      name,
      purpose: 'Defined by the uploaded IDL.',
    })),
    accountsOverview: [],
    risks: [],
    integrationNotes: [],
  }
}

function normalizeDetailedAnalysis(
  parsedJson: Record<string, unknown> | null,
  idl: Record<string, any>,
  projectName: string,
  fallbackSummary: string,
): AIDetailedAnalysis {
  const fallback = fallbackDetailedAnalysis(idl, projectName, fallbackSummary)
  if (!parsedJson) return fallback

  return {
    summary: typeof parsedJson.summary === 'string' && parsedJson.summary.trim()
      ? parsedJson.summary.trim()
      : fallback.summary,
    tags: normalizeStringArray(parsedJson.tags, 10),
    instructionCount: typeof parsedJson.instructionCount === 'number' ? parsedJson.instructionCount : fallback.instructionCount,
    accountCount: typeof parsedJson.accountCount === 'number' ? parsedJson.accountCount : fallback.accountCount,
    errorCount: typeof parsedJson.errorCount === 'number' ? parsedJson.errorCount : fallback.errorCount,
    eventCount: typeof parsedJson.eventCount === 'number' ? parsedJson.eventCount : fallback.eventCount,
    capabilities: normalizeStringArray(parsedJson.capabilities),
    keyInstructions: normalizeKeyInstructions(parsedJson.keyInstructions),
    accountsOverview: normalizeStringArray(parsedJson.accountsOverview),
    risks: normalizeStringArray(parsedJson.risks),
    integrationNotes: normalizeStringArray(parsedJson.integrationNotes),
  }
}

function buildPrompt(input: GenerateAIAnalysisInput): { system: string; user: string } {
  const parsed = parseIDL(input.idl)
  const instructionNames = getInstructionNames(input.idl)
  const idlSummary = {
    programName: parsed.programName,
    programId: input.programId,
    idlVersion: parsed.version,
    instructionCount: parsed.instructionCount,
    accountCount: parsed.accountCount,
    errorCount: parsed.errorCount,
    eventCount: parsed.eventCount,
    instructions: instructionNames,
  }

  const system = `You are an expert Solana smart contract analyst. Analyze uploaded Anchor or Codama IDLs for developer documentation.

Return only a JSON object with this exact shape:
{
  "shortDescription": "single sentence, max 180 characters",
  "summary": "clear technical summary",
  "tags": ["lowercase-tag"],
  "instructionCount": 0,
  "accountCount": 0,
  "errorCount": 0,
  "eventCount": 0,
  "capabilities": ["what users can do with this program"],
  "keyInstructions": [{"name":"instructionName","purpose":"what it likely does"}],
  "accountsOverview": ["important account/storage concepts"],
  "risks": ["security or integration risks visible from the IDL"],
  "integrationNotes": ["practical notes for API/agent users"]
}

Do not invent external facts. If purpose is ambiguous, say what can be inferred from names and structure.`

  const user = `Project: ${input.projectName}
IDL summary:
${JSON.stringify(idlSummary, null, 2)}

Generated llms.txt:
${truncate(input.docsText, 14_000)}

Raw IDL excerpt:
${truncate(JSON.stringify(input.idl), 8_000)}`

  return { system, user }
}

export async function generateAndStoreAIAnalysis(input: GenerateAIAnalysisInput): Promise<AIAnalysisResult> {
  const model = input.model || DEFAULT_AI_ANALYSIS_MODEL
  const now = input.now || new Date().toISOString()
  const prompt = buildPrompt(input)

  let raw = ''
  try {
    const response = await (input.ai as any).run(model, {
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1600,
      temperature: 0.2,
    })
    raw = (response as { response?: string })?.response || ''
  } catch (err) {
    console.error('[ai-analysis] Workers AI call failed:', err)
  }

  const parsedJson = extractJsonObject(raw)
  const shortDescription = typeof parsedJson?.shortDescription === 'string' && parsedJson.shortDescription.trim()
    ? parsedJson.shortDescription.trim().slice(0, 220)
    : `${input.projectName} is a Solana program generated from its IDL.`.slice(0, 220)
  const detailedAnalysis = normalizeDetailedAnalysis(parsedJson, input.idl, input.projectName, shortDescription)

  await input.db
    .prepare(
      'INSERT INTO ai_analyses (id, project_id, idl_version_id, short_description, detailed_analysis_json, model_used, generated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      input.id,
      input.projectId,
      input.idlVersionId,
      shortDescription,
      JSON.stringify(detailedAnalysis),
      model,
      now,
      now,
    )
    .run()

  return {
    id: input.id,
    projectId: input.projectId,
    idlVersionId: input.idlVersionId,
    shortDescription,
    detailedAnalysis,
    modelUsed: model,
    generatedAt: now,
    createdAt: now,
  }
}
