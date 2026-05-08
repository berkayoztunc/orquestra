/**
 * Documentation Generator Service
 * Generates Markdown documentation from Anchor IDL
 */

import type { AnchorIDL, AnchorInstruction, AnchorAccount, AnchorError, AnchorEvent, CodamaIDL, CodamaInstructionAccount, CodamaInstructionArgument } from './idl-parser'
import { resolveType, extractPDASeeds, getDefinedTypeName, resolveDefinedType, resolveAccountFields, resolveEventFields, normalizeAccountMeta, normalizeField, detectIDLFormat, getCodamaUserArgs, resolveCodamaType } from './idl-parser'
import { listPdaAccounts } from './pda'

export interface GeneratedDocs {
  full: string           // Complete markdown documentation
  instructions: string   // Instructions section only
  accounts: string       // Accounts section only
  errors: string         // Errors section only
  events: string         // Events section only
  types: string          // Types section only
  overview: string       // Overview/summary section
  pdaAccounts: string    // PDA-derivable accounts section
  programAccounts: string // Program account query section
}

/**
 * Generate complete Markdown documentation from an IDL.
 * Dispatches to Anchor or Codama generator based on IDL format.
 */
export function generateDocumentation(
  idl: AnchorIDL | CodamaIDL,
  programId: string,
  apiBaseUrl: string,
  projectSlug: string,
  cpiMd?: string | null,
): GeneratedDocs {
  if (detectIDLFormat(idl) === 'codama') {
    return generateCodamaDocumentation(idl as CodamaIDL, programId, apiBaseUrl, projectSlug, cpiMd)
  }
  return generateAnchorDocumentation(idl as AnchorIDL, programId, apiBaseUrl, projectSlug, cpiMd)
}

function generateAnchorDocumentation(
  idl: AnchorIDL,
  programId: string,
  apiBaseUrl: string,
  projectSlug: string,
  cpiMd?: string | null,
): GeneratedDocs {
  const normalizedApiBase = normalizeApiBaseUrl(apiBaseUrl)
  const overview = generateOverview(idl, programId, normalizedApiBase, projectSlug)
  const instructions = generateInstructionsDocs(idl, normalizedApiBase, projectSlug)
  const accounts = generateAccountsDocs(idl)
  const errors = generateErrorsDocs(idl)
  const events = generateEventsDocs(idl)
  const types = generateTypesDocs(idl)
  const pdaAccounts = generatePdaDocs(idl, normalizedApiBase, projectSlug)
  const programAccounts = generateProgramAccountsDocs(idl.accounts?.map((a) => a.name) || [], normalizedApiBase, projectSlug)

  let full = [overview, pdaAccounts, programAccounts, instructions, accounts, types, errors, events].join('\n\n---\n\n')

  // Append CPI documentation if available
  if (cpiMd) {
    full += `\n\n---\n\n## CPI Integration\n\n${cpiMd}`
  }

  return { full, instructions, accounts, errors, events, types, overview, pdaAccounts, programAccounts }
}

function generateOverview(
  idl: AnchorIDL,
  programId: string,
  apiBaseUrl: string,
  projectSlug: string,
): string {
  const programName = idl.metadata?.name || idl.name || 'Unknown Program'
  const programVersion = idl.metadata?.version || idl.version || 'unknown'
  const base = `${apiBaseUrl}/${projectSlug}`
  return `# ${programName}

> Auto-generated documentation from Anchor IDL

**Program ID:** \`${programId}\`  
**Version:** ${programVersion}  
**API Base:** \`${base}\`

## Summary

| Item | Count |
|------|-------|
| Instructions | ${idl.instructions?.length || 0} |
| Accounts | ${idl.accounts?.length || 0} |
| Types | ${idl.types?.length || 0} |
| Errors | ${idl.errors?.length || 0} |
| Events | ${idl.events?.length || 0} |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | \`${base}/instructions\` | List all instructions |
| GET | \`${base}/instructions/:name\` | Get a single instruction |
| POST | \`${base}/instructions/:name/build\` | Build a base58 transaction |
| GET | \`${base}/pda\` | List all PDA-derivable accounts with seed schemas |
| POST | \`${base}/pda/derive\` | Derive a PDA address from seed values |
| POST | \`${base}/program-accounts/query\` | Query program-owned accounts with dataSize and memcmp filters |
| GET | \`${base}/accounts\` | List all account types |
| GET | \`${base}/errors\` | List all error codes |
| GET | \`${base}/types\` | List all custom types |
| GET | \`${base}/events\` | List all events |
| GET | \`${base}/docs\` | Full documentation (this content) |

## Quick Start

### List all instructions
\`\`\`bash
curl ${base}/instructions
\`\`\`

### Build a transaction
\`\`\`bash
curl -X POST ${base}/instructions/{name}/build \\
  -H "Content-Type: application/json" \\
  -d '{
    "accounts": { "account_name": "pubkey..." },
    "args": { "arg_name": "value" },
    "feePayer": "your_pubkey..."
  }'
\`\`\`

### List PDA-derivable accounts
\`\`\`bash
curl ${base}/pda
\`\`\`

### Derive a PDA address
\`\`\`bash
curl -X POST ${base}/pda/derive \\
  -H "Content-Type: application/json" \\
  -d '{
    "instruction": "instruction_name",
    "account": "account_name",
    "seeds": { "seed_arg_name": "value" }
  }'
\`\`\`

### Query program accounts
\`\`\`bash
curl -X POST ${base}/program-accounts/query \\
  -H "Content-Type: application/json" \\
  -d '{
    "accountType": "${idl.accounts?.[0]?.name || 'AccountType'}",
    "fieldFilters": [
      { "field": "authority", "bytes": "<base58-bytes-or-pubkey>" }
    ],
    "limit": 25
  }'
\`\`\``
}

