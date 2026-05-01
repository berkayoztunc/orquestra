/**
 * IDL Parser Service - Validates, parses, and processes Anchor IDL files.
 * Supports both Anchor IDL format and the Codama IDL standard natively.
 */

// ─── Codama types (defined inline — worker doesn't import @shared at runtime) ──

export type IDLStandard = 'anchor' | 'codama'

export type CodamaTypeNode =
  | { kind: 'numberTypeNode'; format: 'u8'|'u16'|'u32'|'u64'|'u128'|'i8'|'i16'|'i32'|'i64'|'i128'|'f32'|'f64'; endian?: 'le'|'be' }
  | { kind: 'publicKeyTypeNode' }
  | { kind: 'booleanTypeNode' }
  | { kind: 'stringTypeNode'; encoding?: string }
  | { kind: 'bytesTypeNode' }
  | { kind: 'definedTypeLinkNode'; name: string }
  | { kind: 'optionTypeNode'; item: CodamaTypeNode; prefix?: CodamaTypeNode }
  | { kind: 'zeroableOptionTypeNode'; item: CodamaTypeNode }
  | { kind: 'arrayTypeNode'; item: CodamaTypeNode; count: { kind: 'fixedCountNode'; value: number } | { kind: 'prefixedCountNode'; prefix: CodamaTypeNode } | { kind: 'remainderCountNode' } }
  | { kind: 'structTypeNode'; fields: Array<{ kind: string; name: string; type: CodamaTypeNode; defaultValue?: CodamaValueNode; defaultValueStrategy?: 'optional'|'omitted'; docs?: string[] }> }
  | { kind: 'enumTypeNode'; variants: Array<{ kind: string; name: string; fields?: any[]; items?: any[] }>; size?: CodamaTypeNode }
  | { kind: 'tupleTypeNode'; items: CodamaTypeNode[] }
  | { kind: 'mapTypeNode'; key: CodamaTypeNode; value: CodamaTypeNode; count: any }
  | { kind: 'setTypeNode'; item: CodamaTypeNode; count: any }

export type CodamaValueNode =
  | { kind: 'publicKeyValueNode'; publicKey: string }
  | { kind: 'numberValueNode'; number: number }
  | { kind: 'booleanValueNode'; boolean: boolean }
  | { kind: 'stringValueNode'; string: string }
  | { kind: 'noneValueNode' }
  | { kind: string; [key: string]: any }

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
  name?: string
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

export interface CodamaProgram {
  kind?: 'programNode'
  name: string
  publicKey: string
  version: string
  instructions: CodamaInstruction[]
  accounts: Array<{ kind?: string; name: string; data: CodamaTypeNode; discriminators?: CodamaDiscriminator[]; docs?: string[] }>
  definedTypes: Array<{ kind?: string; name: string; type: CodamaTypeNode; docs?: string[] }>
  pdas: Array<{ kind?: string; name: string; seeds: Array<{ kind: string; name?: string; type?: CodamaTypeNode; value?: CodamaValueNode; bytes?: string }>; docs?: string[] }>
  errors: Array<{ kind?: string; name: string; code: number; message: string; docs?: string[] }>
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

// ─── Codama detection ─────────────────────────────────────────────────────────

/**
 * Detect whether a raw IDL object follows the Codama standard or the Anchor format.
 */
export function detectIDLFormat(raw: unknown): IDLStandard {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>
    if (r.kind === 'rootNode' && r.standard === 'codama') return 'codama'
  }
  return 'anchor'
}

/**
 * Validate a Codama IDL structure.
 */
