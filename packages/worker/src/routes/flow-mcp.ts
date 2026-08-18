/**
 * Orquestra Flow Engine (OFE) MCP Server
 *
 * Separate MCP server from the main Orquestra MCP (`routes/mcp.ts`, mounted at
 * `/mcp`) — this one is mounted at `/flow/mcp` and exposes the full flow
 * lifecycle: find a published flow, inspect it, run it, or author/test/publish
 * a new one. Split out so a client connecting specifically to work with flows
 * gets a small, focused tool list instead of the full 10-tool program-
 * discovery surface. For program/IDL discovery (search_programs, list_instructions,
 * read_llms_txt, etc.) a client still connects to the main `/mcp` server
 * — the two are meant to be used together, just as separate connections.
 *
 * No flow GENERATION happens on the server — authoring tools only document the
 * FDL grammar + node catalog, validate, simulate, and publish what the client
 * (any MCP-connected LLM) writes itself.
 *
 * Endpoint: GET|POST /flow/mcp
 *
 * Tools:
 *   Discovery (find and run an ALREADY-PUBLISHED flow — the fast path, no authoring needed):
 *     1. list_flows        — search/list published flows by free-text query, intent, or protocol
 *     2. get_flow_metadata — full published contract (inputs/outputs) for one flow by slug
 *     3. estimate_flow     — actually run a published flow: resolve + build + compose + simulate,
 *                            returns the unsigned transaction(s). No payment, no signing.
 *   Authoring (only needed when no existing flow covers what you want):
 *     4. get_flow_schema — FDL grammar + node-type catalog docs, for an LLM to author a flow from
 *     5. validate_flow   — static-compile a draft FDL document (no RPC, no DB)
 *     6. simulate_flow   — compile + run a draft FDL document against real RPC (no publish/payment)
 *     7. publish_flow    — publish a proven FDL document into the flow registry (requires ingestKey)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'

import { registerAllNodes } from '../flow-engine'
import { compile } from '../flow-engine/compiler'
import { run } from '../flow-engine/interpreter'
import { getFlowSchemaDocument } from '../flow-engine/schema-docs'
import type { FlowDocument } from '../flow-engine/fdl-schema'
import type { NodeContext } from '../flow-engine/types'
import { publishFlowVersion } from '../services/flow-publisher'
import { recordFlowRun } from '../services/flow-runs'
import { listFlows, getFlowMetadata } from '../services/flow-catalog'
import { cachePlan, estimateFlow } from '../services/flow-estimator'
import { verifyIngestKey } from '../middleware/auth'
import { resolveSolanaRpcUrl, RpcUrlNotAllowedError } from '../utils/solana-rpc'
import { incrementEvent, EVENT_TYPE, MCP_TOOL } from '../services/analytics'

registerAllNodes()

/**
 * Every tool's outer catch reaches this — an error that escaped the tool's
 * own explicit compile/run-failure handling (a thrown D1 error, a resolver
 * bug, a malformed rpcUrl, anything unexpected). This is deliberately
 * labeled distinctly from "Compile failed"/"Run failed" so an LLM caller can
 * tell "the FDL/inputs are wrong, fix them" apart from "this is a server
 * problem, not yours — retry or report it" and doesn't waste turns rewriting
 * an FDL that was actually fine. The raw message is logged server-side but
 * not echoed to the caller, matching the rest of the app's error posture
 * (middleware/error-handler.ts) — everything else this file returns (compile
 * errors, run errors, node ids) is safe to expose in full because it only
 * ever describes the flow's own structure, never server internals.
 */
function systemErrorContent(toolName: string, err: unknown) {
  // A rejected caller-supplied `rpcUrl` is an input problem, not a server fault —
  // report it as such so the agent can correct the call instead of retrying.
  // The message carries the hostname only, never the URL (which may embed a key).
  if (err instanceof RpcUrlNotAllowedError) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `**Invalid input:** ${err.message}` }],
    }
  }

  console.error(`[flow-mcp] ${toolName} failed unexpectedly`, err)
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text:
          `**System error (not a flow/FDL issue):** something went wrong on the server side of \`${toolName}\`. ` +
          'This is not a signal that your FDL or inputs are invalid — retry, or report it if it persists.',
      },
    ],
  }
}

type Bindings = {
  DB: any
  IDLS: any
  CACHE: any
  INGEST_API_KEY?: string
  SOLANA_RPC_URL?: string
  SOLANA_MAINNET_RPC_URL?: string
  SOLANA_FALLBACK_RPC_URLS?: string
  SOLANA_MAINNET_FALLBACK_RPC_URLS?: string
  SOLANA_DEVNET_RPC_URL?: string
  SOLANA_TESTNET_RPC_URL?: string
}

