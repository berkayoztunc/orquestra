import type { D1Database, KVNamespace } from '@cloudflare/workers-types'
import {
  expandInstructionArgs,
  getInstruction,
  normalizeAccountMeta,
} from './idl-parser'
import type { AnchorIDL, AnchorInstruction } from './idl-parser'
import { buildTransaction, validateBuildRequest } from './tx-builder'
import type { BuildTransactionResponse } from './tx-builder'
import { searchProjects } from './search'
import { resolveSolanaRpcUrl, rpcUrlHost } from '../utils/solana-rpc'
import { derivePda } from './pda'

const DEFAULT_MODEL = '@cf/meta/llama-3.2-3b-instruct'
const DEFAULT_NETWORK: TxAgentNetwork = 'mainnet-beta'
const BASE58_PUBLIC_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export type TxAgentNetwork = 'mainnet-beta' | 'devnet' | 'testnet'
export type TxAgentStatus = 'needs_input' | 'simulated' | 'failed'

export interface TxAgentState {
  projectId?: string
  programId?: string
  query?: string
  instruction?: string
  network?: TxAgentNetwork
  feePayer?: string
  accounts?: Record<string, string>
  args?: Record<string, unknown>
  projectCandidates?: TxAgentCandidate[]
}

export interface TxAgentRequest {
  message: string
  state?: TxAgentState
}

export interface TxAgentMissingField {
  kind: 'project' | 'instruction' | 'feePayer' | 'account' | 'arg'
  name: string
  type?: string
  reason: string
}

export interface TxAgentCandidate {
  projectId: string
  name: string
  programId: string
  description?: string | null
}

export interface TxAgentResponse {
  status: TxAgentStatus
  message: string
  state: TxAgentState
  missingFields: TxAgentMissingField[]
  candidates?: TxAgentCandidate[]
  instructionSchema?: {
    name: string
    accounts: Array<{ name: string; isSigner: boolean; isWritable: boolean; isOptional: boolean }>
    args: Array<{ name: string; type: string }>
  }
  build?: Pick<
    BuildTransactionResponse,
    | 'serializedTransaction'
    | 'transaction'
    | 'encoding'
    | 'wireFormat'
    | 'network'
    | 'rpcUrlHost'
    | 'recentBlockhash'
    | 'lastValidBlockHeight'
    | 'riskLevel'
    | 'riskReasons'
    | 'estimatedFee'
    | 'accounts'
    | 'instruction'
  >
  simulation?: {
    success: boolean
    err: unknown | null
    logs: string[] | null
    decodedError: BuildTransactionResponse['decodedError']
  }
  error?: string
}

interface TxAgentBindings {
  DB: D1Database
  IDLS: KVNamespace
  AI: Ai
  SOLANA_RPC_URL?: string
  SOLANA_MAINNET_RPC_URL?: string
  SOLANA_DEVNET_RPC_URL?: string
  SOLANA_TESTNET_RPC_URL?: string
}

interface ProjectData {
  id: string
  name: string
  programId: string
  idl: AnchorIDL
}

interface AiExtraction {
  projectId?: string
  programId?: string
  query?: string
  instruction?: string
  network?: TxAgentNetwork
  feePayer?: string
  accounts?: Record<string, string>
  args?: Record<string, unknown>
}

export function parseAiExtraction(rawText: string): AiExtraction {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('Workers AI response did not contain a JSON object')
  }

  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Workers AI response JSON must be an object')
  }

  const extraction: AiExtraction = {}
  for (const key of ['projectId', 'programId', 'query', 'instruction', 'feePayer'] as const) {
    if (typeof parsed[key] === 'string' && parsed[key].trim()) {
      extraction[key] = parsed[key].trim()
    }
  }

  if (
    parsed.network === 'mainnet-beta' ||
    parsed.network === 'devnet' ||
    parsed.network === 'testnet'
  ) {
    extraction.network = parsed.network
  }

  if (isStringRecord(parsed.accounts)) {
    extraction.accounts = Object.fromEntries(
      Object.entries(parsed.accounts).filter(([, value]) => BASE58_PUBLIC_KEY.test(value)),
    )
  }

  if (isPlainObject(parsed.args)) {
    extraction.args = parsed.args
  }

  return extraction
}