function generateProgramAccountsDocs(
  accountNames: string[],
  apiBaseUrl: string,
  projectSlug: string,
): string {
  const base = `${apiBaseUrl}/${projectSlug}`
  const sampleAccount = accountNames[0] || 'AccountType'

  return `## Query Program Accounts

**Endpoint:** \`POST ${base}/program-accounts/query\`

Use this endpoint to query on-chain accounts owned by this program through Solana \`getProgramAccounts\`. Orquestra builds the RPC filters, applies IDL metadata when available, and decodes matching accounts by default.

### Filter options

| Field | Purpose |
|-------|---------|
| \`accountType\` | IDL account type name. Adds the account discriminator filter and infers fixed account size when possible. |
| \`dataSize\` | Exact Solana account data length in bytes. Useful for narrowing account layouts. |
| \`memcmp\` | Raw Solana memcmp filters by byte offset. Use for advanced byte-level matching. |
| \`fieldFilters\` | IDL field filters for fixed-offset fields. Requires \`accountType\`. |
| \`limit\` | Returned account limit. Defaults to 25, max 100. |
| \`includeRaw\` | Include raw base64 data. Defaults to false unless decoding fails or the account type is unknown. |

Dynamic fields such as \`string\`, \`vec\`, \`bytes\`, and variable arrays may prevent automatic size or field-offset inference. In those cases, provide explicit \`dataSize\` and raw \`memcmp\` offsets.

### Example

\`\`\`bash
curl -X POST ${base}/program-accounts/query \\
  -H "Content-Type: application/json" \\
  -d '{
    "accountType": "${sampleAccount}",
    "dataSize": 48,
    "memcmp": [
      { "offset": 8, "bytes": "<base58-bytes>" }
    ],
    "fieldFilters": [
      { "field": "authority", "bytes": "<pubkey>" }
    ],
    "limit": 25
  }'
\`\`\``
}

