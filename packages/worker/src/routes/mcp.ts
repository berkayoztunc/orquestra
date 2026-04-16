/**
 * MCP (Model Context Protocol) Server
 * Exposes orquestra tools for AI agents via Cloudflare's Streamable HTTP transport.
 * Uses createMcpHandler (stateless) — no Durable Objects required.
 *
 * Endpoint: GET|POST /mcp
 *
 * Tools:
 *   1. search_programs        — search the registry by text or Solana programId
 *   2. list_instructions      — list all instructions (args + accounts) for a project
 *   3. build_instruction      — build a serialized Solana transaction
 *   4. list_pda_accounts      — list PDA-derivable accounts with seed schemas
 *   5. derive_pda             — derive a PDA address
 *   6. read_llms_txt          — fetch the full AI-ready markdown docs for a project
 *   7. get_ai_analysis        — get AI analysis summary (tags, description, stats)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import {
  parseIDL,
  expandInstructionArgs,
  normalizeAccountMeta,
  resolveType,
} from '../services/idl-parser'
import type { AnchorIDL } from '../services/idl-parser'
import { buildTransaction } from '../services/tx-builder'
import { listPdaAccounts, derivePda } from '../services/pda'
import { generateDocumentation } from '../services/doc-generator'
import { searchProjects } from '../services/search'

// ── Env type (re-declared per project convention) ────────────────────────────

type Bindings = {
  DB: any
  IDLS: any
  CACHE: any
  API_BASE_URL: string
  SOLANA_RPC_URL: string
}

// ── Helper: fetch IDL from KV with D1 fallback ───────────────────────────────

async function fetchIDL(
  projectId: string,
  env: Bindings,
): Promise<{ idl: AnchorIDL; programId: string; projectName: string; cpiMd: string | null } | null> {
  // 1. Try KV cache first (same pattern as llms.ts and api.ts)
  const cached = await env.IDLS?.get(`project:${projectId}`)
  if (cached) {
    try {
      const parsed = JSON.parse(cached)
      return {
        idl: parsed.idl as AnchorIDL,
        programId: parsed.programId ?? '',
        projectName: parsed.projectName ?? projectId,
        cpiMd: null,
      }
    } catch {
      // fall through to DB
    }
  }

  // 2. Fall back to D1
  const row = await env.DB?.prepare(
    `SELECT p.name, p.program_id, p.is_public, v.idl_json, v.cpi_md
     FROM projects p
     JOIN idl_versions v ON v.project_id = p.id
     WHERE p.id = ?
     ORDER BY v.version DESC LIMIT 1`,
  )
    .bind(projectId)
    .first()

  if (!row) return null
  if (!row.is_public) return null // only public projects via MCP

  try {
    const idl = JSON.parse(row.idl_json as string) as AnchorIDL
    return {
      idl,
      programId: row.program_id as string,
      projectName: row.name as string,
      cpiMd: (row.cpi_md as string | null) ?? null,
    }
  } catch {
    return null
  }
}

// ── MCP server factory ────────────────────────────────────────────────────────

function createServer(env: Bindings): McpServer {
  const server = new McpServer({ name: 'orquestra', version: '1.0.0' })

  // ── Tool 1: search_programs ──────────────────────────────────────────────────

  server.tool(
    'search_programs',
    'Search the orquestra registry for Solana programs. Supply either a text query (matches name/description) or a Solana programId (base58 public key). Returns a list of matching projects with their IDs, names, program IDs, and descriptions.',
    {
      query: z
        .string()
        .max(100)
        .optional()
        .describe('Free-text search term to match against program name or description'),
      programId: z
        .string()
        .optional()
        .describe('Exact Solana program ID (base58 public key) to look up'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(10)
        .describe('Maximum number of results to return (1–20)'),
    },
    async ({ query, programId, limit }) => {
      try {
        const db = env.DB
        let results: any[] = []

        if (programId) {
          // Exact lookup by program ID
          const row = await db
            ?.prepare(
              `SELECT p.id, p.name, p.program_id, p.description, p.updated_at, u.username
               FROM projects p LEFT JOIN users u ON p.user_id = u.id
               WHERE p.program_id = ? AND p.is_public = 1
               LIMIT 1`,
            )
            .bind(programId)
            .first()
          if (row) results = [row]
        } else if (query) {
          // Use FTS search for text queries
          const { results: searchResults } = await searchProjects(db, query, limit, 0)
          results = searchResults.map((r) => ({
            id: r.id,
            name: r.name,
            program_id: r.program_id,
            description: r.description,
            updated_at: r.updated_at || new Date().toISOString(),
            username: r.username,
          }))
        } else {
          // Return recent public projects
          const { results: rows } = await db
            ?.prepare(
              `SELECT p.id, p.name, p.program_id, p.description, p.updated_at, u.username
               FROM projects p LEFT JOIN users u ON p.user_id = u.id
               WHERE p.is_public = 1
               ORDER BY p.updated_at DESC LIMIT ?`,
            )
            .bind(limit)
            .all()
          results = rows ?? []
        }

        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No programs found matching your query.' }] }
        }

        const lines = results.map(
          (r: any) =>
            `- **${r.name}** (projectId: \`${r.id}\`)\n  Program: \`${r.program_id}\`${r.description ? `\n  ${r.description}` : ''}${r.username ? `\n  Author: ${r.username}` : ''}`,
        )
        return {
          content: [
            {
              type: 'text',
              text: `Found ${results.length} program(s):\n\n${lines.join('\n\n')}`,
            },
          ],
        }
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Error: ${err.message}` }] }
      }
    },
  )

  // ── Tool 2: list_instructions ────────────────────────────────────────────────

  server.tool(
    'list_instructions',
    'List all instructions for a given project, including their arguments (with types) and accounts (with mutability/signer flags). Use this before build_instruction to understand what inputs are required.',
    {
      projectId: z.string().describe('The orquestra project ID (from search_programs)'),
    },
    async ({ projectId }) => {
      try {
        const data = await fetchIDL(projectId, env)
        if (!data) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Project "${projectId}" not found or is private.` }],
          }
        }

        const { idl, programId, projectName } = data
        const lines: string[] = [
          `# ${projectName} — Instructions`,
          `Program ID: \`${programId}\``,
          '',
        ]

        for (const ix of idl.instructions) {
          lines.push(`## ${ix.name}`)
          if (ix.docs?.length) lines.push(`> ${ix.docs.join(' ')}`)
          lines.push('')

          if (ix.args.length > 0) {
            const expanded = expandInstructionArgs(idl, ix.args)
            lines.push('**Arguments:**')
            for (const arg of expanded) {
              lines.push(`  - \`${arg.name}\`: ${arg.typeStr}`)
              if (arg.isDefinedType && arg.fields?.length) {
                for (const f of arg.fields) {
                  lines.push(`    - \`${f.name}\`: ${f.typeStr}`)
                }
              }
            }
            lines.push('')
          }

          if (ix.accounts.length > 0) {
            lines.push('**Accounts:**')
            for (const raw of ix.accounts) {
              const acc = normalizeAccountMeta(raw)
              const flags = [
                acc.isMut ? 'writable' : 'readonly',
                acc.isSigner ? 'signer' : '',
                acc.isOptional ? 'optional' : '',
              ]
                .filter(Boolean)
                .join(', ')
              lines.push(`  - \`${acc.name}\` [${flags}]`)
            }
            lines.push('')
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Error: ${err.message}` }] }
      }
    },
  )

  // ── Tool 3: build_instruction ────────────────────────────────────────────────

  server.tool(
    'build_instruction',
    'Build a serialized Solana transaction for a specific instruction. Returns a base58 transaction string that can be signed and submitted. Use list_instructions first to get the required accounts and args.',
    {
      projectId: z.string().describe('The orquestra project ID'),
      instruction: z.string().describe('Instruction name (exact or camelCase/snake_case variant)'),
      accounts: z
        .record(z.string())
        .describe('Map of account name → base58 public key for each required account'),
      args: z
        .record(z.unknown())
        .default({})
        .describe('Map of argument name → value. Omit or pass {} for instructions with no args.'),
      feePayer: z.string().describe('Base58 public key of the transaction fee payer'),
      recentBlockhash: z
        .string()
        .optional()
        .describe(
          'Recent blockhash (base58). If omitted, will be fetched from the configured RPC.',
        ),
      network: z
        .enum(['mainnet-beta', 'devnet', 'testnet'])
        .optional()
        .describe('Solana network. Defaults to mainnet-beta.'),
    },
    async ({ projectId, instruction, accounts, args, feePayer, recentBlockhash, network }) => {
      try {
        const data = await fetchIDL(projectId, env)
        if (!data) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Project "${projectId}" not found or is private.` }],
          }
        }

        const rpcUrl = env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

        const result = await buildTransaction(
          data.idl,
          instruction,
          {
            accounts,
            args: args as Record<string, any>,
            feePayer,
            recentBlockhash,
            network,
          },
          data.programId,
          rpcUrl,
        )

        const output = [
          `**Transaction built for \`${instruction}\`**`,
          '',
          `Serialized transaction (base58):`,
          `\`${result.serializedTransaction}\``,
          '',
          `Message: ${result.message}`,
          `Estimated fee: ${result.estimatedFee} lamports`,
          '',
          '**Accounts used:**',
          ...result.accounts.map(
            (a) =>
              `  - \`${a.name}\`: \`${a.pubkey}\` [${a.isWritable ? 'writable' : 'readonly'}${a.isSigner ? ', signer' : ''}]`,
          ),
        ]

        return { content: [{ type: 'text', text: output.join('\n') }] }
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Error: ${err.message}` }] }
      }
    },
  )

  // ── Tool 4: list_pda_accounts ────────────────────────────────────────────────

  server.tool(
    'list_pda_accounts',
    'List all PDA-derivable accounts for a project, including the seed schemas needed to derive each one. Use this before derive_pda to understand which accounts can be derived and what seed values are required.',
    {
      projectId: z.string().describe('The orquestra project ID'),
    },
    async ({ projectId }) => {
      try {
        const data = await fetchIDL(projectId, env)
        if (!data) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Project "${projectId}" not found or is private.` }],
          }
        }

        const pdaAccounts = listPdaAccounts(data.idl)

        if (pdaAccounts.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No PDA-derivable accounts found in the ${data.projectName} IDL.`,
              },
            ],
          }
        }

        const lines: string[] = [
          `# ${data.projectName} — PDA Accounts`,
          `Program ID: \`${data.programId}\``,
          `Found ${pdaAccounts.length} derivable account(s):`,
          '',
        ]

        for (const pda of pdaAccounts) {
          lines.push(`## \`${pda.account}\` (instruction: \`${pda.instruction}\`)`)
          if (pda.customProgram) lines.push(`Program: \`${pda.customProgram}\``)
          if (pda.seeds.length > 0) {
            lines.push('Seeds:')
            for (const seed of pda.seeds) {
              const desc = seed.name
                ? `\`${seed.name}\` (${seed.kind}${seed.type ? `, type: ${seed.type}` : ''})`
                : seed.kind
              lines.push(`  - ${desc}${seed.description ? ` — ${seed.description}` : ''}`)
            }
          }
          lines.push('')
        }

        lines.push(
          'Use `derive_pda` with the instruction name, account name, and seed values to derive the address.',
        )

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Error: ${err.message}` }] }
      }
    },
  )

  // ── Tool 5: derive_pda ───────────────────────────────────────────────────────

  server.tool(
    'derive_pda',
    'Derive a Program Derived Address (PDA) for a specific account in a project. Provide the instruction name, account name, and the seed values shown by list_pda_accounts. Returns the derived public key and bump seed.',
    {
      projectId: z.string().describe('The orquestra project ID'),
      instruction: z.string().describe('Instruction name that contains the PDA account'),
      account: z.string().describe('Account name to derive the PDA for'),
      seedValues: z
        .record(z.unknown())
        .describe(
          'Map of seed name → value. For pubkey seeds, pass a base58 string. For string/bytes seeds, pass the plain string. Check list_pda_accounts for required seed names.',
        ),
    },
    async ({ projectId, instruction, account, seedValues }) => {
      try {
        const data = await fetchIDL(projectId, env)
        if (!data) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Project "${projectId}" not found or is private.` }],
          }
        }

        const result = await derivePda(
          data.idl,
          data.programId,
          instruction,
          account,
          seedValues as Record<string, any>,
        )

        const lines = [
          `**Derived PDA for \`${account}\`**`,
          '',
          `Address: \`${result.pda}\``,
          `Bump: ${result.bump}`,
          `Program ID: \`${result.programId}\``,
          '',
          '**Seeds used:**',
          ...result.seeds.map((s) => {
            const label = s.name ?? s.kind
            return `  - ${label}: \`${s.value ?? ''}\` (hex: ${s.hex})`
          }),
        ]

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Error: ${err.message}` }] }
      }
    },
  )

  // ── Tool 6: read_llms_txt ────────────────────────────────────────────────────

  server.tool(
    'read_llms_txt',
    'Fetch the full AI-ready documentation for a project in llms.txt format (structured Markdown). Includes overview, all instruction details with parameter descriptions, account types, error codes, and integration examples. Best used for deep understanding of a program before building transactions.',
    {
      projectId: z.string().describe('The orquestra project ID'),
    },
    async ({ projectId }) => {
      try {
        const db = env.DB
        const project = await db
          ?.prepare(
            'SELECT name, program_id, is_public, custom_docs FROM projects WHERE id = ?',
          )
          .bind(projectId)
          .first()

        if (!project) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Project "${projectId}" not found.` }],
          }
        }

        if (!project.is_public) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Project "${projectId}" is private.` }],
          }
        }

        const apiBaseUrl = env.API_BASE_URL || 'https://api.orquestra.dev'
        let docsText = ''

        // 1. Custom docs override
        if (project.custom_docs) {
          docsText = project.custom_docs as string
        } else if (env.CACHE) {
          // 2. CACHE KV
          const cached = await env.CACHE.get(`docs:${projectId}`)
          if (cached) docsText = cached
        }

        // 3. Generate from IDL
        if (!docsText) {
          const row = await db
            ?.prepare(
              'SELECT idl_json, cpi_md FROM idl_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1',
            )
            .bind(projectId)
            .first()

          if (!row) {
            return {
              isError: true,
              content: [{ type: 'text', text: `No IDL found for project "${projectId}".` }],
            }
          }

          const idl = JSON.parse(row.idl_json as string) as AnchorIDL
          const docs = generateDocumentation(
            idl,
            project.program_id as string,
            apiBaseUrl,
            projectId,
            (row.cpi_md as string | null) ?? null,
          )
          docsText = docs.full

          if (env.CACHE) {
            await env.CACHE.put(`docs:${projectId}`, docsText, { expirationTtl: 604800 })
          }
        }

        return { content: [{ type: 'text', text: docsText }] }
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Error: ${err.message}` }] }
      }
    },
  )

  // ── Tool 7: get_ai_analysis ──────────────────────────────────────────────────

  server.tool(
    'get_ai_analysis',
    'Get the AI-generated analysis for a project: a short description, detailed analysis, tags, instruction/account counts, and the model used. Useful for quickly understanding what a program does before exploring its instructions.',
    {
      projectId: z.string().describe('The orquestra project ID'),
    },
    async ({ projectId }) => {
      try {
        const db = env.DB

        const project = await db
          ?.prepare('SELECT name, program_id, is_public FROM projects WHERE id = ?')
          .bind(projectId)
          .first()

        if (!project) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Project "${projectId}" not found.` }],
          }
        }

        if (!project.is_public) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Project "${projectId}" is private.` }],
          }
        }

        const analysis = await db
          ?.prepare(
            `SELECT a.short_description, a.detailed_analysis, a.model_used, a.generated_at,
                    v.version as idl_version
             FROM ai_analyses a
             JOIN idl_versions v ON a.idl_version_id = v.id
             WHERE a.project_id = ?
             ORDER BY a.created_at DESC LIMIT 1`,
          )
          .bind(projectId)
          .first()

        if (!analysis) {
          return {
            content: [
              {
                type: 'text',
                text: `No AI analysis available for "${project.name as string}" yet.`,
              },
            ],
          }
        }

        const lines: string[] = [
          `# AI Analysis: ${project.name as string}`,
          `Program ID: \`${project.program_id as string}\``,
          `IDL Version: ${analysis.idl_version}`,
          '',
        ]

        if (analysis.short_description) {
          lines.push(`**Summary:** ${analysis.short_description as string}`)
          lines.push('')
        }

        if (analysis.detailed_analysis) {
          let detail: any
          try {
            detail = JSON.parse(analysis.detailed_analysis as string)
          } catch {
            detail = null
          }

          if (detail) {
            if (detail.tags?.length) {
              lines.push(`**Tags:** ${(detail.tags as string[]).join(', ')}`)
            }
            if (detail.instructionCount != null) {
              lines.push(`**Instructions:** ${detail.instructionCount}`)
            }
            if (detail.accountCount != null) {
              lines.push(`**Accounts:** ${detail.accountCount}`)
            }
            if (detail.errorCount != null) {
              lines.push(`**Errors:** ${detail.errorCount}`)
            }
            if (detail.eventCount != null) {
              lines.push(`**Events:** ${detail.eventCount}`)
            }
            if (detail.summary) {
              lines.push('')
              lines.push(`**Detailed Analysis:**`)
              lines.push(detail.summary as string)
            }
          }
        }

        lines.push('')
        lines.push(`*Analysis generated by ${analysis.model_used as string} at ${analysis.generated_at as string}*`)

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Error: ${err.message}` }] }
      }
    },
  )

  return server
}

// ── Request handler ───────────────────────────────────────────────────────────

/**
 * Handle an incoming request for the MCP endpoint.
 * Call in the worker's fetch handler when pathname starts with "/mcp".
 *
 * Uses WebStandardStreamableHTTPServerTransport in stateless mode
 * (no sessionIdGenerator) so no Durable Objects or auth tokens are needed.
 * A fresh transport + server instance per request — correct for stateless Workers.
 */
export async function handleMcpRequest(
  request: Request,
  env: Bindings,
): Promise<Response> {
  const server = createServer(env)

  const transport = new WebStandardStreamableHTTPServerTransport({
    // No sessionIdGenerator → stateless mode: no session headers, no auth requirement
    sessionIdGenerator: undefined,
    enableJsonResponse: false,
  })

  await server.connect(transport)
  return transport.handleRequest(request)
}
