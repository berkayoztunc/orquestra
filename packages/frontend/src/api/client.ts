import axios from 'axios'

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
  }
) {
  const res = await api.post(`/${projectId}/instructions/${instructionName}/build`, data)
  return res.data
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

export default api
