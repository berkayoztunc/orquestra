import {
  describeCodamaDiscriminator,
  detectIDLFormat,
  expandInstructionArgs,
  getCodamaUserArgs,
  getDefaultValue,
  normalizeAccountMeta,
  resolveAccountFields,
  resolveCodamaAccountFields,
  resolveCodamaType,
  resolveEventFields,
  resolveType,
} from './idl-parser'
import type { AnchorIDL, CodamaIDL } from './idl-parser'
import { listCodamaPdaAccounts, listPdaAccounts } from './pda'
import { generateDocumentation } from './doc-generator'

export const IDL_SUMMARY_SCHEMA_VERSION = 1
export const IDL_SUMMARY_TTL_SECONDS = 604800

export interface IdlSummary {
  schemaVersion: 1
  projectId: string
  programId: string
  version: number | null
  idlStandard: 'anchor' | 'codama'
  programName: string | undefined
  instructions: unknown[]
  instructionDetails: Record<string, unknown>
  accounts: unknown[]
  errors: unknown[]
  events: unknown[]
  types: unknown[]
  pdaAccounts: unknown[]
  docs?: IdlSummaryDocs
}

export interface IdlSummaryDocs {
  full: string
  overview: string
  instructions: string
  accounts: string
  programAccounts: string
  types: string
  errors: string
  events: string
}

export interface SummaryProjectRow {
  id: string
  program_id: string
  is_public: number | boolean
}

export interface SummaryVersionRow {
  idl_json: string
  cpi_md?: string | null
  version?: number | null
  idl_standard?: string | null
}

type KVLike = {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete?(key: string): Promise<void>
}

export function idlSummaryCacheKey(projectId: string, version: number | string | null = 'latest'): string {
  return `idl-summary:${projectId}:${version ?? 'latest'}`
}

export function buildIdlSummary(opts: {
  projectId: string
  programId: string
  version?: number | null
  idl: AnchorIDL | CodamaIDL
  docs?: IdlSummaryDocs
}): IdlSummary {
  if (detectIDLFormat(opts.idl as unknown) === 'codama') {
    return buildCodamaSummary(opts.projectId, opts.programId, opts.version ?? null, opts.idl as CodamaIDL, opts.docs)
  }
  return buildAnchorSummary(opts.projectId, opts.programId, opts.version ?? null, opts.idl as AnchorIDL, opts.docs)
}

export async function writeIdlSummaryCache(opts: {
  kv: KVLike | undefined
  projectId: string
  programId: string
  version?: number | null
  idl: AnchorIDL | CodamaIDL
  docs?: IdlSummaryDocs
}): Promise<void> {
  if (!opts.kv) return

  const summary = buildIdlSummary({
    projectId: opts.projectId,
    programId: opts.programId,
    version: opts.version ?? null,
    idl: opts.idl,
    docs: opts.docs,
  })
  const value = JSON.stringify(summary)
  await opts.kv.put(idlSummaryCacheKey(opts.projectId), value, { expirationTtl: IDL_SUMMARY_TTL_SECONDS })
  if (opts.version != null) {
    await opts.kv.put(idlSummaryCacheKey(opts.projectId, opts.version), value, { expirationTtl: IDL_SUMMARY_TTL_SECONDS })
  }
}

export async function deleteIdlSummaryCache(kv: KVLike | undefined, projectId: string): Promise<void> {
  if (!kv?.delete) return
  await kv.delete(idlSummaryCacheKey(projectId))
}

export async function readIdlSummaryCache(opts: {
  kv: KVLike | undefined
  projectId: string
  programId: string
  version?: number | null
}): Promise<IdlSummary | null> {
  return readCachedSummary(
    opts.kv,
    idlSummaryCacheKey(opts.projectId, opts.version ?? 'latest'),
    opts.projectId,
    opts.programId,
  )
}

export async function getPublicIdlSummary(opts: {
  db: any
  kv: KVLike | undefined
  projectId: string
  version?: number | null
  apiBaseUrl?: string
  includeDocs?: boolean
}): Promise<IdlSummary | null> {
  const project = await opts.db
    ?.prepare('SELECT id, program_id, is_public FROM projects WHERE id = ?')
    .bind(opts.projectId)
    .first() as SummaryProjectRow | null

  if (!project || !project.is_public) return null

  const versionKey = opts.version ?? null
  const cacheKey = idlSummaryCacheKey(opts.projectId, versionKey ?? 'latest')
  const cached = await readCachedSummary(opts.kv, cacheKey, opts.projectId, project.program_id)
  if (cached && (!opts.includeDocs || cached.docs)) return cached

  const row = await fetchSummaryVersionRow(opts.db, opts.projectId, versionKey)
  if (!row) return null

  const idl = JSON.parse(row.idl_json) as AnchorIDL | CodamaIDL
  const docs = opts.includeDocs && opts.apiBaseUrl
    ? generateDocumentation(idl, project.program_id, opts.apiBaseUrl, opts.projectId, row.cpi_md ?? null)
    : undefined
  const summary = buildIdlSummary({
    projectId: opts.projectId,
    programId: project.program_id,
    version: row.version ?? versionKey,
    idl,
    docs,
  })

  if (opts.kv) {
    await opts.kv.put(cacheKey, JSON.stringify(summary), { expirationTtl: IDL_SUMMARY_TTL_SECONDS })
  }

  return summary
}