// ── Tool schemas ────────────────────────────────────────────────────────────

const listFlowsSchema = {
  query: z.string().optional().describe('Free-text search over slug, name, intent, protocol, and program addresses. Omit to list everything.'),
  intent: z.string().optional().describe('Exact match on intent, e.g. "swap", "stake", "transfer".'),
  protocol: z.string().optional().describe('Exact match on protocol name.'),
  limit: z.number().int().positive().optional().describe('Max results. No limit if omitted.'),
}

const getFlowMetadataSchema = {
  slug: z.string().describe('The flow slug, from list_flows.'),
}

const estimateFlowSchema = {
  slug: z.string().describe('The flow slug to run, from list_flows.'),
  inputs: z.record(z.string(), z.any()).default({}).describe('Values for the flow\'s declared `inputs` (see get_flow_metadata) — e.g. { "wallet": "...", "amount": "1000" }.'),
  network: z.enum(['mainnet-beta', 'devnet', 'testnet']).optional().describe('Solana cluster. Defaults to mainnet-beta.'),
  rpcUrl: z.string().optional().describe('Optional full RPC URL override. Takes precedence over network. Must be an https URL on an allowlisted RPC provider (api.*.solana.com, helius-rpc.com, quiknode.pro, rpcpool.com).'),
}

const validateFlowSchema = {
  fdl: z
    .record(z.string(), z.any())
    .describe('The full FDL flow document JSON. Call get_flow_schema first if you have not already.'),
}

const simulateFlowSchema = {
  fdl: z.record(z.string(), z.any()).describe('The full FDL flow document JSON (not yet published).'),
  inputs: z
    .record(z.string(), z.any())
    .default({})
    .describe('Test values for the flow\'s declared `inputs`, e.g. { "wallet": "...", "amount": "1000" }.'),
  network: z
    .enum(['mainnet-beta', 'devnet', 'testnet'])
    .optional()
    .describe('Solana cluster for resolver/simulation RPC calls. Defaults to mainnet-beta.'),
  rpcUrl: z.string().optional().describe('Optional full RPC URL override. Takes precedence over network. Must be an https URL on an allowlisted RPC provider (api.*.solana.com, helius-rpc.com, quiknode.pro, rpcpool.com).'),
}

const publishFlowSchema = {
  fdl: z.record(z.string(), z.any()).describe('The full FDL flow document JSON — should already pass validate_flow/simulate_flow.'),
  ingestKey: z.string().describe('Your INGEST_API_KEY (X-Ingest-Key). Required — publishing is not open/anonymous.'),
  tier: z
    .enum(['instruction', 'intent', 'composed'])
    .optional()
    .describe('Catalog tier. Defaults to "instruction" (single-instruction flow).'),
  publish: z
    .boolean()
    .optional()
    .describe('Defaults to true (goes live immediately). Pass false to land a draft version without publishing.'),
}

// ── MCP server factory ──────────────────────────────────────────────────────

