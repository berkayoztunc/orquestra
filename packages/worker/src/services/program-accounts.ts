import bs58 from 'bs58'
import type { AnchorAccount, AnchorIDL, CodamaIDL, CodamaTypeNode } from './idl-parser'
import {
  detectIDLFormat,
  getDefinedTypeName,
  lookupType,
  resolveAccountFields,
} from './idl-parser'
import {
  computeAccountDiscriminator,
  deserializeAccountData,
  deserializeCodamaAccountData,
  detectAccountType,
  detectCodamaAccountType,
} from './account-parser'
import type { ResolvedCluster } from '../utils/solana-rpc'

export interface ProgramAccountMemcmpFilter {
  offset: number
  bytes: string
}

export interface ProgramAccountFieldFilter {
  field: string
  bytes: string
}

export interface ProgramAccountsQuery {
  accountType?: string
  network?: string
  rpcUrl?: string
  dataSize?: number
  memcmp?: ProgramAccountMemcmpFilter[]
  fieldFilters?: ProgramAccountFieldFilter[]
  limit?: number
  paginationKey?: string
  changedSinceSlot?: number
  includeRaw?: boolean
}

export interface ProgramAccountsQueryResult {
  programId: string
  cluster: ResolvedCluster
  slot: number
  paginationKey: string | null
  rpcMethod: 'getProgramAccounts' | 'getProgramAccountsV2'
  filtersApplied: Array<{ type: 'dataSize'; dataSize: number } | { type: 'memcmp'; offset: number; bytes: string; source: string }>
  count: number
  accounts: Array<{
    address: string
    lamports: number
    owner: string
    executable: boolean
    rentEpoch: number
    accountType: string | null
    data: Record<string, unknown> | null
    raw?: string
    parseError?: string
  }>
}

type RpcProgramAccount = {
  pubkey: string
  account: {
    data?: [string, string] | string
    executable?: boolean
    lamports?: number
    owner?: string
    rentEpoch?: number
  }
}

type ProgramAccountsRpcResult = {
  slot: number
  accounts: RpcProgramAccount[]
  paginationKey: string | null
  method: 'getProgramAccounts' | 'getProgramAccountsV2'
}

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

export function normalizeProgramAccountsQuery(input: ProgramAccountsQuery): Required<Pick<ProgramAccountsQuery, 'limit' | 'includeRaw'>> & ProgramAccountsQuery {
  const limit = input.limit == null ? DEFAULT_LIMIT : Math.min(Math.max(Math.trunc(input.limit), 1), MAX_LIMIT)
  return { ...input, limit, includeRaw: input.includeRaw === true }
}

function isHeliusRpcUrl(rpcUrl: string): boolean {
  try {
    return new URL(rpcUrl).hostname.endsWith('helius-rpc.com')
  } catch {
    return false
  }
}

function shouldRetryWithV2(message: string): boolean {
  return /getProgramAccountsV2|account index service overloaded|pagination/i.test(message)
}

export function getFixedAnchorTypeSize(type: any, idl: AnchorIDL, depth = 0): number | null {
  if (depth > 10) return null

  if (typeof type === 'string') {
    switch (type) {
      case 'u8':
      case 'i8':
      case 'bool':
        return 1
      case 'u16':
      case 'i16':
        return 2
      case 'u32':
      case 'i32':
      case 'f32':
        return 4
      case 'u64':
      case 'i64':
      case 'f64':
        return 8
      case 'u128':
      case 'i128':
        return 16
      case 'publicKey':
      case 'pubkey':
        return 32
      case 'string':
      case 'bytes':
        return null
      default:
        return null
    }
  }

  if (!type || typeof type !== 'object') return null

  if (type.option !== undefined) {
    const inner = getFixedAnchorTypeSize(type.option, idl, depth + 1)
    return inner == null ? null : 1 + inner
  }

  if (type.vec !== undefined) return null

  if (type.array !== undefined) {
    const [innerType, count] = type.array as [any, number]
    const inner = getFixedAnchorTypeSize(innerType, idl, depth + 1)
    return inner == null ? null : inner * count
  }

  const definedName = getDefinedTypeName(type)
  if (definedName) {
    const typeDef = lookupType(idl, definedName)
    if (!typeDef || typeDef.type?.kind !== 'struct' || !typeDef.type.fields?.length) return null
    let total = 0
    for (const field of typeDef.type.fields) {
      const fieldType = typeof field === 'string' ? field : field.type
      const size = getFixedAnchorTypeSize(fieldType, idl, depth + 1)
      if (size == null) return null
      total += size
    }
    return total
  }

  return null
}