function generateInstructionsDocs(idl: AnchorIDL, apiBaseUrl: string, projectSlug: string): string {
  if (!idl.instructions?.length) {
    return '## Instructions\n\nNo instructions defined.'
  }

  let md = '## Instructions\n\n'

  for (const ix of idl.instructions) {
    md += `### \`${ix.name}\`\n\n`

    // Docs
    if (ix.docs?.length) {
      md += ix.docs.join('\n') + '\n\n'
    }

    // API endpoint
    md += `**Endpoint:** \`POST ${apiBaseUrl}/${projectSlug}/instructions/${ix.name}/build\`\n\n`

    // Accounts table
    if (ix.accounts?.length) {
      md += '#### Accounts\n\n'
      md += '| Name | Writable | Signer | Optional | PDA |\n'
      md += '|------|----------|--------|----------|-----|\n'

      for (const acc of ix.accounts) {
        const norm = normalizeAccountMeta(acc)
        const pdaSeeds = extractPDASeeds(acc)
        const pdaStr = pdaSeeds.length ? pdaSeeds.join(', ') : '-'
        md += `| \`${norm.name}\` | ${norm.isMut ? '✅' : '❌'} | ${norm.isSigner ? '✅' : '❌'} | ${norm.isOptional ? '✅' : '❌'} | ${pdaStr} |\n`
      }
      md += '\n'
    }

    // Args table
    if (ix.args?.length) {
      md += '#### Arguments\n\n'
      md += '| Name | Type |\n'
      md += '|------|------|\n'

      for (const arg of ix.args) {
        md += `| \`${arg.name}\` | \`${resolveType(arg.type)}\` |\n`
      }
      md += '\n'

      // Expand defined types inline
      for (const arg of ix.args) {
        const definedName = getDefinedTypeName(arg.type)
        if (definedName) {
          const resolved = resolveDefinedType(idl, definedName)
          if (resolved && resolved.fields.length > 0) {
            md += `##### \`${arg.name}\` — \`${definedName}\` (struct)\n\n`
            md += '| Field | Type |\n'
            md += '|-------|------|\n'
            for (const field of resolved.fields) {
              md += `| \`${field.name}\` | \`${field.typeStr}\` |\n`
            }
            md += '\n'
          }
        }
      }
    }

    // Example request
    md += '#### Example\n\n'
    md += '```bash\n'
    md += `curl -X POST ${apiBaseUrl}/${projectSlug}/instructions/${ix.name}/build \\\n`
    md += '  -H "Content-Type: application/json" \\\n'
    md += '  -d \'{\n'

    if (ix.accounts?.length) {
      md += '    "accounts": {\n'
      const accEntries = ix.accounts.map((a: any) => `      "${a.name}": "<pubkey>"`)
      md += accEntries.join(',\n') + '\n'
      md += '    },\n'
    }

    if (ix.args?.length) {
      md += '    "args": {\n'
      const argEntries: string[] = []
      for (const a of ix.args) {
        const definedName = getDefinedTypeName(a.type)
        if (definedName) {
          const resolved = resolveDefinedType(idl, definedName)
          if (resolved && resolved.fields.length > 0) {
            const fieldEntries = resolved.fields.map((f: any) => `        "${f.name}": <${f.typeStr}>`)
            argEntries.push(`      "${a.name}": {\n${fieldEntries.join(',\n')}\n      }`)
          } else {
            argEntries.push(`      "${a.name}": <${resolveType(a.type)}>`)
          }
        } else {
          argEntries.push(`      "${a.name}": <${resolveType(a.type)}>`)
        }
      }
      md += argEntries.join(',\n') + '\n'
      md += '    },\n'
    }

    md += '    "feePayer": "<your_pubkey>"\n'
    md += '  }\'\n'
    md += '```\n\n'
  }

  return md
}

function normalizeApiBaseUrl(apiBaseUrl: string): string {
  const trimmed = apiBaseUrl.endsWith('/') ? apiBaseUrl.slice(0, -1) : apiBaseUrl
  if (trimmed.endsWith('/api')) {
    return trimmed
  }
  return `${trimmed}/api`
}

