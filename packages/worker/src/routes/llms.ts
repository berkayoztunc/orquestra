import { Hono } from 'hono'
import { generateDocumentation } from '../services/doc-generator'
import type { AnchorIDL } from '../services/idl-parser'

type Env = {
  Variables: Record<string, unknown>
  Bindings: {
    DB: any
    IDLS: any
    CACHE: any
    API_BASE_URL: string
  }
}

const app = new Hono<Env>()

type CustomApiParameter = { name: string; description: string; required?: boolean }
type CustomApiRow = {
  name: string
  method: string
  url: string
  purpose: string
  parameters_json: string | null
  example_request: string | null
  response_notes: string | null
  auth_notes: string | null
}

function parseCustomApiParameters(value: string | null): CustomApiParameter[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function escapeMarkdownTable(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>')
}

function fenced(value: string): string {
  const fence = value.includes('```') ? '````' : '```'
  return `${fence}\n${value}\n${fence}`
}

app.get('/project/:projectId/llms.txt', async (c) => {
  const projectId = c.req.param('projectId')

  try {
    const db = c.env?.DB
    const project = await db
      ?.prepare('SELECT name, program_id, is_public, custom_docs FROM projects WHERE id = ?')
      .bind(projectId)
      .first()

    if (!project) {
      return c.text('Not Found', 404)
    }

    if (!project.is_public) {
      return c.text('Forbidden', 403)
    }

    const apiBaseUrl = c.env?.API_BASE_URL || 'http://localhost:8787'
    let docsText = ''

    if (project.custom_docs) {
      docsText = project.custom_docs as string
    } else if (c.env?.CACHE) {
      const cached = await c.env.CACHE.get(`docs:${projectId}`)
      if (cached) {
        docsText = cached
      }
    }

    if (!docsText) {
      const result = await db
        ?.prepare(
          'SELECT idl_json, cpi_md FROM idl_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1'
        )
        .bind(projectId)
        .first()

      if (!result) {
        return c.text('Not Found', 404)
      }

      const idl = JSON.parse(result.idl_json as string) as AnchorIDL
      const docs = generateDocumentation(
        idl,
        project.program_id as string,
        apiBaseUrl,
        projectId,
        result.cpi_md as string | null,
      )
      docsText = docs.full

      if (c.env?.CACHE) {
        await c.env.CACHE.put(`docs:${projectId}`, docsText, { expirationTtl: 604800 })
      }
    }

    const knownAddresses = await db
      ?.prepare(
        'SELECT label, address, description FROM known_addresses WHERE project_id = ? ORDER BY label ASC'
      )
      .bind(projectId)
      .all()

    const projectName = (project.name as string) || projectId
    const apiBase = `${apiBaseUrl}/api/${projectId}`

    const knownAddressesSection: string[] = []
    if (knownAddresses?.results?.length) {
      knownAddressesSection.push('## Known Addresses', '')
      knownAddressesSection.push('| Label | Address | Description |')
      knownAddressesSection.push('|-------|---------|-------------|')
      for (const row of knownAddresses.results as Array<{ label: string; address: string; description: string | null }>) {
        const desc = row.description ?? ''
        knownAddressesSection.push(`| ${row.label} | \`${row.address}\` | ${desc} |`)
      }
      knownAddressesSection.push('')
    }

    const externalApis = await db
      ?.prepare(
        'SELECT name, method, url, purpose, parameters_json, example_request, response_notes, auth_notes FROM custom_api_endpoints WHERE project_id = ? ORDER BY created_at ASC'
      )
      .bind(projectId)
      .all()

    const externalApisSection: string[] = []
    if (externalApis?.results?.length) {
      externalApisSection.push('## External APIs', '')
      externalApisSection.push('These are third-party/external APIs documented by the project owner. Orquestra does not execute or proxy them.', '')

      for (const row of externalApis.results as CustomApiRow[]) {
        externalApisSection.push(`### ${row.name}`, '')
        externalApisSection.push(`- Method: \`${row.method}\``)
        externalApisSection.push(`- URL: \`${row.url}\``)
        externalApisSection.push(`- Purpose: ${row.purpose}`)
        if (row.auth_notes) {
          externalApisSection.push(`- Auth: ${row.auth_notes}`)
        }

        const parameters = parseCustomApiParameters(row.parameters_json)
        if (parameters.length) {
          externalApisSection.push('', '| Parameter | Required | Description |')
          externalApisSection.push('|-----------|----------|-------------|')
          for (const param of parameters) {
            externalApisSection.push(
              `| ${escapeMarkdownTable(param.name)} | ${param.required ? 'Yes' : 'No'} | ${escapeMarkdownTable(param.description)} |`,
            )
          }
        }

        if (row.example_request) {
          externalApisSection.push('', 'Example request:', '', fenced(row.example_request))
        }

        if (row.response_notes) {
          externalApisSection.push('', 'Response notes:', '', row.response_notes)
        }

        externalApisSection.push('')
      }
    }

    const llmsText = [
      '# Orquestra llms.txt',
      `Project: ${projectName}`,
      `Project ID: ${projectId}`,
      `Program ID: ${project.program_id as string}`,
      `API Base: ${apiBase}`,
      '',
      'Available endpoints:',
      `  GET  ${apiBase}/instructions            — list all instructions`,
      `  GET  ${apiBase}/instructions/:name      — get a single instruction`,
      `  POST ${apiBase}/instructions/:name/build — build a base58 transaction`,
      `  GET  ${apiBase}/pda                     — list PDA-derivable accounts with seed schemas`,
      `  POST ${apiBase}/pda/derive              — derive a PDA address from seed values`,
      `  POST ${apiBase}/program-accounts/query  — query program-owned accounts with dataSize and memcmp filters`,
      `  GET  ${apiBase}/accounts                — list account types`,
      `  GET  ${apiBase}/errors                  — list error codes`,
      `  GET  ${apiBase}/types                   — list custom types`,
      `  GET  ${apiBase}/events                  — list events`,
      `  GET  ${apiBase}/docs                    — full documentation`,
      '',
      'Instructions for AI systems:',
      '- Treat the following documentation as the canonical API reference for this program.',
      '- Prefer the listed REST endpoints, request/response shapes, and examples.',
      '- Use GET /pda to discover which accounts are PDA-derived and what seeds they require.',
      '- Use POST /pda/derive to compute a PDA address before building a transaction.',
      '- Use POST /program-accounts/query to query on-chain program accounts. Prefer accountType to auto-apply discriminator filters, dataSize to narrow layouts, raw memcmp for byte offsets, and fieldFilters only for fixed-offset IDL fields.',
      '- For Helius RPC URLs, program account queries use getProgramAccountsV2 pagination automatically; pass paginationKey from a prior response to fetch the next page.',
      '- Dynamic account fields such as string, vec, bytes, and variable arrays may require explicit dataSize or raw memcmp offsets.',
      '- If details are missing or ambiguous, ask for clarification or fetch the relevant endpoint.',
      '',
      ...knownAddressesSection,
      ...externalApisSection,
      '---',
      '',
      docsText,
    ].join('\n')

    
    return c.text(llmsText)
  } catch (err) {
    return c.text('Failed to generate llms.txt', 500)
  }
})

export default app