export function getAnchorAccountLayout(
  idl: AnchorIDL,
  accountType: string,
): { account: AnchorAccount; size: number | null; fieldOffsets: Record<string, number> } | null {
  const account = (idl.accounts || []).find((acc) => acc.name === accountType)
  if (!account) return null

  const resolved = resolveAccountFields(idl, account)
  let offset = 8
  const fieldOffsets: Record<string, number> = {}

  for (const field of resolved.fields) {
    const size = getFixedAnchorTypeSize(field.type, idl)
    if (size == null) return { account, size: null, fieldOffsets }
    fieldOffsets[field.name] = offset
    offset += size
  }

  return { account, size: offset, fieldOffsets }
}

function getFixedCodamaTypeSize(type: CodamaTypeNode, idl: CodamaIDL, depth = 0): number | null {
  if (depth > 12) return null

  switch (type.kind) {
    case 'numberTypeNode':
      switch (type.format) {
        case 'u8':
        case 'i8':
          return 1
        case 'u16':
        case 'i16':
          return 2
        case 'u32':
        case 'i32':
        case 'f32':
          return 4
        case 'u64':
        case 'i64':
        case 'f64':
          return 8
        case 'u128':
        case 'i128':
          return 16
        default:
          return null
      }
    case 'publicKeyTypeNode':
      return 32
    case 'booleanTypeNode':
      return 1
    case 'stringTypeNode':
    case 'bytesTypeNode':
    case 'mapTypeNode':
    case 'setTypeNode':
      return null
    case 'optionTypeNode': {
      const inner = getFixedCodamaTypeSize(type.item, idl, depth + 1)
      if (inner == null) return null
      const prefix = type.prefix ? getFixedCodamaTypeSize(type.prefix, idl, depth + 1) : 1
      return prefix == null ? null : prefix + inner
    }
    case 'zeroableOptionTypeNode':
      return getFixedCodamaTypeSize(type.item, idl, depth + 1)
    case 'arrayTypeNode': {
      if (type.count.kind !== 'fixedCountNode') return null
      const inner = getFixedCodamaTypeSize(type.item, idl, depth + 1)
      return inner == null ? null : inner * type.count.value
    }
    case 'structTypeNode': {
      let total = 0
      for (const field of type.fields || []) {
        const size = getFixedCodamaTypeSize(field.type, idl, depth + 1)
        if (size == null) return null
        total += size
      }
      return total
    }
    case 'tupleTypeNode': {
      let total = 0
      for (const item of type.items || []) {
        const size = getFixedCodamaTypeSize(item, idl, depth + 1)
        if (size == null) return null
        total += size
      }
      return total
    }
    case 'definedTypeLinkNode': {
      const typeDef = (idl.program.definedTypes || []).find((t) => t.name === type.name)
      return typeDef ? getFixedCodamaTypeSize(typeDef.type, idl, depth + 1) : null
    }
    case 'enumTypeNode':
      return null
    default:
      return null
  }
}

function codamaDiscriminatorBytes(discriminator: any): number[] {
  if (!discriminator) return []
  if (Array.isArray(discriminator.bytes)) return discriminator.bytes
  if (typeof discriminator.bytes === 'string') {
    try {
      return Array.from(bs58.decode(discriminator.bytes))
    } catch {
      return []
    }
  }
  if (Array.isArray(discriminator.value)) return discriminator.value
  return []
}

