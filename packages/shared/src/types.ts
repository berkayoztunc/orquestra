// User types
export interface User {
  id: string
  github_id: number
  username: string
  email: string
  avatar_url: string
  created_at: string
  updated_at: string
}

// Project types
export interface Project {
  id: string
  user_id: string
  name: string
  description: string
  program_id: string
  is_public: boolean
  created_at: string
  updated_at: string
  category?: string | null
}

// IDL Version types
export interface IDLVersion {
  id: string
  project_id: string
  idl_json: string
  cpi_md: string | null
  version: number
  created_at: string
}

// API Key types
export interface APIKey {
  id: string
  project_id: string
  key: string
  last_used: string | null
  created_at: string
  expires_at: string | null
}

// Project Social types
export interface ProjectSocial {
  id: string
  project_id: string
  twitter: string | null
  discord: string | null
  telegram: string | null
  github: string | null
  website: string | null
}

// Known Address types
export interface KnownAddress {
  id: string
  project_id: string
  label: string
  address: string
  description: string | null
  created_at: string
  updated_at: string
}

// Solana IDL types (simplified)
export interface AnchorIDL {
  version?: string
  name?: string
  metadata?: any
  instructions: AnchorInstruction[]
  accounts?: AnchorAccount[]
  types?: AnchorType[]
  events?: AnchorEvent[]
  errors?: AnchorError[]
}

export interface AnchorInstruction {
  name: string
  accounts: AnchorAccountMeta[]
  args: AnchorArg[]
  discriminator?: number[]
  docs?: string[]
}

export interface AnchorAccountMeta {
  name: string
  // Old format
  isMut?: boolean
  isSigner?: boolean
  isOptional?: boolean
  // New format (Anchor IDL spec 0.1.0)
  writable?: boolean
  signer?: boolean
  optional?: boolean
  address?: string
  pda?: {
    seeds: Array<{ kind: string; value?: any; path?: string }>
    program?: { kind: string; value?: any }
  }
}

export interface AnchorArg {
  name: string
  type: any
}

export interface AnchorAccount {
  name: string
  type?: {
    kind: string
    fields?: Array<{
      name: string
      type: any
    }>
  }
  discriminator?: number[]
  docs?: string[]
}

export interface AnchorType {
  name: string
  type: {
    kind: string
    fields?: Array<{
      name: string
      type: any
    }>
    variants?: Array<{
      name: string
      fields?: any
    }>
  }
}

export interface AnchorEvent {
  name: string
  data?: any
  discriminator?: number[]
}

export interface AnchorError {
  code: number
  name: string
  msg: string
}

// API Response types
export interface APIResponse<T> {
  data?: T
  error?: string
  message?: string
  status: number
}

export interface TransactionBuildRequest {
  accounts: Record<string, string>
  args: Record<string, any>
  feePayer?: string
  recentBlockhash?: string
  /** Encoding for serializedTransaction in the response. Defaults to 'base58'. Use 'base64' for the modern Solana standard. */
  encoding?: 'base58' | 'base64'
}

export interface TransactionBuildResponse {
  transaction: string
  serializedTransaction?: string
  message: string
  /** Encoding used for transaction and serializedTransaction fields. */
  encoding?: 'base58' | 'base64'
  blockHash?: string
  /** Cluster used for RPC blockhash / simulation */
  network?: 'mainnet-beta' | 'devnet' | 'testnet' | 'custom'
  rpcUrlHost?: string
  recentBlockhash?: string
  lastValidBlockHeight?: number
  blockhashSource?: 'client' | 'rpc'
  wireFormat?: 'legacy'
  simulationError?: unknown | null
  simulationLogs?: string[] | null
}

// Auth types
export interface JWTPayload {
  sub: string
  username: string
  iat: number
  exp: number
}

export interface GitHubOAuthToken {
  access_token: string
  token_type: string
  scope: string
}

export interface GitHubUser {
  id: number
  login: string
  email: string | null
  avatar_url: string
  name: string | null
}

// AI Analysis types
export interface AIAnalysis {
  id: string
  project_id: string
  idl_version_id: string | null
  short_description: string | null
  detailed_analysis_json: string | null
  model_used: string | null
  generated_at: string | null
  created_at: string
}

export interface AIDetailedAnalysis {
  programName: string
  instructionCount: number
  accountCount: number
  errorCount: number
  eventCount: number
  tags: string[]
  summary: string
}

// Ingest types (CLI → Worker)
export interface IngestRequest {
  programId: string
  idl: AnchorIDL
  idlHash: string
  aiDescription: string | null
  aiAnalysisJson: string | null
  aiModelUsed: string | null
  aiGeneratedAt: string | null
  programName?: string
  programDescription?: string
}

export interface IngestResponse {
  projectId: string
  idlVersionId: string
  aiAnalysisId: string | null
  created: boolean
  newVersion: boolean
}

// Constants
export const API_VERSION = 'v1'

// ─── IDL Standard ─────────────────────────────────────────────────────────────

export type IDLStandard = 'anchor' | 'codama'

// ─── Codama IDL types ─────────────────────────────────────────────────────────
// Reference: https://github.com/codama-idl/codama

