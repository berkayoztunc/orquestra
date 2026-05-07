import axios from 'axios'
import type { CustomApiEndpointInput } from '@shared/types'

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.orquestra.dev/api'
const AUTH_BASE = import.meta.env.VITE_AUTH_URL || '/auth'

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Attach token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Handle 401 responses and errors
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status
    const message = err.response?.data?.error || err.response?.data?.details?.join(', ') || err.message
    
    // Only show toast for non-401 errors (401 redirects to home)
    if (status !== 401) {
      // Store the error message for toast display
      err.toastMessage = message
    }
    
    if (status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/'
    }
    return Promise.reject(err)
  }
)

// ─── Auth ────────────────────────────────────────────

export function getGitHubLoginUrl(): string {
  const base = import.meta.env.VITE_WORKER_URL || 'https://api.orquestra.dev'
  return `${base}/auth/github`
}

export async function fetchCurrentUser() {
  const base = import.meta.env.VITE_WORKER_URL || 'https://api.orquestra.dev'
  const token = localStorage.getItem('token')
  const res = await axios.get(`${base}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return res.data.user
}

// ─── Projects ────────────────────────────────────────

export async function listProjects(params?: {
  page?: number
  limit?: number
  search?: string
}) {
  const res = await api.get('/projects', { params })
  return res.data
}

export async function getMyProjects() {
  const res = await api.get('/projects/mine')
  return res.data.projects
}

export async function getProject(projectId: string) {
  const res = await api.get(`/projects/${projectId}`)
  return res.data.project
}

export async function getProjectByProgramId(programId: string) {
  const res = await api.get(`/projects/by-program/${programId}`)
  return res.data.project
}

export async function updateProject(projectId: string, data: {
  name?: string
  description?: string
  isPublic?: boolean
  socials?: Record<string, string>
}) {
  const res = await api.put(`/projects/${projectId}`, data)
  return res.data
}

// ─── IDL ─────────────────────────────────────────────

export async function uploadIDL(data: {
  name: string
  description?: string
  programId: string
  idl: any
  cpiMd?: string
  isPublic?: boolean
}) {
  const res = await api.post('/idl/upload', data)
  return res.data
}

export async function getIDL(projectId: string, version?: number) {
  const params = version ? { version } : {}
  const res = await api.get(`/idl/${projectId}`, { params })
  return res.data
}

export async function updateIDL(projectId: string, data: { idl: any; cpiMd?: string }) {
  const res = await api.put(`/idl/${projectId}`, data)
  return res.data
}

export async function getIDLVersions(projectId: string) {
  const res = await api.get(`/idl/${projectId}/versions`)
  return res.data.versions
}

// ─── Instructions & Transactions ─────────────────────

export async function listInstructions(projectId: string) {
  const res = await api.get(`/${projectId}/instructions`)
  return res.data
}

export async function getInstruction(projectId: string, name: string) {
  const res = await api.get(`/${projectId}/instructions/${name}`)
  return res.data
}

export async function buildTransaction(
  projectId: string,
  instructionName: string,
  data: {
    accounts: Record<string, string>
    args: Record<string, any>
    feePayer: string
    recentBlockhash?: string
    network?: string
    rpcUrl?: string
    simulate?: boolean
    encoding?: 'base58' | 'base64'
  }
) {
  const res = await api.post(`/${projectId}/instructions/${instructionName}/build`, data)
  return res.data
}

// ─── AI Transaction Agent ─────────────────────────────

export type TxAgentNetwork = 'mainnet-beta' | 'devnet' | 'testnet'

export interface TxAgentState {
  projectId?: string
  programId?: string
  query?: string
  instruction?: string
  network?: TxAgentNetwork
  feePayer?: string
  accounts?: Record<string, string>
  args?: Record<string, unknown>
  projectCandidates?: Array<{
    projectId: string
    name: string
    programId: string
    description?: string | null
  }>
}

export interface TxAgentMissingField {
  kind: 'project' | 'instruction' | 'feePayer' | 'account' | 'arg'
  name: string
  type?: string
  reason: string
}

export interface TxAgentResponse {
  status: 'needs_input' | 'simulated' | 'failed'
  message: string
  state: TxAgentState
  missingFields: TxAgentMissingField[]
  candidates?: Array<{
    projectId: string
    name: string
    programId: string
    description?: string | null
  }>
  instructionSchema?: {
    name: string
    accounts: Array<{ name: string; isSigner: boolean; isWritable: boolean; isOptional: boolean }>
    args: Array<{ name: string; type: string }>
  }
  build?: {
    serializedTransaction: string
    transaction: string
    encoding: 'base58' | 'base64'
    wireFormat: string
    network: string
    rpcUrlHost: string
    recentBlockhash: string
    lastValidBlockHeight?: number
    riskLevel: 'low' | 'medium' | 'high'
    riskReasons: string[]
    estimatedFee: number
    accounts: Array<{ name: string; pubkey: string; isSigner: boolean; isWritable: boolean }>
    instruction: { name: string; programId: string; data: string }
  }
  simulation?: {
    success: boolean
    err: unknown | null
    logs: string[] | null
    decodedError: { code: number; name: string; msg: string } | null
  }
  error?: string
}

export async function runTxAgent(data: { message: string; state?: TxAgentState }) {
  const res = await api.post('/agent/tx', data)
  return res.data as TxAgentResponse
}

// ─── Accounts / Errors / Events / Types ──────────────

export async function getAccounts(projectId: string) {
  const res = await api.get(`/${projectId}/accounts`)
  return res.data
}

export async function getErrors(projectId: string) {
  const res = await api.get(`/${projectId}/errors`)
  return res.data
}

export async function getEvents(projectId: string) {
  const res = await api.get(`/${projectId}/events`)
  return res.data
}

export async function getTypes(projectId: string) {
  const res = await api.get(`/${projectId}/types`)
  return res.data
}

// ─── Documentation ───────────────────────────────────

export async function getDocs(
  projectId: string,
  format: 'json' | 'md' = 'json',
  options?: { refresh?: boolean }
) {
  const res = await api.get(`/${projectId}/docs`, {
    params: {
      format,
      ...(options?.refresh ? { refresh: '1' } : {}),
    },
  })
  return res.data
}

export async function updateDocs(projectId: string, docs: string) {
  const res = await api.put(`/${projectId}/docs`, { docs })
  return res.data
}

export async function resetDocs(projectId: string) {
  const res = await api.delete(`/${projectId}/docs`)
  return res.data
}

// ─── AI Analysis ─────────────────────────────────────

export interface AIAnalysisResponse {
  analysis: {
    id: string
    projectId: string
    idlVersionId: string | null
    idlVersion?: number | null
    shortDescription: string | null
    detailedAnalysis: {
      summary?: string
      tags?: string[]
      instructionCount?: number
      accountCount?: number
      errorCount?: number
      eventCount?: number
      capabilities?: string[]
      keyInstructions?: Array<{ name: string; purpose: string }>
      accountsOverview?: string[]
      risks?: string[]
      integrationNotes?: string[]
    } | null
    modelUsed: string | null
    generatedAt: string | null
    createdAt: string
  } | null
  message?: string
}

export async function getAIAnalysis(projectId: string) {
  const res = await api.get(`/projects/${projectId}/ai-analysis`)
  return res.data as AIAnalysisResponse
}

export async function regenerateAIAnalysis(projectId: string) {
  const res = await api.post(`/projects/${projectId}/ai-analysis/regenerate`)
  return res.data as AIAnalysisResponse
}

// ─── Known Addresses ─────────────────────────────────

export async function listKnownAddresses(projectId: string) {
  const res = await api.get(`/${projectId}/addresses`)
  return res.data.addresses
}

export async function addKnownAddress(projectId: string, data: { label: string; address: string; description?: string }) {
  const res = await api.post(`/${projectId}/addresses`, data)
  return res.data
}

export async function updateKnownAddress(projectId: string, addressId: string, data: { label?: string; address?: string; description?: string }) {
  const res = await api.put(`/${projectId}/addresses/${addressId}`, data)
  return res.data
}

export async function deleteKnownAddress(projectId: string, addressId: string) {
  const res = await api.delete(`/${projectId}/addresses/${addressId}`)
  return res.data
}

// ─── External API Endpoint Documentation ─────────────

export async function listCustomApiEndpoints(projectId: string) {
  const res = await api.get(`/${projectId}/external-apis`)
  return res.data.endpoints
}

export async function addCustomApiEndpoint(projectId: string, data: CustomApiEndpointInput) {
  const res = await api.post(`/${projectId}/external-apis`, data)
  return res.data
}

export async function updateCustomApiEndpoint(projectId: string, endpointId: string, data: Partial<CustomApiEndpointInput>) {
  const res = await api.put(`/${projectId}/external-apis/${endpointId}`, data)
  return res.data
}

export async function deleteCustomApiEndpoint(projectId: string, endpointId: string) {
  const res = await api.delete(`/${projectId}/external-apis/${endpointId}`)
  return res.data
}

// ─── Project Deletion ────────────────────────────────

export async function deleteProject(projectId: string, confirmName: string) {
  const res = await api.delete(`/idl/${projectId}`, { data: { confirmName } })
  return res.data
}

// ─── API Keys ────────────────────────────────────────

export async function listAPIKeys(projectId: string) {
  const res = await api.get(`/projects/${projectId}/keys`)
  return res.data.keys
}

export async function createAPIKey(projectId: string, expiresInDays?: number) {
  const res = await api.post(`/projects/${projectId}/keys`, { expiresInDays })
  return res.data
}

export async function deleteAPIKey(projectId: string, keyId: string) {
  const res = await api.delete(`/projects/${projectId}/keys/${keyId}`)
  return res.data
}

export async function rotateAPIKey(projectId: string, keyId: string) {
  const res = await api.post(`/projects/${projectId}/keys/${keyId}/rotate`)
  return res.data
}

// ─── PDA Derivation ──────────────────────────────────

export async function listPdaAccounts(projectId: string) {
  const res = await api.get(`/${projectId}/pda`)
  return res.data
}

export async function derivePda(
  projectId: string,
  data: {
    instruction: string
    account: string
    seedValues: Record<string, any>
  }
) {
  const res = await api.post(`/${projectId}/pda/derive`, data)
  return res.data
}

// ─── Account Data (On-chain Parsing) ─────────────────

export interface ParsedAccountResponse {
  address: string
  accountType: string | null
  programId: string
  lamports: number
  executable: boolean
  rentEpoch: number
  cluster: string
  slot: number
  /** Decoded field values. null when account type could not be matched. */
  data: Record<string, unknown> | null
  /** Raw account data as base64. Always present. */
  raw: string
  /** Set when parsing failed but the account was found. */
  parseError?: string
}

export async function fetchAccountData(
  projectId: string,
  address: string,
  network: string = 'mainnet-beta',
): Promise<ParsedAccountResponse> {
  const res = await api.get(`/${projectId}/pda/fetch/${address}`, {
    params: { network },
  })
  return res.data
}

// ─── Analytics ───────────────────────────────────────

export interface PublicStats {
  total_users: number
  total_projects: number
  total_known_addresses: number
}

export interface DailyApiEntry {
  date: number
  total: number
}

export interface DailyMcpEntry {
  date: number
  tool_id: number
  total: number
}

export interface TopProgram {
  project_id: string
  name: string | null
  total: number
}

export interface AdminAnalytics {
  daily_api: DailyApiEntry[]
  daily_mcp: DailyMcpEntry[]
  top_programs: TopProgram[]
}

export async function getPublicStats(): Promise<PublicStats> {
  const res = await api.get('/stats')
  return res.data
}

export async function getAdminAnalytics(): Promise<AdminAnalytics> {
  const workerBase = import.meta.env.VITE_WORKER_URL || 'https://api.orquestra.dev'
  const res = await axios.get(`${workerBase}/api/admin/analytics`)
  return res.data
}

// ─── Program Lists ───────────────────────────────────

export interface ProgramList {
  id: string
  user_id: string
  name: string
  description: string | null
  is_default: boolean
  scope_key: string
  item_count: number
  created_at: string
  updated_at: string
}

export interface ProgramListItem {
  item_id: string
  added_at: string
  project_id: string
  name: string
  description: string | null
  program_id: string
  is_public: boolean
  updated_at: string
  username?: string | null
  avatar_url?: string | null
}

export async function getLists(): Promise<ProgramList[]> {
  const res = await api.get('/lists')
  return res.data.lists
}

export async function createList(name: string, description?: string): Promise<ProgramList> {
  const res = await api.post('/lists', { name, description })
  return res.data.list
}

export async function updateList(id: string, data: { name?: string; description?: string }) {
  const res = await api.put(`/lists/${id}`, data)
  return res.data
}

export async function deleteList(id: string) {
  const res = await api.delete(`/lists/${id}`)
  return res.data
}

export async function getListItems(listId: string): Promise<ProgramListItem[]> {
  const res = await api.get(`/lists/${listId}/items`)
  return res.data.items
}

export async function addToList(listId: string, projectId: string) {
  const res = await api.post(`/lists/${listId}/items`, { projectId })
  return res.data
}

export async function addToDefaultList(projectId: string) {
  const res = await api.post('/lists/default/items', { projectId })
  return res.data
}

export async function removeFromList(listId: string, projectId: string) {
  const res = await api.delete(`/lists/${listId}/items/${projectId}`)
  return res.data
}

export async function regenerateScopeKey(listId: string): Promise<{ scope_key: string }> {
  const res = await api.post(`/lists/${listId}/scope-key`)
  return res.data
}

export default api