export function getCodamaAccountLayout(
  idl: CodamaIDL,
  accountType: string,
): { account: CodamaIDL['program']['accounts'][number]; size: number | null; fieldOffsets: Record<string, number>; startOffset: number; discriminatorBytes: number[]; sizeDiscriminator?: number } | null {
  const account = (idl.program.accounts || []).find((acc) => acc.name === accountType)
  if (!account) return null

  const discriminators = (account.discriminators || []) as any[]
  const sizeDisc = discriminators.find((d) => d.kind === 'sizeDiscriminatorNode')
  const constantDisc = discriminators.find((d) => d.kind === 'constantDiscriminatorNode' || d.kind === 'accountDiscriminatorNode')
  const discriminatorBytes = codamaDiscriminatorBytes(constantDisc)
  const startOffset = sizeDisc ? 0 : discriminatorBytes.length || 8
  let offset = startOffset
  const fieldOffsets: Record<string, number> = {}

  if (account.data?.kind === 'structTypeNode') {
    for (const field of account.data.fields || []) {
      const size = getFixedCodamaTypeSize(field.type, idl)
      if (size == null) {
        return {
          account,
          size: typeof sizeDisc?.size === 'number' ? sizeDisc.size : null,
          fieldOffsets,
          startOffset,
          discriminatorBytes,
          sizeDiscriminator: typeof sizeDisc?.size === 'number' ? sizeDisc.size : undefined,
        }
      }
      fieldOffsets[field.name] = offset
      offset += size
    }
  }

  return {
    account,
    size: typeof sizeDisc?.size === 'number' ? sizeDisc.size : offset,
    fieldOffsets,
    startOffset,
    discriminatorBytes,
    sizeDiscriminator: typeof sizeDisc?.size === 'number' ? sizeDisc.size : undefined,
  }
}

async function getAnchorDiscriminatorBytes(account: AnchorAccount): Promise<number[]> {
  if (account.discriminator?.length) return account.discriminator.slice(0, 8)
  return Array.from(await computeAccountDiscriminator(account.name))
}

async function buildProgramAccountFilters(
  idl: AnchorIDL | CodamaIDL,
  input: ProgramAccountsQuery,
): Promise<{ rpcFilters: Array<{ dataSize: number } | { memcmp: { offset: number; bytes: string } }>; filtersApplied: ProgramAccountsQueryResult['filtersApplied']; anchorLayout?: ReturnType<typeof getAnchorAccountLayout>; codamaLayout?: ReturnType<typeof getCodamaAccountLayout> }> {
  const rpcFilters: Array<{ dataSize: number } | { memcmp: { offset: number; bytes: string } }> = []
  const filtersApplied: ProgramAccountsQueryResult['filtersApplied'] = []
  let anchorLayout: ReturnType<typeof getAnchorAccountLayout> | undefined
  let codamaLayout: ReturnType<typeof getCodamaAccountLayout> | undefined

  if (input.accountType) {
    if (detectIDLFormat(idl) === 'codama') {
      codamaLayout = getCodamaAccountLayout(idl as CodamaIDL, input.accountType)
      if (!codamaLayout) throw new Error(`Account type "${input.accountType}" not found in IDL`)
      if (codamaLayout.sizeDiscriminator != null && input.dataSize == null) {
        rpcFilters.push({ dataSize: codamaLayout.sizeDiscriminator })
        filtersApplied.push({ type: 'dataSize', dataSize: codamaLayout.sizeDiscriminator })
      }
      if (codamaLayout.discriminatorBytes.length > 0) {
        const bytes = bs58.encode(Uint8Array.from(codamaLayout.discriminatorBytes))
        rpcFilters.push({ memcmp: { offset: 0, bytes } })
        filtersApplied.push({ type: 'memcmp', offset: 0, bytes, source: `accountType:${input.accountType}` })
      } else if (codamaLayout.sizeDiscriminator == null) {
        const bytes = bs58.encode(await computeAccountDiscriminator(input.accountType))
        rpcFilters.push({ memcmp: { offset: 0, bytes } })
        filtersApplied.push({ type: 'memcmp', offset: 0, bytes, source: `accountType:${input.accountType}` })
      }
    } else {
      anchorLayout = getAnchorAccountLayout(idl as AnchorIDL, input.accountType)
      if (!anchorLayout) throw new Error(`Account type "${input.accountType}" not found in IDL`)
      const bytes = bs58.encode(Uint8Array.from(await getAnchorDiscriminatorBytes(anchorLayout.account)))
      rpcFilters.push({ memcmp: { offset: 0, bytes } })
      filtersApplied.push({ type: 'memcmp', offset: 0, bytes, source: `accountType:${input.accountType}` })
      if (anchorLayout.size != null && input.dataSize == null) {
        rpcFilters.push({ dataSize: anchorLayout.size })
        filtersApplied.push({ type: 'dataSize', dataSize: anchorLayout.size })
      }
    }
  }

  if (input.dataSize != null) {
    rpcFilters.push({ dataSize: input.dataSize })
    filtersApplied.push({ type: 'dataSize', dataSize: input.dataSize })
  }

  for (const filter of input.memcmp || []) {
    rpcFilters.push({ memcmp: { offset: filter.offset, bytes: filter.bytes } })
    filtersApplied.push({ type: 'memcmp', offset: filter.offset, bytes: filter.bytes, source: 'memcmp' })
  }

  for (const filter of input.fieldFilters || []) {
    if (!input.accountType) throw new Error('fieldFilters require accountType so field offsets can be resolved')
    const offset = anchorLayout?.fieldOffsets[filter.field] ?? codamaLayout?.fieldOffsets[filter.field]
    if (offset == null) throw new Error(`Field "${filter.field}" not found or is not offset-resolvable for account type "${input.accountType}"`)
    rpcFilters.push({ memcmp: { offset, bytes: filter.bytes } })
    filtersApplied.push({ type: 'memcmp', offset, bytes: filter.bytes, source: `field:${filter.field}` })
  }

  return { rpcFilters, filtersApplied, anchorLayout, codamaLayout }
}

