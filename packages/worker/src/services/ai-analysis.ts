import { parseIDL, normalizeAccountMeta } from './idl-parser'

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
  instructionFlows?: Array<{ name: string; steps: string[]; description: string }>
  crossProgramAccounts?: Array<{ account: string; program: string; note: string }>
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

function normalizeInstructionFlows(value: unknown): Array<{ name: string; steps: string[]; description: string }> {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const name = typeof row.name === 'string' ? row.name.trim() : ''
      const description = typeof row.description === 'string' ? row.description.trim() : ''
      const steps = Array.isArray(row.steps)
        ? row.steps.filter((s): s is string => typeof s === 'string').map((s) => s.trim()).filter(Boolean)
        : []
      if (!name || !steps.length) return null
      return { name, steps, description }
    })
    .filter((item): item is { name: string; steps: string[]; description: string } => item !== null)
    .slice(0, 6)
}

function normalizeCrossProgramAccounts(value: unknown): Array<{ account: string; program: string; note: string }> {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const account = typeof row.account === 'string' ? row.account.trim() : ''
      const program = typeof row.program === 'string' ? row.program.trim() : ''
      const note = typeof row.note === 'string' ? row.note.trim() : ''
      if (!account || !program) return null
      return { account, program, note }
    })
    .filter((item): item is { account: string; program: string; note: string } => item !== null)
    .slice(0, 10)
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

function extractCrossProgramHints(idl: Record<string, any>): Array<{ instruction: string; account: string; address: string }> {
  const instructions = Array.isArray(idl.instructions)
    ? idl.instructions
    : Array.isArray(idl.program?.instructions)
      ? idl.program.instructions
      : []
  const results: Array<{ instruction: string; account: string; address: string }> = []
  for (const ix of instructions) {
    if (!ix?.name || !Array.isArray(ix.accounts)) continue
    for (const acc of ix.accounts) {
      const norm = normalizeAccountMeta(acc)
      if (norm.address) {
        results.push({ instruction: ix.name, account: norm.name, address: norm.address })
      }
    }
  }
  return results.slice(0, 20)
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
    instructionFlows: [],
    crossProgramAccounts: [],
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
    instructionFlows: normalizeInstructionFlows(parsedJson.instructionFlows),
    crossProgramAccounts: normalizeCrossProgramAccounts(parsedJson.crossProgramAccounts),
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

  const crossProgramHints = extractCrossProgramHints(input.idl)

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
  "integrationNotes": ["practical notes for API/agent users"],
  "instructionFlows": [
    {
      "name": "Flow name describing the user action",
      "steps": ["1. instructionName — what it does", "2. nextInstruction — what it does"],
      "description": "Why these steps must happen in this order"
    }
  ],
  "crossProgramAccounts": [
    {
      "account": "accountNameInIDL",
      "program": "ExternalProgramId",
      "note": "What this external program provides"
    }
  ]
}

For instructionFlows: identify logical sequences of instructions a developer must call in order to complete a real action (e.g. create → initialize → deposit). Only include flows with 2+ steps. Max 6 flows.
For crossProgramAccounts: identify accounts that reference external program addresses (provided in hints below). Max 10 entries. Omit if none exist.
Do not invent external facts. If purpose is ambiguous, say what can be inferred from names and structure.`

  const user = `Project: ${input.projectName}
IDL summary:
${JSON.stringify(idlSummary, null, 2)}

${crossProgramHints.length ? `Cross-program account hints (accounts with fixed external program addresses):\n${JSON.stringify(crossProgramHints, null, 2)}\n\n` : ''}Generated llms.txt:
${truncate(input.docsText, 13_000)}

Raw IDL excerpt:
${truncate(JSON.stringify(input.idl), 7_000)}`

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
      max_tokens: 2400,
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