function generatePdaDocs(idl: AnchorIDL, apiBaseUrl: string, projectSlug: string): string {
  const pdaAccounts = listPdaAccounts(idl)
  const base = `${apiBaseUrl}/${projectSlug}`

  if (!pdaAccounts.length) {
    return '## PDA-Derivable Accounts\n\nNo PDA-derivable accounts found in this program.'
  }

  let md = '## PDA-Derivable Accounts\n\n'
  md += `**List endpoint:** \`GET ${base}/pda\`  \n`
  md += `**Derive endpoint:** \`POST ${base}/pda/derive\`\n\n`

  // Group by account name to deduplicate across instructions
  const seen = new Set<string>()
  const unique = pdaAccounts.filter((entry) => {
    const key = `${entry.instruction}:${entry.account}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  for (const entry of unique) {
    md += `### \`${entry.account}\` (instruction: \`${entry.instruction}\`)\n\n`

    if (entry.customProgram) {
      md += `> Cross-program PDA — derived using program \`${entry.customProgram}\`\n\n`
    }

    md += '| # | Kind | Name | Type | Description |\n'
    md += '|---|------|------|------|-------------|\n'

    entry.seeds.forEach((seed, i) => {
      const num = i + 1
      const name = seed.name ?? '-'
      const type = seed.type ?? '-'
      const desc = seed.description ?? '-'
      md += `| ${num} | \`${seed.kind}\` | ${name} | ${type} | ${desc} |\n`
    })

    md += '\n'

    // Build seed payload example
    const argSeeds = entry.seeds.filter((s) => s.kind === 'arg' || s.kind === 'account')
    const seedsExample = argSeeds.length
      ? argSeeds.map((s) => `      "${s.name}": "<${s.type ?? 'value'}>"`).join(',\n')
      : '      // no dynamic seeds required'

    md += '**Derive example:**\n'
    md += '```bash\n'
    md += `curl -X POST ${base}/pda/derive \\\n`
    md += '  -H "Content-Type: application/json" \\\n'
    md += `  -d '{\n    "instruction": "${entry.instruction}",\n    "account": "${entry.account}",\n    "seeds": {\n${seedsExample}\n    }\n  }'\n`
    md += '```\n\n'
  }

  return md.trimEnd()
}

function generateAccountsDocs(idl: AnchorIDL): string {
  if (!idl.accounts?.length) {
    return '## Account Types\n\nNo account types defined.'
  }

  let md = '## Account Types\n\n'

  for (const acc of idl.accounts) {
    md += `### \`${acc.name}\`\n\n`

    if (acc.docs?.length) {
      md += acc.docs.join('\n') + '\n\n'
    }

    // Resolve fields from inline type or from types array
    const resolved = resolveAccountFields(idl, acc)

    if (resolved.fields.length > 0) {
      md += '| Field | Type |\n'
      md += '|-------|------|\n'

      for (const field of resolved.fields) {
        md += `| \`${field.name}\` | \`${field.typeStr}\` |\n`
      }
      md += '\n'
    }
  }

  return md
}

function generateErrorsDocs(idl: AnchorIDL): string {
  if (!idl.errors?.length) {
    return '## Error Codes\n\nNo custom errors defined.'
  }

  let md = '## Error Codes\n\n'
  md += '| Code | Name | Message |\n'
  md += '|------|------|----------|\n'

  for (const err of idl.errors) {
    md += `| ${err.code} | \`${err.name}\` | ${err.msg} |\n`
  }

  return md
}

function generateEventsDocs(idl: AnchorIDL): string {
  if (!idl.events?.length) {
    return '## Events\n\nNo events defined.'
  }

  let md = '## Events\n\n'

  for (const event of idl.events) {
    md += `### \`${event.name}\`\n\n`

    // Resolve fields from inline data or from types array
    const resolved = resolveEventFields(idl, event)

    if (resolved.fields.length > 0) {
      md += '| Field | Type |\n'
      md += '|-------|------|\n'

      for (const field of resolved.fields) {
        md += `| \`${field.name}\` | \`${field.typeStr}\` |\n`
      }
      md += '\n'
    }
  }

  return md
}

function generateTypesDocs(idl: AnchorIDL): string {
  if (!idl.types?.length) {
    return '## Types\n\nNo custom types defined.'
  }

  let md = '## Types\n\n'

  for (const t of idl.types) {
    md += `### \`${t.name}\`\n\n`
    md += `**Kind:** ${t.type?.kind || 'unknown'}\n\n`

    if (t.type?.fields?.length) {
      md += '| Field | Type |\n'
      md += '|-------|------|\n'

      for (const field of t.type.fields) {
        const normalized = normalizeField(field, t.type.fields.indexOf(field))
        md += `| \`${normalized.name}\` | \`${resolveType(normalized.type)}\` |\n`
      }
      md += '\n'
    }
  }

  return md
}

// ─── Codama doc generator ──────────────────────────────────────────────────

function generateCodamaDocumentation(
  idl: CodamaIDL,
  programId: string,
  apiBaseUrl: string,
  projectSlug: string,
  cpiMd?: string | null,
): GeneratedDocs {
  const normalizedApiBase = normalizeApiBaseUrl(apiBaseUrl)
  const base = `${normalizedApiBase}/${projectSlug}`
  const prog = idl.program

  const overview = generateCodamaOverview(idl, programId, normalizedApiBase, projectSlug)
  const instructions = generateCodamaInstructionsDocs(idl, normalizedApiBase, projectSlug)
  const accounts = generateCodamaAccountsDocs(idl)
  const errors = generateCodamaErrorsDocs(idl)
  const types = generateCodamaTypesDocs(idl)
  const pdaAccounts = generateCodamaPdaDocs(idl, normalizedApiBase, projectSlug)
  const programAccounts = generateProgramAccountsDocs(prog.accounts?.map((a) => a.name) || [], normalizedApiBase, projectSlug)

  let full = [overview, pdaAccounts, programAccounts, instructions, accounts, types, errors].join('\n\n---\n\n')
  if (cpiMd) {
    full += `\n\n---\n\n## CPI Integration\n\n${cpiMd}`
  }

  return { full, instructions, accounts, errors, events: '', types, overview, pdaAccounts, programAccounts }
}

function generateCodamaOverview(
  idl: CodamaIDL,
  programId: string,
  apiBaseUrl: string,
  projectSlug: string,
): string {
  const prog = idl.program
  const base = `${apiBaseUrl}/${projectSlug}`
  return `# ${prog.name}

> Auto-generated documentation from Codama IDL

**Program ID:** \`${prog.publicKey || programId}\`  
**Version:** ${prog.version || idl.version || 'unknown'}  
**Standard:** Codama  
**API Base:** \`${base}\`

## Summary

| Item | Count |
|------|-------|
| Instructions | ${prog.instructions?.length || 0} |
| Accounts | ${prog.accounts?.length || 0} |
| Types | ${prog.definedTypes?.length || 0} |
| Errors | ${prog.errors?.length || 0} |
| PDAs | ${prog.pdas?.length || 0} |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | \`${base}/instructions\` | List all instructions |
| GET | \`${base}/instructions/:name\` | Get a single instruction |
| POST | \`${base}/instructions/:name/build\` | Build a base58 transaction |
| GET | \`${base}/pda\` | List all PDA-derivable accounts with seed schemas |
| POST | \`${base}/pda/derive\` | Derive a PDA address from seed values |
| POST | \`${base}/program-accounts/query\` | Query program-owned accounts with dataSize and memcmp filters |
| GET | \`${base}/accounts\` | List all account types |
| GET | \`${base}/errors\` | List all error codes |
| GET | \`${base}/types\` | List all custom types |
| GET | \`${base}/docs\` | Full documentation (this content) |

## Quick Start

### Build a transaction
\`\`\`bash
curl -X POST ${base}/instructions/{name}/build \\
  -H "Content-Type: application/json" \\
  -d '{
    "accounts": { "account_name": "pubkey..." },
    "args": { "arg_name": "value" },
    "feePayer": "your_pubkey..."
  }'
\`\`\`

### Query program accounts
\`\`\`bash
curl -X POST ${base}/program-accounts/query \\
  -H "Content-Type: application/json" \\
  -d '{
    "accountType": "${prog.accounts?.[0]?.name || 'AccountType'}",
    "limit": 25
  }'
\`\`\``
}

function generateCodamaInstructionsDocs(
  idl: CodamaIDL,
  apiBaseUrl: string,
  projectSlug: string,
): string {
  const prog = idl.program
  if (!prog.instructions?.length) {
    return '## Instructions\n\nNo instructions defined.'
  }

  let md = '## Instructions\n\n'

  for (const ix of prog.instructions) {
    md += `### \`${ix.name}\`\n\n`
    md += `**Endpoint:** \`POST ${apiBaseUrl}/${projectSlug}/instructions/${ix.name}/build\`\n\n`

    // Accounts table
    if (ix.accounts?.length) {
      md += '#### Accounts\n\n'
      md += '| Name | Writable | Signer | Optional | Auto-filled |\n'
      md += '|------|----------|--------|----------|-------------|\n'
      for (const acc of ix.accounts) {
        const autoFill = acc.defaultValue?.kind === 'publicKeyValueNode'
          ? `\`${acc.defaultValue.publicKey}\``
          : '-'
        md += `| \`${acc.name}\` | ${acc.isWritable ? '✅' : '❌'} | ${acc.isSigner === true || acc.isSigner === 'either' ? '✅' : '❌'} | ${acc.isOptional ? '✅' : '❌'} | ${autoFill} |\n`
      }
      md += '\n'
    }

    // User-visible args (excludes discriminator args and omitted defaults)
    const userArgs = getCodamaUserArgs(ix)
    if (userArgs.length) {
      md += '#### Arguments\n\n'
      md += '| Name | Type |\n'
      md += '|------|------|\n'
      for (const arg of userArgs) {
        md += `| \`${arg.name}\` | \`${resolveCodamaType(arg.type)}\` |\n`
      }
      md += '\n'
    }

    // Example
    md += '#### Example\n\n'
    md += '```bash\n'
    md += `curl -X POST ${apiBaseUrl}/${projectSlug}/instructions/${ix.name}/build \\\n`
    md += '  -H "Content-Type: application/json" \\\n'
    md += '  -d \'{\n'

    const userAccounts = ix.accounts?.filter((a: CodamaInstructionAccount) => a.defaultValue?.kind !== 'publicKeyValueNode') ?? []
    if (userAccounts.length) {
      md += '    "accounts": {\n'
      md += userAccounts.map((a: CodamaInstructionAccount) => `      "${a.name}": "<pubkey>"`).join(',\n') + '\n'
      md += '    },\n'
    }
    if (userArgs.length) {
      md += '    "args": {\n'
      md += userArgs.map((a) => `      "${a.name}": <${resolveCodamaType(a.type)}>`).join(',\n') + '\n'
      md += '    },\n'
    }
    md += '    "feePayer": "<your_pubkey>"\n'
    md += '  }\'\n'
    md += '```\n\n'
  }

  return md
}

function generateCodamaAccountsDocs(idl: CodamaIDL): string {
  const prog = idl.program
  if (!prog.accounts?.length) {
    return '## Account Types\n\nNo account types defined.'
  }

  let md = '## Account Types\n\n'
  for (const acc of prog.accounts) {
    md += `### \`${acc.name}\`\n\n`
    if (acc.data?.kind === 'structTypeNode' && acc.data.fields?.length) {
      md += '| Field | Type |\n'
      md += '|-------|------|\n'
      for (const field of acc.data.fields) {
        md += `| \`${field.name}\` | \`${resolveCodamaType(field.type)}\` |\n`
      }
      md += '\n'
    }
  }
  return md
}

function generateCodamaErrorsDocs(idl: CodamaIDL): string {
  const prog = idl.program
  if (!prog.errors?.length) {
    return '## Error Codes\n\nNo custom errors defined.'
  }

  let md = '## Error Codes\n\n'
  md += '| Code | Name | Message |\n'
  md += '|------|------|----------|\n'
  for (const err of prog.errors) {
    md += `| ${err.code} | \`${err.name}\` | ${err.message} |\n`
  }
  return md
}

function generateCodamaTypesDocs(idl: CodamaIDL): string {
  const prog = idl.program
  if (!prog.definedTypes?.length) {
    return '## Types\n\nNo custom types defined.'
  }

  let md = '## Types\n\n'
  for (const t of prog.definedTypes) {
    md += `### \`${t.name}\`\n\n`
    if (t.type?.kind === 'structTypeNode' && t.type.fields?.length) {
      md += '| Field | Type |\n'
      md += '|-------|------|\n'
      for (const field of t.type.fields) {
        md += `| \`${field.name}\` | \`${resolveCodamaType(field.type)}\` |\n`
      }
      md += '\n'
    } else if (t.type?.kind === 'enumTypeNode' && t.type.variants?.length) {
      md += `**Kind:** enum\n\n`
      md += '| Variant |\n'
      md += '|---------|\n'
      for (const v of t.type.variants) {
        md += `| \`${v.name}\` |\n`
      }
      md += '\n'
    }
  }
  return md
}

function generateCodamaPdaDocs(
  idl: CodamaIDL,
  apiBaseUrl: string,
  projectSlug: string,
): string {
  const prog = idl.program
  const base = `${apiBaseUrl}/${projectSlug}`

  if (!prog.pdas?.length) {
    return '## PDA-Derivable Accounts\n\nNo PDA-derivable accounts defined.'
  }

  let md = '## PDA-Derivable Accounts\n\n'
  md += `**List endpoint:** \`GET ${base}/pda\`  \n`
  md += `**Derive endpoint:** \`POST ${base}/pda/derive\`\n\n`

  for (const pda of prog.pdas) {
    md += `### \`${pda.name}\`\n\n`
    if (pda.seeds?.length) {
      md += '| # | Seed Kind | Name/Value |\n'
      md += '|---|-----------|------------|\n'
      pda.seeds.forEach((seed: { kind: string; name?: string; type?: any; bytes?: string }, i: number) => {
        if (seed.kind === 'constantPdaSeedNode') {
          md += `| ${i + 1} | constant | (fixed bytes) |\n`
        } else if (seed.kind === 'variablePdaSeedNode') {
          md += `| ${i + 1} | variable | \`${seed.name}\` (\`${resolveCodamaType(seed.type)}\`) |\n`
        } else if (seed.kind === 'programIdPdaSeedNode') {
          md += `| ${i + 1} | programId | (program ID) |\n`
        }
      })
      md += '\n'
    }
  }

  return md.trimEnd()
}