async function decodeProgramAccount(
  rawBase64: string,
  idl: AnchorIDL | CodamaIDL,
  input: ProgramAccountsQuery,
  anchorLayout?: ReturnType<typeof getAnchorAccountLayout>,
  codamaLayout?: ReturnType<typeof getCodamaAccountLayout>,
): Promise<{ accountType: string | null; data: Record<string, unknown> | null; parseError?: string }> {
  const rawBytes = Uint8Array.from(atob(rawBase64), (c) => c.charCodeAt(0))
  let accountTypeName: string | null = null
  let data: Record<string, unknown> | null = null
  let parseError: string | undefined

  if (detectIDLFormat(idl) === 'codama') {
    const codamaIdl = idl as CodamaIDL
    const layout = codamaLayout ?? (input.accountType ? getCodamaAccountLayout(codamaIdl, input.accountType) : null)
    if (layout) {
      accountTypeName = layout.account.name
      try {
        data = deserializeCodamaAccountData(rawBytes, layout.account.data, codamaIdl, layout.startOffset)
      } catch (err) {
        parseError = (err as Error).message
      }
    } else {
      const detected = await detectCodamaAccountType(rawBytes, codamaIdl)
      if (detected) {
        accountTypeName = detected.name
        try {
          data = deserializeCodamaAccountData(rawBytes, detected.data, codamaIdl, detected.startOffset)
        } catch (err) {
          parseError = (err as Error).message
        }
      }
    }
  } else {
    const anchorIdl = idl as AnchorIDL
    const account = anchorLayout?.account ?? (input.accountType ? getAnchorAccountLayout(anchorIdl, input.accountType)?.account : null)
    if (account) {
      accountTypeName = account.name
      try {
        data = deserializeAccountData(rawBytes, account, anchorIdl)
      } catch (err) {
        parseError = (err as Error).message
      }
    } else {
      const detected = await detectAccountType(rawBytes, anchorIdl)
      if (detected) {
        accountTypeName = detected.name
        try {
          data = deserializeAccountData(rawBytes, detected, anchorIdl)
        } catch (err) {
          parseError = (err as Error).message
        }
      }
    }
  }

  return { accountType: accountTypeName, data, parseError }
}