export function validateCodamaIDL(raw: unknown): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Codama IDL must be a JSON object'], warnings }
  }

  const r = raw as Record<string, unknown>
  const program = r.program as Record<string, unknown> | undefined

  if (!program || typeof program !== 'object') {
    errors.push('Codama IDL must have a "program" object')
    return { valid: false, errors, warnings }
  }

  if (!program.name || typeof program.name !== 'string') {
    errors.push('Codama IDL program must have a "name" field')
  }
  if (!r.version || typeof r.version !== 'string') {
    warnings.push('Codama IDL has no root-level "version" field')
  }
  if (!Array.isArray(program.instructions)) {
    errors.push('Codama IDL program must have an "instructions" array')
  } else {
    for (let i = 0; i < program.instructions.length; i++) {
      const ix = program.instructions[i] as Record<string, unknown>
      if (!ix.name || typeof ix.name !== 'string') {
        errors.push(`Codama instruction at index ${i} must have a "name" field`)
      }
      if (!Array.isArray(ix.accounts)) {
        errors.push(`Codama instruction "${ix.name || i}" must have an "accounts" array`)
      }
      if (!Array.isArray(ix.arguments)) {
        errors.push(`Codama instruction "${ix.name || i}" must have an "arguments" array`)
      }
    }
  }

  if (!Array.isArray(program.errors) || program.errors.length === 0) {
    warnings.push('Codama IDL has no "errors" definitions')
  }
  if (!Array.isArray(program.definedTypes) || program.definedTypes.length === 0) {
    warnings.push('Codama IDL has no "definedTypes" definitions')
  }
  if (!Array.isArray(program.pdas) || program.pdas.length === 0) {
    warnings.push('Codama IDL has no "pdas" definitions')
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Parse a Codama IDL into a ParsedIDL.
 */
export function parseCodamaIDL(raw: CodamaIDL): ParsedIDL {
  const program = raw.program
  return {
    idl: raw as unknown as AnchorIDL,   // stored raw, cast for ParsedIDL compat
    programName: program.name || 'unknown',
    version: raw.version || program.version || 'unknown',
    instructionCount: program.instructions?.length || 0,
    accountCount: program.accounts?.length || 0,
    errorCount: program.errors?.length || 0,
    eventCount: program.events?.length || 0,
  }
}

/**
 * Get a Codama instruction by name (camelCase and snake_case fuzzy match).
 */
export function getCodamaInstruction(idl: CodamaIDL, name: string): CodamaInstruction | undefined {
  return idl.program.instructions.find(
    (ix) => ix.name === name || ix.name === toCamelCase(name) || ix.name === toSnakeCase(name)
  )
}

/**
 * Resolve a Codama type node to a human-readable string.
 */
export function resolveCodamaType(type: CodamaTypeNode | undefined | null): string {
  if (!type) return 'unknown'
  switch (type.kind) {
    case 'numberTypeNode': return type.format
    case 'publicKeyTypeNode': return 'publicKey'
    case 'booleanTypeNode': return 'bool'
    case 'stringTypeNode': return 'string'
    case 'bytesTypeNode': return 'bytes'
    case 'definedTypeLinkNode': return type.name
    case 'optionTypeNode': return `Option<${resolveCodamaType(type.item)}>`
    case 'zeroableOptionTypeNode': return `Option<${resolveCodamaType(type.item)}>`
    case 'arrayTypeNode': {
      const inner = resolveCodamaType(type.item)
      if (type.count.kind === 'fixedCountNode') return `[${inner}; ${type.count.value}]`
      if (type.count.kind === 'remainderCountNode') return `[${inner}]`
      return `Vec<${inner}>`
    }
    case 'tupleTypeNode': return `(${type.items.map(resolveCodamaType).join(', ')})`
    case 'mapTypeNode': return `Map<${resolveCodamaType(type.key)}, ${resolveCodamaType(type.value)}>`
    case 'setTypeNode': return `Set<${resolveCodamaType(type.item)}>`
    case 'structTypeNode': return `{ ${type.fields.map((f) => `${f.name}: ${resolveCodamaType(f.type)}`).join(', ')} }`
    case 'enumTypeNode': return `enum { ${type.variants.map((v) => v.name).join(' | ')} }`
    default: return 'unknown'
  }
}

/**
 * Get the user-facing args of a Codama instruction.
 * Filters out args that are internal/auto-filled (defaultValueStrategy === 'omitted').
 * The discriminator arg is considered a separate concern and excluded here too
 * (identified via instruction.discriminators[]).
 */
export function getCodamaUserArgs(instruction: CodamaInstruction): CodamaInstructionArgument[] {
  // Names that are auto-discriminators (referenced in instruction.discriminators)
  const discriminatorArgNames = new Set(
    (instruction.discriminators || [])
      .filter((d) => d.kind === 'fieldDiscriminatorNode' && d.name)
      .map((d) => d.name as string)
  )
  return instruction.arguments.filter(
    (arg) => arg.defaultValueStrategy !== 'omitted' && !discriminatorArgNames.has(arg.name)
  )
}

/**
 * Extract the discriminator byte value from a Codama instruction.
 * Reads the defaultValue of the argument referenced in instruction.discriminators[0].
 * Returns a 1-element Uint8Array, or null if not found.
 */
export function getCodamaDiscriminatorBytes(instruction: CodamaInstruction): Uint8Array | null {
  const fieldDisc = (instruction.discriminators || []).find((d) => d.kind === 'fieldDiscriminatorNode' && d.name)
  if (!fieldDisc || !fieldDisc.name) return null

  const arg = instruction.arguments.find((a) => a.name === fieldDisc.name)
  if (!arg?.defaultValue) return null

  const dv = arg.defaultValue
  if (dv.kind === 'numberValueNode') {
    return new Uint8Array([dv.number])
  }
  return null
}

// Types imported inline to avoid path resolution issues in Workers
interface AnchorIDL {
  version?: string
  name?: string
  metadata?: any
  instructions: AnchorInstruction[]
  accounts?: AnchorAccount[]
  types?: AnchorType[]
  events?: AnchorEvent[]
  errors?: AnchorError[]
}

interface AnchorInstruction {
  name: string
  accounts: AnchorAccountMeta[]
  args: AnchorArg[]
  discriminator?: number[]
  docs?: string[]
}

interface AnchorAccountMeta {
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

/**
 * Normalize an account meta to consistent isMut/isSigner/isOptional fields.
 * Supports both old format (isMut/isSigner) and new format (writable/signer).
 */
export function normalizeAccountMeta(acc: AnchorAccountMeta): {
  name: string
  isMut: boolean
  isSigner: boolean
  isOptional: boolean
  address?: string
  pda?: AnchorAccountMeta['pda']
} {
  return {
    name: acc.name,
    isMut: acc.isMut ?? acc.writable ?? false,
    isSigner: acc.isSigner ?? acc.signer ?? false,
    isOptional: acc.isOptional ?? acc.optional ?? false,
    address: acc.address,
    pda: acc.pda,
  }
}

interface AnchorArg {
  name: string
  type: any
}

interface AnchorAccount {
  name: string
  type?: { kind: string; fields?: Array<{ name: string; type: any }> }
  discriminator?: number[]
  docs?: string[]
}

interface AnchorType {
  name: string
  type: { kind: string; fields?: Array<{ name: string; type: any } | string>; variants?: Array<{ name: string; fields?: any }> }
}

/**
 * Normalize a struct field entry.
 * Anchor IDLs may use tuple struct format where fields are bare type strings
 * (e.g. ["bool"]) instead of objects ({ name: "field_0", type: "bool" }).
 * This helper normalizes both formats to a consistent { name, type } object.
 */
export function normalizeField(
  field: { name: string; type: any } | string,
  index: number,
): { name: string; type: any } {
  if (typeof field === 'string') {
    return { name: `field_${index}`, type: field }
  }
  if (typeof field === 'object' && field !== null && !('name' in field)) {
    // Field is an unnamed type object like { vec: "u8" }
    return { name: `field_${index}`, type: field }
  }
  return field as { name: string; type: any }
}

interface AnchorEvent {
  name: string
  data?: any
  discriminator?: number[]
}

interface AnchorError {
  code: number
  name: string
  msg: string
}

export type { AnchorIDL, AnchorInstruction, AnchorAccountMeta, AnchorArg, AnchorAccount, AnchorType, AnchorEvent, AnchorError }

export interface ParsedIDL {
  idl: AnchorIDL
  programName: string
  version: string
  instructionCount: number
  accountCount: number
  errorCount: number
  eventCount: number
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null
  return value as Record<string, unknown>
}

function readStringField(obj: Record<string, unknown> | null, key: string): string | null {
  const value = obj?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function getIDLProgramName(idlJson: unknown): string | null {
  const idl = toRecord(idlJson)
  if (!idl) return null
  const metadata = toRecord(idl.metadata)
  return readStringField(metadata, 'name') || readStringField(idl, 'name')
}

export function getIDLProgramVersion(idlJson: unknown): string | null {
  const idl = toRecord(idlJson)
  if (!idl) return null
  const metadata = toRecord(idl.metadata)
  return readStringField(metadata, 'version') || readStringField(idl, 'version')
}

/**
 * Validate an IDL JSON structure — dispatches to Anchor or Codama validator.
 */
export function validateIDL(idlJson: unknown): ValidationResult {
  if (detectIDLFormat(idlJson) === 'codama') {
    return validateCodamaIDL(idlJson)
  }
  return validateAnchorIDL(idlJson)
}

/**
 * Validate an Anchor IDL JSON structure.
 */
function validateAnchorIDL(idlJson: unknown): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!idlJson || typeof idlJson !== 'object') {
    return { valid: false, errors: ['IDL must be a JSON object'], warnings }
  }

  const idl = idlJson as Record<string, unknown>
  // Required fields can exist at root or under metadata for multi-version support.
  if (!getIDLProgramVersion(idl)) {
    errors.push('IDL must have a "version" field (string)')
  }

  if (!getIDLProgramName(idl)) {
    errors.push('IDL must have a "name" field (string)')
  }

  if (!idl.instructions || !Array.isArray(idl.instructions)) {
    errors.push('IDL must have an "instructions" array')
  } else {
    // Validate each instruction
    for (let i = 0; i < idl.instructions.length; i++) {
      const ix = idl.instructions[i] as Record<string, unknown>
      if (!ix.name || typeof ix.name !== 'string') {
        errors.push(`Instruction at index ${i} must have a "name" field`)
      }
      if (!ix.accounts || !Array.isArray(ix.accounts)) {
        errors.push(`Instruction "${ix.name || i}" must have an "accounts" array`)
      }
      if (!ix.args || !Array.isArray(ix.args)) {
        errors.push(`Instruction "${ix.name || i}" must have an "args" array`)
      }
    }
  }

  // Optional but recommended fields
  if (!idl.accounts || !Array.isArray(idl.accounts)) {
    warnings.push('IDL has no "accounts" definitions')
  }

  if (!idl.errors || !Array.isArray(idl.errors)) {
    warnings.push('IDL has no "errors" definitions')
  }

  if (!idl.events || !Array.isArray(idl.events)) {
    warnings.push('IDL has no "events" definitions')
  }

  if (!idl.types || !Array.isArray(idl.types)) {
    warnings.push('IDL has no "types" definitions')
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Parse an IDL JSON into a structured format — dispatches to Anchor or Codama parser.
 */
export function parseIDL(idlJson: unknown): ParsedIDL {
  const validation = validateIDL(idlJson)
  if (!validation.valid) {
    throw new Error(`Invalid IDL: ${validation.errors.join(', ')}`)
  }

  if (detectIDLFormat(idlJson) === 'codama') {
    return parseCodamaIDL(idlJson as CodamaIDL)
  }

  const idl = idlJson as AnchorIDL
  return {
    idl,
    programName: getIDLProgramName(idl) || 'unknown',
    version: getIDLProgramVersion(idl) || 'unknown',
    instructionCount: idl.instructions?.length || 0,
    accountCount: idl.accounts?.length || 0,
    errorCount: idl.errors?.length || 0,
    eventCount: idl.events?.length || 0,
  }
}

/**
 * Get instruction by name from IDL
 */
export function getInstruction(idl: AnchorIDL, name: string): AnchorInstruction | undefined {
  return idl.instructions.find(
    (ix: AnchorInstruction) => ix.name === name || ix.name === toCamelCase(name) || ix.name === toSnakeCase(name)
  )
}

/**
 * Resolve IDL type to a human-readable string
 */
export function resolveType(type: any): string {
  if (type === null || type === undefined) {
    return 'unknown'
  }

  if (typeof type === 'string') {
    return type
  }

  if (type.vec) {
    return `Vec<${resolveType(type.vec)}>`
  }

  if (type.option) {
    return `Option<${resolveType(type.option)}>`
  }

  if (type.defined) {
    // Support both old format { defined: "Name" } and new format { defined: { name: "Name" } }
    if (typeof type.defined === 'string') {
      return type.defined
    }
    if (typeof type.defined === 'object' && type.defined.name) {
      return type.defined.name
    }
    return JSON.stringify(type.defined)
  }

  if (type.array) {
    const [innerType, size] = type.array
    return `[${resolveType(innerType)}; ${size}]`
  }

  if (type.tuple) {
    return `(${type.tuple.map(resolveType).join(', ')})`
  }

  return JSON.stringify(type)
}

/**
 * Extract the defined type name from a type reference.
 * Returns null if not a defined type.
 */
export function getDefinedTypeName(type: any): string | null {
  if (!type || typeof type === 'string') return null
  if (type.defined) {
    if (typeof type.defined === 'string') return type.defined
    if (typeof type.defined === 'object' && type.defined.name) return type.defined.name
  }
  return null
}

/**
 * Check if a type is a defined (custom struct/enum) type
 */
export function isDefinedType(type: any): boolean {
  return getDefinedTypeName(type) !== null
}

/**
 * Look up a type definition from the IDL types array by name
 */
export function lookupType(idl: AnchorIDL, typeName: string): AnchorType | undefined {
  return idl.types?.find((t) => t.name === typeName)
}

/**
 * Resolve a defined type to its full struct fields, recursively resolving nested defined types.
 * Returns null if the type is not found or is not a struct.
 */
export function resolveDefinedType(
  idl: AnchorIDL,
  typeName: string,
): { name: string; kind: string; fields: ResolvedField[] } | null {
  const typeDef = lookupType(idl, typeName)
  if (!typeDef) return null

  const kind = typeDef.type?.kind || 'unknown'

  if (kind === 'struct' && typeDef.type?.fields) {
    const fields: ResolvedField[] = typeDef.type.fields.map((f, i) => {
      const normalized = normalizeField(f, i)
      const definedName = getDefinedTypeName(normalized.type)
      const nested = definedName ? resolveDefinedType(idl, definedName) : null
      return {
        name: normalized.name,
        type: normalized.type,
        typeStr: resolveType(normalized.type),
        isDefinedType: !!definedName,
        nestedFields: nested?.fields || null,
      }
    })
    return { name: typeName, kind, fields }
  }

  // Handle enum types
  if (kind === 'enum' && typeDef.type?.variants) {
    return { name: typeName, kind, fields: [] }
  }

  return { name: typeName, kind, fields: [] }
}

export interface ResolvedField {
  name: string
  type: any
  typeStr: string
  isDefinedType: boolean
  nestedFields: ResolvedField[] | null
}

export interface ExpandedArg {
  name: string
  type: any
  typeStr: string
  isDefinedType: boolean
  definedTypeName: string | null
  fields: ResolvedField[] | null
}

/**
 * Expand instruction args, resolving any defined types to their struct fields.
 * This is used by the API to return rich arg info including struct sub-fields.
 */
export function expandInstructionArgs(idl: AnchorIDL, args: AnchorArg[]): ExpandedArg[] {
  return args.map((arg) => {
    const definedName = getDefinedTypeName(arg.type)
    if (definedName) {
      const resolved = resolveDefinedType(idl, definedName)
      return {
        name: arg.name,
        type: arg.type,
        typeStr: resolveType(arg.type),
        isDefinedType: true,
        definedTypeName: definedName,
        fields: resolved?.fields || null,
      }
    }
    return {
      name: arg.name,
      type: arg.type,
      typeStr: resolveType(arg.type),
      isDefinedType: false,
      definedTypeName: null,
      fields: null,
    }
  })
}

/**
 * Get default value for an IDL type.
 * Pass idl to resolve defined types to default struct values.
 */
export function getDefaultValue(type: any, idl?: AnchorIDL): any {
  if (typeof type === 'string') {
    switch (type) {
      case 'u8': case 'u16': case 'u32': case 'u64': case 'u128':
      case 'i8': case 'i16': case 'i32': case 'i64': case 'i128':
        return 0
      case 'f32': case 'f64':
        return 0.0
      case 'bool':
        return false
      case 'string':
        return ''
      case 'publicKey':
      case 'pubkey':
        return '11111111111111111111111111111111'
      case 'bytes':
        return []
      default:
        return null
    }
  }

  if (type.vec) return []
  if (type.option) return null
  if (type.array) return []

  // Handle defined types — return a default object with all struct fields
  const definedName = getDefinedTypeName(type)
  if (definedName && idl) {
    const resolved = resolveDefinedType(idl, definedName)
    if (resolved && resolved.fields.length > 0) {
      const obj: Record<string, any> = {}
      for (const field of resolved.fields) {
        obj[field.name] = getDefaultValue(field.type, idl)
      }
      return obj
    }
  }

  return null
}

/**
 * Resolve account fields by matching against the `types` array.
 * In new Anchor IDL format (spec 0.1.0), accounts only have name + discriminator;
 * the actual struct definition is in `types`.
 */
export function resolveAccountFields(
  idl: AnchorIDL,
  account: AnchorAccount,
): { kind: string; fields: Array<{ name: string; type: any; typeStr: string }> } {
  // Old format: account has inline type.fields
  if (account.type?.fields?.length) {
    return {
      kind: account.type.kind,
      fields: account.type.fields.map((f, i) => {
        const normalized = normalizeField(f, i)
        return {
          name: normalized.name,
          type: normalized.type,
          typeStr: resolveType(normalized.type),
        }
      }),
    }
  }

  // New format: look up by name in types array
  const typeDef = idl.types?.find((t) => t.name === account.name)
  if (typeDef?.type?.fields?.length) {
    return {
      kind: typeDef.type.kind,
      fields: typeDef.type.fields.map((f, i) => {
        const normalized = normalizeField(f, i)
        return {
          name: normalized.name,
          type: normalized.type,
          typeStr: resolveType(normalized.type),
        }
      }),
    }
  }

  return { kind: account.type?.kind || 'unknown', fields: [] }
}

/**
 * Resolve event fields by matching against the `types` array.
 * In new Anchor IDL format (spec 0.1.0), events only have name + discriminator;
 * the actual struct definition is in `types`.
 */
export function resolveEventFields(
  idl: AnchorIDL,
  event: AnchorEvent,
): { fields: Array<{ name: string; type: any; typeStr: string }> } {
  // Old format: event has inline data array
  if (event.data && Array.isArray(event.data) && event.data.length > 0) {
    return {
      fields: event.data.map((f: any, i: number) => {
        const normalized = normalizeField(f, i)
        return {
          name: normalized.name,
          type: normalized.type,
          typeStr: resolveType(normalized.type),
        }
      }),
    }
  }

  // New format: look up by name in types array
  const typeDef = idl.types?.find((t) => t.name === event.name)
  if (typeDef?.type?.fields?.length) {
    return {
      fields: typeDef.type.fields.map((f, i) => {
        const normalized = normalizeField(f, i)
        return {
          name: normalized.name,
          type: normalized.type,
          typeStr: resolveType(normalized.type),
        }
      }),
    }
  }

  return { fields: [] }
}

/**
 * Extract PDA seeds from an instruction account
 */
export function extractPDASeeds(account: AnchorAccountMeta): string[] {
  if (!account.pda?.seeds) return []
  return account.pda.seeds.map((seed: { kind: string; value?: any; path?: string }) => {
    if (seed.kind === 'const') {
      // New format: value is a byte array, try to decode as UTF-8
      if (Array.isArray(seed.value)) {
        try {
          const decoded = String.fromCharCode(...seed.value)
          return `const:${decoded}`
        } catch {
          return `const:[${seed.value.join(',')}]`
        }
      }
      return `const:${seed.value || ''}`
    }
    if (seed.kind === 'account') return `account:${seed.path || seed.value || ''}`
    if (seed.kind === 'arg') return `arg:${seed.path || seed.value || ''}`
    return `unknown:${seed.path || seed.value || ''}`
  })
}

// Utility helpers
function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
}