export function mergeTxAgentState(
  previous: TxAgentState | undefined,
  extraction: AiExtraction,
  userMessage: string,
): TxAgentState {
  const state: TxAgentState = {
    ...(previous ?? {}),
    accounts: { ...(previous?.accounts ?? {}) },
    args: { ...(previous?.args ?? {}) },
    projectCandidates: previous?.projectCandidates ? [...previous.projectCandidates] : undefined,
  }

  for (const key of ['projectId', 'programId', 'query', 'instruction', 'network'] as const) {
    if (extraction[key] !== undefined) {
      ;(state as Record<string, unknown>)[key] = extraction[key]
    }
  }

  if (extraction.feePayer && isUserProvidedPubkey(extraction.feePayer, previous, userMessage)) {
    state.feePayer = extraction.feePayer
  }

  for (const [name, pubkey] of Object.entries(extraction.accounts ?? {})) {
    if (isUserProvidedPubkey(pubkey, previous, userMessage)) {
      state.accounts![name] = pubkey
    }
  }

  for (const [name, value] of Object.entries(extraction.args ?? {})) {
    state.args![name] = value
  }

  if (Object.keys(state.accounts ?? {}).length === 0) delete state.accounts
  if (Object.keys(state.args ?? {}).length === 0) delete state.args

  return state
}

export async function runTxAgent(env: TxAgentBindings, request: TxAgentRequest): Promise<TxAgentResponse> {
  let extraction: AiExtraction
  try {
    extraction = await extractIntentWithAI(env.AI, request)
  } catch (err) {
    const state = normalizeState(request.state)
    return {
      status: 'failed',
      message: 'I could not parse the transaction request. Please restate the program, instruction, wallet, accounts, and arguments.',
      state,
      missingFields: [],
      error: (err as Error).message,
    }
  }

  const state = mergeTxAgentState(normalizeState(request.state), extraction, request.message)
  state.network = state.network ?? DEFAULT_NETWORK

  const projectResolution = await resolveProject(env.DB, env.IDLS, state, request.message)
  if (projectResolution.type === 'needs_input') {
    state.projectCandidates = projectResolution.candidates
    return {
      status: 'needs_input',
      message: projectResolution.message,
      state,
      missingFields: [{ kind: 'project', name: 'projectId', reason: 'A target Orquestra project is required.' }],
      candidates: projectResolution.candidates,
    }
  }

  const project = projectResolution.project
  state.projectId = project.id
  state.programId = project.programId
  delete state.projectCandidates

  if (!state.instruction) {
    state.instruction = inferInstructionName(project.idl, [request.message, state.query].filter(Boolean).join(' '))
  }
  if (!state.instruction) {
    state.instruction = chooseDefaultInstruction(project.idl)
  }
  const instruction = state.instruction ? getInstruction(project.idl, state.instruction) : undefined
  if (!instruction) {
    return {
      status: 'needs_input',
      message: state.instruction
        ? `Instruction "${state.instruction}" was not found for ${project.name}. Which instruction should I use?`
        : `Which instruction should I use for ${project.name}?`,
      state,
      missingFields: [{ kind: 'instruction', name: 'instruction', reason: 'A valid instruction name is required.' }],
      instructionSchema: undefined,
    }
  }

  state.instruction = instruction.name
  const schema = buildInstructionSchema(project.idl, instruction)
  autofillStaticAccounts(instruction, state)
  autofillSignerAccounts(instruction, state)
  await deriveAvailablePdas(project, instruction, state)
  const missingFields = findMissingFields(project.idl, instruction, state)
  if (missingFields.length > 0) {
    return {
      status: 'needs_input',
      message: buildMissingFieldsQuestion(project.name, instruction.name, missingFields),
      state,
      missingFields,
      instructionSchema: schema,
    }
  }

  const validation = validateBuildRequest(
    instruction,
    state.accounts ?? {},
    state.args ?? {},
    project.idl.types,
  )
  if (!validation.valid) {
    return {
      status: 'needs_input',
      message: `I still need corrected transaction fields before building ${project.name}.${instruction.name}.`,
      state,
      missingFields: validation.errors.map((error) => ({
        kind: error.includes('argument') || error.includes('Argument') ? 'arg' : 'account',
        name: error,
        reason: error,
      })),
      instructionSchema: schema,
    }
  }

  try {
    const { rpcUrl, cluster } = resolveSolanaRpcUrl({
      network: state.network ?? DEFAULT_NETWORK,
      env,
    })
    const result = await buildTransaction(
      project.idl,
      instruction.name,
      {
        accounts: state.accounts ?? {},
        args: state.args ?? {},
        feePayer: state.feePayer!,
        simulate: true,
        encoding: 'base64',
      },
      project.programId,
      rpcUrl,
      { cluster, rpcUrlHost: rpcUrlHost(rpcUrl) },
    )

    const simulationSuccess = result.simulationError == null
    return {
      status: simulationSuccess ? 'simulated' : 'failed',
      message: simulationSuccess
        ? `Simulation succeeded for ${project.name}.${instruction.name}. The unsigned base64 transaction is ready for wallet signing.`
        : `Simulation failed for ${project.name}.${instruction.name}. Fix the fields before signing.`,
      state,
      missingFields: [],
      instructionSchema: schema,
      build: {
        serializedTransaction: result.serializedTransaction,
        transaction: result.transaction,
        encoding: result.encoding,
        wireFormat: result.wireFormat,
        network: result.network,
        rpcUrlHost: result.rpcUrlHost,
        recentBlockhash: result.recentBlockhash,
        lastValidBlockHeight: result.lastValidBlockHeight,
        riskLevel: result.riskLevel,
        riskReasons: result.riskReasons,
        estimatedFee: result.estimatedFee,
        accounts: result.accounts,
        instruction: result.instruction,
      },
      simulation: {
        success: simulationSuccess,
        err: result.simulationError,
        logs: result.simulationLogs,
        decodedError: result.decodedError,
      },
    }
  } catch (err) {
    return {
      status: 'failed',
      message: `Could not build or simulate ${project.name}.${instruction.name}.`,
      state,
      missingFields: [],
      instructionSchema: schema,
      error: (err as Error).message,
    }
  }
}