export async function queryProgramAccounts(opts: {
  idl: AnchorIDL | CodamaIDL
  programId: string
  rpcUrl: string
  cluster: ResolvedCluster
  input: ProgramAccountsQuery
}): Promise<ProgramAccountsQueryResult> {
  const input = normalizeProgramAccountsQuery(opts.input)
  const { rpcFilters, filtersApplied, anchorLayout, codamaLayout } = await buildProgramAccountFilters(opts.idl, input)

  const fetchPage = async (method: 'getProgramAccounts' | 'getProgramAccountsV2'): Promise<ProgramAccountsRpcResult> => {
    const config: Record<string, unknown> = {
      encoding: 'base64',
      withContext: true,
      commitment: 'confirmed',
      filters: rpcFilters,
    }

    if (method === 'getProgramAccountsV2') {
      config.limit = input.limit
      if (input.paginationKey) config.paginationKey = input.paginationKey
      if (input.changedSinceSlot != null) config.changedSinceSlot = input.changedSinceSlot
    }

    const response = await fetch(opts.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: [opts.programId, config],
      }),
    })

    if (!response.ok) {
      throw new Error(`RPC request failed: HTTP ${response.status}`)
    }

    const json = (await response.json()) as {
      result?:
        | { context?: { slot?: number }; value?: RpcProgramAccount[] }
        | { context?: { slot?: number }; value?: { accounts?: RpcProgramAccount[]; paginationKey?: string | null } }
        | { accounts?: RpcProgramAccount[]; paginationKey?: string | null }
        | RpcProgramAccount[]
      error?: { message?: string }
    }

    if (json.error) {
      throw new Error(`RPC error: ${json.error.message ?? JSON.stringify(json.error)}`)
    }

    if (Array.isArray(json.result)) {
      return { slot: 0, accounts: json.result, paginationKey: null, method }
    }

    const result = json.result as any
    const slot = result?.context?.slot ?? 0
    if (Array.isArray(result?.value)) {
      return { slot, accounts: result.value, paginationKey: null, method }
    }
    if (result?.value && typeof result.value === 'object') {
      return {
        slot,
        accounts: result.value.accounts ?? [],
        paginationKey: result.value.paginationKey ?? null,
        method,
      }
    }
    return {
      slot,
      accounts: result?.accounts ?? [],
      paginationKey: result?.paginationKey ?? null,
      method,
    }
  }

  let rpcResult: ProgramAccountsRpcResult
  if (isHeliusRpcUrl(opts.rpcUrl) || input.paginationKey || input.changedSinceSlot != null) {
    rpcResult = await fetchPage('getProgramAccountsV2')
  } else {
    try {
      rpcResult = await fetchPage('getProgramAccounts')
    } catch (err) {
      const message = (err as Error).message
      if (!shouldRetryWithV2(message)) throw err
      rpcResult = await fetchPage('getProgramAccountsV2')
    }
  }

  const limited = rpcResult.accounts.slice(0, input.limit)

  const accounts = []
  for (const item of limited) {
    const dataField = item.account.data
    const rawBase64 = Array.isArray(dataField) ? dataField[0] : typeof dataField === 'string' ? dataField : ''
    const decoded = rawBase64
      ? await decodeProgramAccount(rawBase64, opts.idl, input, anchorLayout, codamaLayout)
      : { accountType: null, data: null }

    accounts.push({
      address: item.pubkey,
      lamports: item.account.lamports ?? 0,
      owner: item.account.owner ?? '',
      executable: item.account.executable ?? false,
      rentEpoch: item.account.rentEpoch ?? 0,
      accountType: decoded.accountType,
      data: decoded.data,
      ...(input.includeRaw || decoded.parseError || decoded.accountType == null ? { raw: rawBase64 } : {}),
      ...(decoded.parseError ? { parseError: decoded.parseError } : {}),
    })
  }

  return {
    programId: opts.programId,
    cluster: opts.cluster,
    slot: rpcResult.slot,
    paginationKey: rpcResult.paginationKey,
    rpcMethod: rpcResult.method,
    filtersApplied,
    count: accounts.length,
    accounts,
  }
}
