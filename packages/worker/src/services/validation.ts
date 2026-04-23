/**
 * Lightweight input validation utilities.
 * Keeps things simple without a heavy Zod dependency — Workers bundle size matters.
 */

export interface ValidationError {
  field: string
  message: string
}

export interface ValidationResult<T> {
  success: boolean
  data?: T
  errors?: ValidationError[]
}

// ----- Primitive validators -----

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value)
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

// ----- Project validation -----

export interface ValidatedProject {
  name: string
  description?: string
  cluster?: string
  is_public?: boolean
}

export function validateProjectInput(body: unknown): ValidationResult<ValidatedProject> {
  const errors: ValidationError[] = []

  if (!isObject(body)) {
    return { success: false, errors: [{ field: 'body', message: 'Request body must be a JSON object' }] }
  }

  if (!isNonEmptyString(body.name)) {
    errors.push({ field: 'name', message: 'Project name is required and must be a non-empty string' })
  } else if ((body.name as string).length > 100) {
    errors.push({ field: 'name', message: 'Project name must be 100 characters or less' })
  } else if (!/^[a-zA-Z0-9_-]+$/.test(body.name as string)) {
    errors.push({ field: 'name', message: 'Project name can only contain letters, numbers, hyphens, and underscores' })
  }

  if (body.description !== undefined && !isString(body.description)) {
    errors.push({ field: 'description', message: 'Description must be a string' })
  } else if (isString(body.description) && (body.description as string).length > 500) {
    errors.push({ field: 'description', message: 'Description must be 500 characters or less' })
  }

  if (body.cluster !== undefined) {
    const validClusters = ['mainnet-beta', 'devnet', 'testnet', 'localnet']
    if (!validClusters.includes(body.cluster as string)) {
      errors.push({ field: 'cluster', message: `Cluster must be one of: ${validClusters.join(', ')}` })
    }
  }

  if (body.is_public !== undefined && !isBoolean(body.is_public)) {
    errors.push({ field: 'is_public', message: 'is_public must be a boolean' })
  }

  if (errors.length > 0) {
    return { success: false, errors }
  }

  return {
    success: true,
    data: {
      name: (body.name as string).trim(),
      description: body.description ? (body.description as string).trim() : undefined,
      cluster: body.cluster as string | undefined,
      is_public: body.is_public as boolean | undefined,
    },
  }
}

// ----- IDL validation -----

export interface ValidatedIDLUpload {
  idl: Record<string, unknown>
  name?: string
  cluster?: string
  description?: string
}

export function validateIDLUpload(body: unknown): ValidationResult<ValidatedIDLUpload> {
  const errors: ValidationError[] = []

  function pickIDLStringField(idl: Record<string, unknown>, key: 'name' | 'version'): string | null {
    const rootValue = idl[key]
    if (isNonEmptyString(rootValue)) return rootValue
    if (isObject(idl.metadata) && isNonEmptyString(idl.metadata[key])) {
      return idl.metadata[key] as string
    }
    return null
  }

  if (!isObject(body)) {
    return { success: false, errors: [{ field: 'body', message: 'Request body must be a JSON object' }] }
  }

  if (!isObject(body.idl)) {
    errors.push({ field: 'idl', message: 'IDL must be a valid JSON object' })
  } else {
    const idl = body.idl as Record<string, unknown>
    if (!pickIDLStringField(idl, 'name')) {
      errors.push({ field: 'idl.name', message: 'IDL must have a name field' })
    }
    if (!pickIDLStringField(idl, 'version')) {
      errors.push({ field: 'idl.version', message: 'IDL must have a version field' })
    }
    if (!isArray(idl.instructions)) {
      errors.push({ field: 'idl.instructions', message: 'IDL must have an instructions array' })
    }
  }

  if (body.name !== undefined && !isNonEmptyString(body.name)) {
    errors.push({ field: 'name', message: 'Project name must be a non-empty string' })
  }

  if (body.cluster !== undefined) {
    const validClusters = ['mainnet-beta', 'devnet', 'testnet', 'localnet']
    if (!validClusters.includes(body.cluster as string)) {
      errors.push({ field: 'cluster', message: `Cluster must be one of: ${validClusters.join(', ')}` })
    }
  }

  if (body.description !== undefined && !isString(body.description)) {
    errors.push({ field: 'description', message: 'Description must be a string' })
  }

  if (errors.length > 0) {
    return { success: false, errors }
  }

  return {
    success: true,
    data: {
      idl: body.idl as Record<string, unknown>,
      name: body.name as string | undefined,
      cluster: body.cluster as string | undefined,
      description: body.description as string | undefined,
    },
  }
}