/** Discriminated union of all Codama type nodes */
export type CodamaTypeNode =
  | { kind: 'numberTypeNode'; format: 'u8' | 'u16' | 'u32' | 'u64' | 'u128' | 'i8' | 'i16' | 'i32' | 'i64' | 'i128' | 'f32' | 'f64'; endian?: 'le' | 'be' }
  | { kind: 'publicKeyTypeNode' }
  | { kind: 'booleanTypeNode' }
  | { kind: 'stringTypeNode'; encoding?: string }
  | { kind: 'bytesTypeNode' }
  | { kind: 'definedTypeLinkNode'; name: string }
  | { kind: 'optionTypeNode'; item: CodamaTypeNode; prefix?: CodamaTypeNode }
  | { kind: 'zeroableOptionTypeNode'; item: CodamaTypeNode }
  | { kind: 'arrayTypeNode'; item: CodamaTypeNode; count: CodamaCountNode }
  | { kind: 'structTypeNode'; fields: CodamaStructField[] }
  | { kind: 'enumTypeNode'; variants: CodamaEnumVariant[]; size?: CodamaTypeNode }
  | { kind: 'tupleTypeNode'; items: CodamaTypeNode[] }
  | { kind: 'mapTypeNode'; key: CodamaTypeNode; value: CodamaTypeNode; count: CodamaCountNode }
  | { kind: 'setTypeNode'; item: CodamaTypeNode; count: CodamaCountNode }

export type CodamaCountNode =
  | { kind: 'fixedCountNode'; value: number }
  | { kind: 'prefixedCountNode'; prefix: CodamaTypeNode }
  | { kind: 'remainderCountNode' }

export interface CodamaStructField {
  kind: 'structFieldTypeNode'
  name: string
  type: CodamaTypeNode
  defaultValue?: CodamaValueNode
  defaultValueStrategy?: 'optional' | 'omitted'
  docs?: string[]
}

export interface CodamaEnumVariant {
  kind: 'enumEmptyVariantTypeNode' | 'enumStructVariantTypeNode' | 'enumTupleVariantTypeNode'
  name: string
  fields?: CodamaStructField[]
  items?: CodamaTypeNode[]
}

/** Discriminated union of Codama value nodes */
export type CodamaValueNode =
  | { kind: 'publicKeyValueNode'; publicKey: string }
  | { kind: 'numberValueNode'; number: number }
  | { kind: 'booleanValueNode'; boolean: boolean }
  | { kind: 'stringValueNode'; string: string }
  | { kind: 'bytesValueNode'; data: string; encoding: string }
  | { kind: 'noneValueNode' }
  | { kind: 'someValueNode'; value: CodamaValueNode }
  | { kind: 'constantValueNode'; type: CodamaTypeNode; value: CodamaValueNode }
  | { kind: 'enumValueNode'; enum: string; variant: string }
  | { kind: 'arrayValueNode'; items: CodamaValueNode[] }
  | { kind: 'mapValueNode'; entries: Array<{ key: CodamaValueNode; value: CodamaValueNode }> }
  | { kind: 'structValueNode'; fields: Array<{ name: string; value: CodamaValueNode }> }
  | { kind: 'tupleValueNode'; items: CodamaValueNode[] }

export interface CodamaInstructionAccount {
  kind: 'instructionAccountNode'
  name: string
  isWritable: boolean
  isSigner: boolean | 'either'
  isOptional?: boolean
  defaultValue?: CodamaValueNode
  docs?: string[]
}

export interface CodamaInstructionArgument {
  kind: 'instructionArgumentNode'
  name: string
  type: CodamaTypeNode
  defaultValue?: CodamaValueNode
  defaultValueStrategy?: 'optional' | 'omitted'
  docs?: string[]
}

export interface CodamaDiscriminator {
  kind: 'fieldDiscriminatorNode' | 'sizeDiscriminatorNode' | 'constantDiscriminatorNode' | 'accountDiscriminatorNode'
  name?: string  // for fieldDiscriminatorNode
  offset?: number
}

export interface CodamaInstruction {
  kind: 'instructionNode'
  name: string
  accounts: CodamaInstructionAccount[]
  arguments: CodamaInstructionArgument[]
  discriminators?: CodamaDiscriminator[]
  optionalAccountStrategy?: 'omitted' | 'programId'
  docs?: string[]
}

export interface CodamaError {
  kind: 'errorNode'
  name: string
  code: number
  message: string
  docs?: string[]
}

export interface CodamaPdaSeed {
  kind: 'variablePdaSeedNode' | 'constantPdaSeedNode' | 'programIdPdaSeedNode'
  name?: string
  type?: CodamaTypeNode
  value?: CodamaValueNode
  bytes?: string
}

export interface CodamaPda {
  kind: 'pdaNode'
  name: string
  seeds: CodamaPdaSeed[]
  docs?: string[]
}

export interface CodamaDefinedType {
  kind: 'definedTypeNode'
  name: string
  type: CodamaTypeNode
  docs?: string[]
}

export interface CodamaAccount {
  kind: 'accountNode'
  name: string
  data: CodamaTypeNode
  discriminators?: CodamaDiscriminator[]
  docs?: string[]
}

export interface CodamaProgram {
  kind: 'programNode'
  name: string
  publicKey: string
  version: string
  instructions: CodamaInstruction[]
  accounts: CodamaAccount[]
  definedTypes: CodamaDefinedType[]
  pdas: CodamaPda[]
  errors: CodamaError[]
  events?: any[]
  docs?: string[]
}

export interface CodamaIDL {
  kind: 'rootNode'
  standard: 'codama'
  version: string
  program: CodamaProgram
  additionalPrograms?: CodamaProgram[]
}
export const MAX_IDL_SIZE = 10 * 1024 * 1024 // 10MB
export const MAX_CPI_SIZE = 5 * 1024 * 1024 // 5MB