async function extractIntentWithAI(ai: Ai, request: TxAgentRequest): Promise<AiExtraction> {
  const systemPrompt = `You extract Solana transaction intent for Orquestra.
Reply ONLY with strict JSON. No markdown.

Allowed JSON keys:
{
  "projectId": string | null,
  "programId": string | null,
  "query": string | null,
  "instruction": string | null,
  "network": "mainnet-beta" | "devnet" | "testnet" | null,
  "feePayer": string | null,
  "accounts": { [accountName: string]: string },
  "args": { [argName: string]: unknown }
}

Rules:
- Extract only values explicitly provided by the user or existing state.
- Do not invent public keys, accounts, PDA seeds, token accounts, or amounts.
- For query, extract only the likely protocol/program name or search keywords, not the whole action.
  Examples: "stake 1 SOL with Marinade" -> "Marinade"; "increment a counter" -> "counter".
- If the user gives a wallet public key and no explicit fee payer, set feePayer to that public key.
- If unsure about project or instruction, use query and leave uncertain fields null.`

  const response = await (ai as any).run(DEFAULT_MODEL, {
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          message: request.message,
          previousState: request.state ?? {},
        }),
      },
    ],
    max_tokens: 500,
    temperature: 0,
  })

  return parseAiExtraction((response as { response?: string }).response ?? '')
}

async function resolveProject(
  db: D1Database,
  kv: KVNamespace,
  state: TxAgentState,
  userMessage: string,
): Promise<
  | { type: 'resolved'; project: ProjectData }
  | { type: 'needs_input'; message: string; candidates?: TxAgentCandidate[] }
