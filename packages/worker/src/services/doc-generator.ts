/**
 * Documentation Generator Service
 * Generates Markdown documentation from Anchor IDL
 */

import type { AnchorIDL, AnchorInstruction, AnchorAccount, AnchorError, AnchorEvent } from './idl-parser'
import { resolveType, extractPDASeeds, getDefinedTypeName, resolveDefinedType, resolveAccountFields, resolveEventFields, normalizeAccountMeta, normalizeField } from './idl-parser'

export interface GeneratedDocs {
  full: string           // Complete markdown documentation
  instructions: string   // Instructions section only
  accounts: string       // Accounts section only
  errors: string         // Errors section only
  events: string         // Events section only
  types: string          // Types section only
  overview: string       // Overview/summary section
}

/**
 * Generate complete Markdown documentation from an IDL
 */
export function generateDocumentation(
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

  let full = [overview, instructions, accounts, types, errors, events].join('\n\n---\n\n')

  // Append CPI documentation if available
  if (cpiMd) {
    full += `\n\n---\n\n## CPI Integration\n\n${cpiMd}`
  }

  return { full, instructions, accounts, errors, events, types, overview }
}

function generateOverview(
  idl: AnchorIDL,
  programId: string,
  apiBaseUrl: string,
  projectSlug: string,
): string {
  const programName = idl.metadata?.name || idl.name || 'Unknown Program'
  const programVersion = idl.metadata?.version || idl.version || 'unknown'
  return `# ${programName}

> Auto-generated documentation from Anchor IDL

**Program ID:** \`${programId}\`  
**Version:** ${programVersion}  
**API Base:** \`${apiBaseUrl}/${projectSlug}\`

## Summary

| Item | Count |
|------|-------|
| Instructions | ${idl.instructions?.length || 0} |
| Accounts | ${idl.accounts?.length || 0} |
| Types | ${idl.types?.length || 0} |
| Errors | ${idl.errors?.length || 0} |
| Events | ${idl.events?.length || 0} |

## Quick Start

### List all instructions
\`\`\`bash
curl ${apiBaseUrl}/${projectSlug}/instructions
\`\`\`

### Build a transaction
\`\`\`bash
curl -X POST ${apiBaseUrl}/${projectSlug}/instructions/{name}/build \\
  -H "Content-Type: application/json" \\
  -d '{
    "accounts": { "account_name": "pubkey..." },
    "args": { "arg_name": "value" },
    "feePayer": "your_pubkey..."
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