// ----- Transaction build validation -----

export interface ValidatedBuildRequest {
  accounts: Record<string, string>
  args: Record<string, unknown>
  payer: string
}

const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export function validateBuildRequest(body: unknown): ValidationResult<ValidatedBuildRequest> {
  const errors: ValidationError[] = []

  if (!isObject(body)) {
    return { success: false, errors: [{ field: 'body', message: 'Request body must be a JSON object' }] }
  }

  if (!isNonEmptyString(body.payer)) {
    errors.push({ field: 'payer', message: 'Payer public key is required' })
  } else if (!BASE58_REGEX.test(body.payer as string)) {
    errors.push({ field: 'payer', message: 'Payer must be a valid base58-encoded public key' })
  }

  if (!isObject(body.accounts)) {
    errors.push({ field: 'accounts', message: 'Accounts must be a JSON object mapping account names to public keys' })
  } else {
    const accounts = body.accounts as Record<string, unknown>
    for (const [k, v] of Object.entries(accounts)) {
      if (!isString(v)) {
        errors.push({ field: `accounts.${k}`, message: 'Account value must be a string (public key)' })
      } else if (!BASE58_REGEX.test(v as string)) {
        errors.push({ field: `accounts.${k}`, message: `Invalid base58 public key for account "${k}"` })
      }
    }
  }

  if (body.args !== undefined && !isObject(body.args)) {
    errors.push({ field: 'args', message: 'Args must be a JSON object' })
  }

  if (errors.length > 0) {
    return { success: false, errors }
  }

  return {
    success: true,
    data: {
      accounts: body.accounts as Record<string, string>,
      args: (body.args as Record<string, unknown>) || {},
      payer: body.payer as string,
    },
  }
}

// ----- API key validation -----

export interface ValidatedAPIKeyRequest {
  expiresInDays?: number
  label?: string
}

export function validateAPIKeyRequest(body: unknown): ValidationResult<ValidatedAPIKeyRequest> {
  const errors: ValidationError[] = []

  if (!isObject(body)) {
    return { success: true, data: {} } // Empty body is OK — defaults apply
  }

  if (body.expiresInDays !== undefined) {
    if (!isNumber(body.expiresInDays)) {
      errors.push({ field: 'expiresInDays', message: 'expiresInDays must be a number' })
    } else if ((body.expiresInDays as number) < 1 || (body.expiresInDays as number) > 365) {
      errors.push({ field: 'expiresInDays', message: 'expiresInDays must be between 1 and 365' })
    }
  }

  if (body.label !== undefined && !isString(body.label)) {
    errors.push({ field: 'label', message: 'Label must be a string' })
  }

  if (errors.length > 0) {
    return { success: false, errors }
  }

  return {
    success: true,
    data: {
      expiresInDays: body.expiresInDays as number | undefined,
      label: body.label as string | undefined,
    },
  }
}

// ----- PDA derivation validation -----

export interface ValidatedPdaRequest {
  instruction: string
  account: string
  seedValues: Record<string, any>
}

export function validatePdaRequest(body: unknown): ValidationResult<ValidatedPdaRequest> {
  const errors: ValidationError[] = []

  if (!isObject(body)) {
    return { success: false, errors: [{ field: 'body', message: 'Request body must be a JSON object' }] }
  }

  if (!isNonEmptyString(body.instruction)) {
    errors.push({ field: 'instruction', message: 'Instruction name is required' })
  }

  if (!isNonEmptyString(body.account)) {
    errors.push({ field: 'account', message: 'Account name is required' })
  }

  if (body.seedValues !== undefined && !isObject(body.seedValues)) {
    errors.push({ field: 'seedValues', message: 'seedValues must be a JSON object' })
  }

  if (errors.length > 0) {
    return { success: false, errors }
  }

  return {
    success: true,
    data: {
      instruction: (body.instruction as string).trim(),
      account: (body.account as string).trim(),
      seedValues: (body.seedValues as Record<string, any>) || {},
    },
  }
}