> {
  if (state.projectId) {
    const project = await fetchProjectIDL(db, kv, state.projectId)
    if (project) return { type: 'resolved', project }
  }

  const selectedProject = await resolveProjectReference(db, kv, state, userMessage)
  if (selectedProject) return { type: 'resolved', project: selectedProject }

  if (state.projectId) {
    return { type: 'needs_input', message: `Project "${state.projectId}" was not found or is not public.` }
  }

  if (state.programId) {
    const row = await db
      .prepare('SELECT id FROM projects WHERE program_id = ? AND is_public = 1 LIMIT 1')
      .bind(state.programId)
      .first<{ id: string }>()
    if (row?.id) {
      const project = await fetchProjectIDL(db, kv, row.id)
      if (project) return { type: 'resolved', project }
    }
    const project = await fetchProjectIDL(db, kv, state.programId)
    if (project) return { type: 'resolved', project }
    return { type: 'needs_input', message: `Program "${state.programId}" was not found in public Orquestra projects.` }
  }

  const searchQueries = buildProjectSearchQueries(state, userMessage)
  if (searchQueries.length > 0) {
    const seen = new Set<string>()
    const candidates: TxAgentCandidate[] = []

    for (const query of searchQueries) {
      const { results } = await searchProjects(db, query, 5, 0)
      for (const result of results) {
        if (seen.has(result.id)) continue
        seen.add(result.id)
        candidates.push({
          projectId: result.id,
          name: result.name,
          programId: result.program_id,
          description: result.description,
        })
      }
      if (candidates.length >= 5) break
    }

    if (candidates.length > 0) {
      const project = await fetchProjectIDL(db, kv, candidates[0].projectId)
      if (project) return { type: 'resolved', project }
    }

    return {
      type: 'needs_input',
      message: `I searched public Orquestra programs for "${searchQueries.join('", "')}" but did not find a match. Try a protocol name, exact program ID, or upload the IDL first.`,
    }
  }

  return {
    type: 'needs_input',
    message: 'Tell me the protocol, program name, or program ID to search public Orquestra projects.',
  }
}

function buildProjectSearchQueries(state: TxAgentState, userMessage: string): string[] {
  const queries: string[] = []
  const add = (value: string | undefined) => {
    const normalized = normalizeSearchQuery(value)
    if (normalized && !queries.includes(normalized)) queries.push(normalized)
  }

  add(state.query)

  for (const pubkey of userMessage.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) ?? []) {
    add(pubkey)
  }

  const cleaned = normalizeSearchQuery(userMessage)
  add(cleaned)

  const keywords = cleaned
    .split(/\s+/)
    .filter((word) => word.length >= 4)
    .filter((word) => !PROJECT_SEARCH_STOPWORDS.has(word))

  for (const keyword of keywords) add(keyword)

  return queries.slice(0, 6)
}

const PROJECT_SEARCH_STOPWORDS = new Set([
  'find',
  'simple',
  'program',
  'build',
  'create',
  'make',
  'transaction',
    'instruction',
  'increment',
  'decrement',
  'initialize',
  'devnet',
  'testnet',
  'mainnet',
  'mainnet-beta',
  'with',
  'using',
  'use',
  'please',
  'want',
  'need',
  'solana',
])

function normalizeSearchQuery(value: string | undefined): string {
  if (!value) return ''
  return value
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !PROJECT_SEARCH_STOPWORDS.has(word.toLowerCase()))
    .join(' ')
    .trim()
    .slice(0, 100)
}

async function resolveProjectReference(
  db: D1Database,
  kv: KVNamespace,
  state: TxAgentState,
  userMessage: string,
): Promise<ProjectData | null> {
  const message = userMessage.toLowerCase()
  for (const candidate of state.projectCandidates ?? []) {
    const fields = [candidate.projectId, candidate.programId, candidate.name]
    if (fields.some((field) => message.includes(field.toLowerCase()))) {
      return fetchProjectIDL(db, kv, candidate.projectId)
    }
  }

  for (const token of extractReferenceTokens(userMessage)) {
    const byProjectId = await fetchProjectIDL(db, kv, token)
    if (byProjectId) return byProjectId

    const row = await db
      .prepare('SELECT id FROM projects WHERE program_id = ? AND is_public = 1 LIMIT 1')
      .bind(token)
      .first<{ id: string }>()
    if (row?.id) {
      const byProgramId = await fetchProjectIDL(db, kv, row.id)
      if (byProgramId) return byProgramId
    }
  }

  return null
}

