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

    const projectName = (project.name as string) || projectId
    const apiBase = `${apiBaseUrl}/api/${projectId}`

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
      '- If details are missing or ambiguous, ask for clarification or fetch the relevant endpoint.',
      '',
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