async function readCachedSummary(
  kv: KVLike | undefined,
  cacheKey: string,
  projectId: string,
  programId: string,
): Promise<IdlSummary | null> {
  if (!kv) return null

  try {
    const raw = await kv.get(cacheKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as IdlSummary
    if (
      parsed?.schemaVersion === IDL_SUMMARY_SCHEMA_VERSION &&
      parsed.projectId === projectId &&
      parsed.programId === programId &&
      Array.isArray(parsed.instructions) &&
      Array.isArray(parsed.accounts)
    ) {
      return parsed
    }
  } catch {
    if (kv.delete) {
      await kv.delete(cacheKey)
    }
  }

  return null
}

async function fetchSummaryVersionRow(db: any, projectId: string, version: number | null): Promise<SummaryVersionRow | null> {
  if (version != null) {
    return await db
      ?.prepare('SELECT idl_json, cpi_md, version, idl_standard FROM idl_versions WHERE project_id = ? AND version = ?')
      .bind(projectId, version)
      .first()
  }

  return await db
    ?.prepare('SELECT idl_json, cpi_md, version, idl_standard FROM idl_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1')
    .bind(projectId)
    .first()
}

function buildAnchorSummary(projectId: string, programId: string, version: number | null, idl: AnchorIDL, docs?: IdlSummaryDocs): IdlSummary {
  const instructions = idl.instructions.map((ix) => ({
    name: ix.name,
    docs: Array.isArray(ix.docs) ? ix.docs.filter((d) => typeof d === 'string') : [],
    accountCount: ix.accounts?.length || 0,
    argCount: ix.args?.length || 0,
    accounts: ix.accounts.map((a) => {
      const norm = normalizeAccountMeta(a)
      return {
        name: norm.name,
        isMut: norm.isMut,
        isSigner: norm.isSigner,
        isOptional: norm.isOptional,
      }
    }),
    args: expandInstructionArgs(idl, ix.args).map((a) => ({
      name: a.name,
      type: a.typeStr,
      isDefinedType: a.isDefinedType,
      definedTypeName: a.definedTypeName,
      fields: a.fields ? a.fields.map((f) => ({
        name: f.name,
        type: f.typeStr,
        isDefinedType: f.isDefinedType,
        nestedFields: f.nestedFields,
      })) : null,
    })),
  }))

  const instructionDetails = Object.fromEntries(idl.instructions.map((ix) => [
    ix.name,
    {
      name: ix.name,
      docs: Array.isArray(ix.docs) ? ix.docs.filter((d) => typeof d === 'string') : [],
      accounts: ix.accounts.map((a) => {
        const norm = normalizeAccountMeta(a)
        return {
          name: norm.name,
          isMut: norm.isMut,
          isSigner: norm.isSigner,
          isOptional: norm.isOptional,
          pda: a.pda || null,
        }
      }),
      args: expandInstructionArgs(idl, ix.args).map((a) => ({
        name: a.name,
        type: a.typeStr,
        defaultValue: getDefaultValue(a.type, idl),
        isDefinedType: a.isDefinedType,
        definedTypeName: a.definedTypeName,
        fields: a.fields ? a.fields.map((f) => ({
          name: f.name,
          type: f.typeStr,
          isDefinedType: f.isDefinedType,
          nestedFields: f.nestedFields,
        })) : null,
      })),
    },
  ]))

  const accounts = (idl.accounts || []).map((acc) => {
    const resolved = resolveAccountFields(idl, acc)
    return {
      name: acc.name,
      kind: resolved.kind,
      docs: acc.docs || [],
      discriminator: acc.discriminator || [],
      fields: resolved.fields.map((f) => ({
        name: f.name,
        type: f.typeStr,
      })),
    }
  })

  const events = (idl.events || []).map((event) => {
    const resolved = resolveEventFields(idl, event)
    return {
      name: event.name,
      discriminator: event.discriminator || [],
      fields: resolved.fields.map((f) => ({
        name: f.name,
        type: f.typeStr,
      })),
    }
  })

  const types = (idl.types || []).map((t) => ({
    name: t.name,
    kind: t.type?.kind || 'unknown',
    fields: (t.type?.fields || [])
      .filter((f): f is { name: string; type: any } => typeof f === 'object' && f !== null && 'name' in f && 'type' in f)
      .map((f) => ({
        name: f.name,
        type: resolveType(f.type),
      })),
  }))

  return {
    schemaVersion: IDL_SUMMARY_SCHEMA_VERSION,
    projectId,
    programId,
    version,
    idlStandard: 'anchor',
    programName: idl.name,
    instructions,
    instructionDetails,
    accounts,
    errors: idl.errors || [],
    events,
    types,
    pdaAccounts: listPdaAccounts(idl),
    docs,
  }
}

function buildCodamaSummary(projectId: string, programId: string, version: number | null, idl: CodamaIDL, docs?: IdlSummaryDocs): IdlSummary {
  const prog = idl.program
  const instructions = prog.instructions.map((ix) => {
    const userArgs = getCodamaUserArgs(ix)
    const userAccounts = ix.accounts.filter(
      (a) => !a.defaultValue || a.defaultValue.kind !== 'publicKeyValueNode'
    )
    return {
      name: ix.name,
      docs: Array.isArray(ix.docs) ? ix.docs.filter((d) => typeof d === 'string') : [],
      accountCount: userAccounts.length,
      argCount: userArgs.length,
      accounts: userAccounts.map((a) => ({
        name: a.name,
        isMut: a.isWritable,
        isSigner: a.isSigner === true || a.isSigner === 'either',
        isOptional: !!a.isOptional,
      })),
      args: userArgs.map((a) => {
        const isDefinedType = a.type.kind === 'definedTypeLinkNode'
        return {
          name: a.name,
          type: resolveCodamaType(a.type),
          isDefinedType,
          definedTypeName: isDefinedType ? (a.type as any).name : null,
          fields: a.type.kind === 'structTypeNode'
            ? (a.type as any).fields.map((f: any) => ({
              name: f.name,
              type: resolveCodamaType(f.type),
              isDefinedType: false,
              nestedFields: null,
            }))
            : null,
        }
      }),
    }
  })

  const instructionDetails = Object.fromEntries(prog.instructions.map((ix) => {
    const userArgs = getCodamaUserArgs(ix)
    const userAccounts = ix.accounts.filter(
      (a) => !a.defaultValue || a.defaultValue.kind !== 'publicKeyValueNode'
    )
    return [
      ix.name,
      {
        name: ix.name,
        docs: Array.isArray(ix.docs) ? ix.docs.filter((d) => typeof d === 'string') : [],
        accounts: userAccounts.map((a) => ({
          name: a.name,
          isMut: a.isWritable,
          isSigner: a.isSigner === true || a.isSigner === 'either',
          isOptional: !!a.isOptional,
          pda: null,
        })),
        args: userArgs.map((a) => {
          const isDefinedType = a.type.kind === 'definedTypeLinkNode'
          return {
            name: a.name,
            type: resolveCodamaType(a.type),
            defaultValue: null,
            isDefinedType,
            definedTypeName: isDefinedType ? (a.type as any).name : null,
            fields: null,
          }
        }),
      },
    ]
  }))

  const accounts = (prog.accounts || []).map((acc) => {
    const discInfo = describeCodamaDiscriminator((acc.discriminators || []) as any[])
    const accFields = resolveCodamaAccountFields(acc as any)
    return {
      name: acc.name,
      kind: accFields.kind,
      docs: acc.docs || [],
      discriminator: (acc.discriminators || []).flatMap((d: any) => d.bytes || []),
      discriminatorKind: discInfo.kind,
      discriminatorValue: discInfo.value,
      size: (acc as any).size ?? null,
      fields: accFields.fields.map((f) => ({ name: f.name, type: f.typeStr, docs: f.docs })),
    }
  })

  const events = (prog.events || []).map((e: any) => ({
    name: e.name || e.kind || 'unknown',
    discriminator: [],
    fields: (e.fields || []).map((f: any) => ({
      name: f.name,
      type: f.type ? resolveCodamaType(f.type) : 'unknown',
    })),
  }))

  const types = (prog.definedTypes || []).map((t) => ({
    name: t.name,
    kind: t.type.kind === 'structTypeNode' ? 'struct' : t.type.kind === 'enumTypeNode' ? 'enum' : 'unknown',
    fields: t.type.kind === 'structTypeNode'
      ? (t.type as any).fields.map((f: any) => ({
        name: f.name,
        type: resolveCodamaType(f.type),
      }))
      : [],
  }))

  return {
    schemaVersion: IDL_SUMMARY_SCHEMA_VERSION,
    projectId,
    programId,
    version,
    idlStandard: 'codama',
    programName: prog.name,
    instructions,
    instructionDetails,
    accounts,
    errors: (prog.errors || []).map((e) => ({ name: e.name, code: e.code, msg: e.message })),
    events,
    types,
    pdaAccounts: listCodamaPdaAccounts(idl),
    docs,
  }
}

export function getInstructionSummary(summary: IdlSummary, instructionName: string): unknown | null {
  return summary.instructionDetails[instructionName] ?? null
}