function extractReferenceTokens(text: string): string[] {
  return text
    .split(/[^A-Za-z0-9_-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 8 && token.length <= 64)
}

async function fetchProjectIDL(db: D1Database, kv: KVNamespace, projectId: string): Promise<ProjectData | null> {
  const cached = await kv?.get(`project:${projectId}`)
  if (cached) {
    try {
      const parsed = JSON.parse(cached)
      return {
        id: projectId,
        name: parsed.projectName ?? projectId,
        idl: parsed.idl as AnchorIDL,
        programId: parsed.programId ?? '',
      }
    } catch {
      // Fall through to DB.
    }
  }

  const row = await db
    ?.prepare(
      `SELECT p.id, p.name, p.program_id, v.idl_json
       FROM projects p
       JOIN idl_versions v ON v.project_id = p.id
       WHERE p.id = ? AND p.is_public = 1
       ORDER BY v.version DESC LIMIT 1`,
    )
    .bind(projectId)
    .first<{ id: string; name: string; program_id: string; idl_json: string }>()

  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    programId: row.program_id,
    idl: JSON.parse(row.idl_json) as AnchorIDL,
  }
}

function buildInstructionSchema(idl: AnchorIDL, instruction: AnchorInstruction): TxAgentResponse['instructionSchema'] {
  return {
    name: instruction.name,
    accounts: instruction.accounts.map((account) => {
      const normalized = normalizeAccountMeta(account)
      return {
        name: normalized.name,
        isSigner: normalized.isSigner,
        isWritable: normalized.isMut,
        isOptional: normalized.isOptional,
      }
    }),
    args: expandInstructionArgs(idl, instruction.args).map((arg) => ({
      name: arg.name,
      type: arg.typeStr,
    })),
  }
}

function inferInstructionName(idl: AnchorIDL, text: string): string | undefined {
  const normalized = text.toLowerCase()
  const exact = idl.instructions.find((instruction) => normalized.includes(instruction.name.toLowerCase()))
  if (exact) return exact.name

  const keywords = normalized.split(/[^a-z0-9]+/).filter(Boolean)
  return idl.instructions.find((instruction) => {
    const name = instruction.name.toLowerCase()
    return keywords.some((keyword) => keyword.length >= 4 && (name.includes(keyword) || keyword.includes(name)))
  })?.name
}

function chooseDefaultInstruction(idl: AnchorIDL): string | undefined {
  if (idl.instructions.length === 0) return undefined
  if (idl.instructions.length === 1) return idl.instructions[0].name

  const nonSetup = idl.instructions.find((instruction) => {
    const name = instruction.name.toLowerCase()
    return !['initialize', 'init', 'create', 'setup'].includes(name)
  })
  return nonSetup?.name ?? idl.instructions[0].name
}

function autofillStaticAccounts(instruction: AnchorInstruction, state: TxAgentState): void {
  for (const account of instruction.accounts as any[]) {
    const normalized = normalizeAccountMeta(account)
    if (state.accounts?.[normalized.name]) continue

    const staticAddress = typeof account.address === 'string'
      ? account.address
      : COMMON_ACCOUNT_ADDRESSES[normalized.name.toLowerCase()]

    if (!staticAddress) continue
    state.accounts = {
      ...(state.accounts ?? {}),
      [normalized.name]: staticAddress,
    }
  }
}