function createFlowServer(env: Bindings, ctx: ExecutionContext): McpServer {
  const server = new McpServer({ name: 'orquestra-flows', version: '1.0.0' })

  server.tool(
    'list_flows',
    'Search/list PUBLISHED flows — the fastest path to a working transaction: if a flow already ' +
      'covers what you need, call this instead of authoring one from scratch. Filter by free-text ' +
      '`query` (matches slug/name/intent/protocol/program addresses), exact `intent`, or exact ' +
      '`protocol`. Returns each flow\'s full contract (inputs/outputs) directly — usually no separate ' +
      'get_flow_metadata call is needed. Empty result means no existing flow covers your case; fall ' +
      'back to get_flow_schema and author one.',
    listFlowsSchema,
    async ({ query, intent, protocol, limit }) => {
      try {
        incrementEvent(env.DB, ctx, { eventType: EVENT_TYPE.mcp, toolId: MCP_TOOL.list_flows })
        const flows = await listFlows(env.DB, { query, intent, protocol, limit })
        if (flows.length === 0) {
          return { content: [{ type: 'text', text: 'No published flows matched. Consider authoring one — see get_flow_schema.' }] }
        }
        return { content: [{ type: 'text', text: JSON.stringify({ flows }, null, 2) }] }
      } catch (err) {
        return systemErrorContent('list_flows', err)
      }
    },
  )

  server.tool(
    'get_flow_metadata',
    'Get the full published contract (meta/inputs/outputs) for one flow by slug, from list_flows.',
    getFlowMetadataSchema,
    async ({ slug }) => {
      try {
        incrementEvent(env.DB, ctx, { eventType: EVENT_TYPE.mcp, toolId: MCP_TOOL.get_flow_metadata })
        const flow = await getFlowMetadata(env.DB, slug)
        if (!flow) {
          return { isError: true, content: [{ type: 'text', text: `**Not found:** no published flow with slug "${slug}". Call list_flows to see what exists.` }] }
        }
        return { content: [{ type: 'text', text: JSON.stringify(flow, null, 2) }] }
      } catch (err) {
        return systemErrorContent('get_flow_metadata', err)
      }
    },
  )

  server.tool(
    'estimate_flow',
    'RUN a published flow found via list_flows — resolves accounts, builds the real instruction(s), ' +
      'composes and simulates. Returns the unsigned transaction(s) (base64 v0) ready to hand to a ' +
      'wallet/signer. No payment, no signing performed here. This is the tool that actually produces ' +
      'the transaction an agent is looking for — use it once you have picked a flow and know its ' +
      '`inputs` (from get_flow_metadata).',
    estimateFlowSchema,
    async ({ slug, inputs, network, rpcUrl }) => {
      try {
        incrementEvent(env.DB, ctx, { eventType: EVENT_TYPE.mcp, toolId: MCP_TOOL.estimate_flow })

        const { rpcUrl: resolvedRpc } = resolveSolanaRpcUrl({ network: network ?? 'mainnet-beta', rpcUrlOverride: rpcUrl, env })
        const nodeCtx: NodeContext = { db: env.DB, cache: env.CACHE, idls: env.IDLS, rpcUrl: resolvedRpc }

        const outcome = await estimateFlow(env.DB, nodeCtx, slug, inputs ?? {})
        if (!outcome.ok) {
          return { isError: true, content: [{ type: 'text', text: `**Not found:** ${outcome.reason} Call list_flows to see what exists.` }] }
        }

        const { versionHash, latencyMs, result } = outcome.outcome
        ctx.waitUntil(
          recordFlowRun(env.DB, { versionHash, inputs: inputs ?? {}, result, latencyMs }).catch((err) =>
            console.error('failed to record flow_runs row for estimate_flow', err),
          ),
        )

        if (!result.ok) {
          const lines = [
            '**Run failed:**',
            `Node: \`${result.error.nodeId ?? '(top-level)'}\``,
            `Message: ${result.error.message}`,
            '',
            'Partial node outputs so far:',
            '```json',
            JSON.stringify(result.nodeOutputs, null, 2),
            '```',
          ]
          return { isError: true, content: [{ type: 'text', text: lines.join('\n') }] }
        }

        const lines = ['**Run succeeded.** Watermark: `estimate` — no payment, nothing signed/submitted.', '', 'Outputs:', '```json', JSON.stringify(result.nodeOutputs, null, 2), '```']
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        return systemErrorContent('estimate_flow', err)
      }
    },
  )

  server.tool(
    'get_flow_schema',
    'Get the Flow Definition Language (FDL) grammar and the full node-type catalog, so you can author a ' +
      'flow yourself for any program. This server does NOT generate flows — it only documents how, plus ' +
      'validates/simulates/publishes what you write. Typical order: connect to the main Orquestra /mcp ' +
      'server for search_programs → list_instructions → then write the FDL using this doc → validate_flow ' +
      '→ simulate_flow → publish_flow.',
    {},
    async () => {
      try {
        incrementEvent(env.DB, ctx, { eventType: EVENT_TYPE.mcp, toolId: MCP_TOOL.get_flow_schema })
        return { content: [{ type: 'text', text: getFlowSchemaDocument() }] }
      } catch (err) {
        return systemErrorContent('get_flow_schema', err)
      }
    },
  )

  server.tool(
    'validate_flow',
    'Statically validate a draft FDL flow document — checks structure, unknown node types, reference ' +
      'cycles, and dangling `$refs`. No RPC calls, no DB writes, nothing published. Use this first, before ' +
      'simulate_flow, to catch structural mistakes cheaply.',
    validateFlowSchema,
    async ({ fdl }) => {
      try {
        incrementEvent(env.DB, ctx, { eventType: EVENT_TYPE.mcp, toolId: MCP_TOOL.validate_flow })
        const result = await compile(fdl as unknown as FlowDocument)
        if (!result.ok) {
          const lines = ['**Compile failed:**', ...result.errors.map((e) => `  - ${e.nodeId ?? e.path ?? ''}: ${e.message}`)]
          return { isError: true, content: [{ type: 'text', text: lines.join('\n') }] }
        }
        const lines = [
          '**Compiled OK.**',
          `Content hash: \`${result.plan.hash}\``,
          `Execution strata: ${JSON.stringify(result.plan.strata.map((s) => s.map((n) => n.id)))}`,
          `Budgets: ${JSON.stringify(result.plan.budgets)}`,
        ]
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        return systemErrorContent('validate_flow', err)
      }
    },
  )

  server.tool(
    'simulate_flow',
    'Compile AND RUN a draft FDL flow document against real RPC — resolves PDAs/ATAs, builds the real ' +
      'instruction(s) from the live IDL, composes and simulates the transaction. Nothing is published, no ' +
      'payment involved. Use this to prove a flow actually works before publish_flow.',
    simulateFlowSchema,
    async ({ fdl, inputs, network, rpcUrl }) => {
      try {
        incrementEvent(env.DB, ctx, { eventType: EVENT_TYPE.mcp, toolId: MCP_TOOL.simulate_flow })
        const compiled = await compile(fdl as unknown as FlowDocument)
        if (!compiled.ok) {
          const lines = ['**Compile failed:**', ...compiled.errors.map((e) => `  - ${e.nodeId ?? e.path ?? ''}: ${e.message}`)]
          return { isError: true, content: [{ type: 'text', text: lines.join('\n') }] }
        }

        const { rpcUrl: resolvedRpc } = resolveSolanaRpcUrl({ network: network ?? 'mainnet-beta', rpcUrlOverride: rpcUrl, env })
        const nodeCtx: NodeContext = { db: env.DB, cache: env.CACHE, idls: env.IDLS, rpcUrl: resolvedRpc }
        const startedAt = Date.now()
        const result = await run(compiled.plan, inputs ?? {}, nodeCtx)
        const latencyMs = Date.now() - startedAt

        ctx.waitUntil(
          recordFlowRun(env.DB, { versionHash: compiled.plan.hash, inputs: inputs ?? {}, result, latencyMs }).catch((err) =>
            console.error('failed to record flow_runs row for simulate_flow', err),
          ),
        )

        if (!result.ok) {
          const lines = [
            '**Run failed:**',
            `Node: \`${result.error.nodeId ?? '(top-level)'}\``,
            `Message: ${result.error.message}`,
            '',
            'Partial node outputs so far:',
            '```json',
            JSON.stringify(result.nodeOutputs, null, 2),
            '```',
          ]
          return { isError: true, content: [{ type: 'text', text: lines.join('\n') }] }
        }

        const lines = ['**Run succeeded.**', '', 'Node outputs:', '```json', JSON.stringify(result.nodeOutputs, null, 2), '```']
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        return systemErrorContent('simulate_flow', err)
      }
    },
  )

  server.tool(
    'publish_flow',
    'Publish a proven FDL flow document into the flow registry (D1 `flows`/`flow_versions`). Requires ' +
      'ingestKey (INGEST_API_KEY). Compiles the document first — publishing an FDL that fails to compile ' +
      'is rejected, same as validate_flow. Idempotent on identical FDL content (content-addressed).',
    publishFlowSchema,
    async ({ fdl, ingestKey, tier, publish }) => {
      try {
        if (!verifyIngestKey(ingestKey, env.INGEST_API_KEY)) {
          return { isError: true, content: [{ type: 'text', text: '**Unauthorized:** invalid or missing `ingestKey`. Not a flow/FDL problem — nothing was validated or published.' }] }
        }
        incrementEvent(env.DB, ctx, { eventType: EVENT_TYPE.mcp, toolId: MCP_TOOL.publish_flow })

        const doc = fdl as unknown as FlowDocument
        const compiled = await compile(doc)
        if (!compiled.ok) {
          const lines = ['**Compile failed — not published:**', ...compiled.errors.map((e) => `  - ${e.nodeId ?? e.path ?? ''}: ${e.message}`)]
          return { isError: true, content: [{ type: 'text', text: lines.join('\n') }] }
        }

        const result = await publishFlowVersion(env.DB, doc, compiled.plan, { tier, publish, requireProof: true })
        cachePlan(compiled.plan)
        const lines = [
          `**Published.**`,
          `Slug: \`${result.slug}\``,
          `Status: \`${result.status}\``,
          `Content hash: \`${result.contentHash}\``,
        ]
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        return systemErrorContent('publish_flow', err)
      }
    },
  )

  return server
}

// ── Request handler ─────────────────────────────────────────────────────────

export async function handleFlowMcpRequest(
  request: Request,
  env: Bindings,
  ctx: ExecutionContext,
): Promise<Response> {
  const server = createFlowServer(env, ctx)

  const transport = new WebStandardStreamableHTTPServerTransport({
    // No sessionIdGenerator → stateless mode: no session headers, no auth requirement
    sessionIdGenerator: undefined,
    enableJsonResponse: false,
  })

  await server.connect(transport)
  return transport.handleRequest(request)
}