function autofillSignerAccounts(instruction: AnchorInstruction, state: TxAgentState): void {
  if (!state.feePayer) return
  for (const account of instruction.accounts) {
    const normalized = normalizeAccountMeta(account)
    if (!normalized.isSigner || state.accounts?.[normalized.name]) continue
    state.accounts = {
      ...(state.accounts ?? {}),
      [normalized.name]: state.feePayer,
    }
  }
}

const COMMON_ACCOUNT_ADDRESSES: Record<string, string> = {
  systemprogram: '11111111111111111111111111111111',
  system_program: '11111111111111111111111111111111',
  tokenprogram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  token_program: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  spltokenprogram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  associatedtokenprogram: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  associated_token_program: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  ataprogram: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  rent: 'SysvarRent111111111111111111111111111111111',
  sysvarrent: 'SysvarRent111111111111111111111111111111111',
  clock: 'SysvarC1ock11111111111111111111111111111111',
  sysvarclock: 'SysvarC1ock11111111111111111111111111111111',
}


function findMissingFields(
  idl: AnchorIDL,
  instruction: AnchorInstruction,
  state: TxAgentState,
): TxAgentMissingField[] {
  const missing: TxAgentMissingField[] = []
  if (!state.feePayer) {
    missing.push({ kind: 'feePayer', name: 'feePayer', reason: 'A wallet public key is required as fee payer.' })
  }

  for (const account of instruction.accounts) {
    const normalized = normalizeAccountMeta(account)
    if (!normalized.isOptional && !state.accounts?.[normalized.name]) {
      missing.push({
        kind: 'account',
        name: normalized.name,
        reason: `Required account "${normalized.name}" is missing.`,
      })
    }
  }

  for (const arg of expandInstructionArgs(idl, instruction.args)) {
    if (state.args?.[arg.name] === undefined) {
      missing.push({
        kind: 'arg',
        name: arg.name,
        type: arg.typeStr,
        reason: `Required argument "${arg.name}" is missing.`,
      })
    }
  }

  return missing
}

function buildMissingFieldsQuestion(projectName: string, instructionName: string, fields: TxAgentMissingField[]): string {
  const fieldList = fields.map((field) => {
    if (field.type) return `${field.kind} ${field.name} (${field.type})`
    return `${field.kind} ${field.name}`
  })
  return `To build ${projectName}.${instructionName}, please provide: ${fieldList.join(', ')}.`
}

function normalizeState(state: TxAgentState | undefined): TxAgentState {
  return {
    ...(state ?? {}),
    network: isNetwork(state?.network) ? state.network : undefined,
    accounts: isStringRecord(state?.accounts) ? { ...state.accounts } : undefined,
    args: isPlainObject(state?.args) ? { ...state.args } : undefined,
    projectCandidates: Array.isArray(state?.projectCandidates) ? state.projectCandidates : undefined,
  }
}

async function deriveAvailablePdas(
  project: ProjectData,
  instruction: AnchorInstruction,
  state: TxAgentState,
): Promise<void> {
  for (const account of instruction.accounts as any[]) {
    const normalized = normalizeAccountMeta(account)
    if (state.accounts?.[normalized.name] || !account.pda?.seeds?.length) continue

    const seedValues = {
      ...(state.args ?? {}),
      ...(state.accounts ?? {}),
    }

    try {
      const derived = await derivePda(
        project.idl,
        project.programId,
        instruction.name,
        normalized.name,
        seedValues,
      )
      state.accounts = {
        ...(state.accounts ?? {}),
        [normalized.name]: derived.pda,
      }
    } catch {
      // Missing or invalid seeds are handled by the normal missing-field prompt.
    }
  }
}

function isNetwork(value: unknown): value is TxAgentNetwork {
  return value === 'mainnet-beta' || value === 'devnet' || value === 'testnet'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isPlainObject(value)) return false
  return Object.values(value).every((item) => typeof item === 'string')
}

function isUserProvidedPubkey(pubkey: string, previous: TxAgentState | undefined, userMessage: string): boolean {
  if (userMessage.includes(pubkey)) return true
  if (previous?.feePayer === pubkey) return true
  return Object.values(previous?.accounts ?? {}).includes(pubkey)
}
