import { Hono, type Context } from 'hono'
import type { D1Database, KVNamespace } from '@cloudflare/workers-types'

import { registerAllNodes } from '../flow-engine'
import { compile } from '../flow-engine/compiler'
import type { FlowDocument } from '../flow-engine/fdl-schema'
import type { NodeContext } from '../flow-engine/types'
import { resolveSolanaRpcUrl, RpcUrlNotAllowedError } from '../utils/solana-rpc'
import { ingestKeyMiddleware } from '../middleware/auth'
import { publishFlowVersion } from '../services/flow-publisher'
import { recordFlowRun } from '../services/flow-runs'
import { listFlows, getFlowMetadata } from '../services/flow-catalog'
import { cachePlan, estimateFlow } from '../services/flow-estimator'

registerAllNodes()

type Env = {
  Variables: Record<string, unknown>
  Bindings: {
    DB: D1Database
    CACHE: KVNamespace
    IDLS: KVNamespace
    INGEST_API_KEY: string
    SOLANA_RPC_URL: string
    SOLANA_MAINNET_RPC_URL?: string
    SOLANA_FALLBACK_RPC_URLS?: string
    SOLANA_MAINNET_FALLBACK_RPC_URLS?: string
    SOLANA_DEVNET_RPC_URL?: string
    SOLANA_TESTNET_RPC_URL?: string
  }
}

const app = new Hono<Env>()

/**
 * Every flow-engine response must be a response — never an unhandled throw
 * that falls through to the app-wide `errorHandler` middleware, which
 * deliberately strips error messages for security (`message: undefined`,
 * see middleware/error-handler.ts). That's correct for the general API, but
 * wrong here: flow responses are consumed by LLMs deciding whether to retry,
 * fix their FDL, or fix their inputs — they need a real reason every time,
 * including when the failure is on our side. `kind: 'system_error'` is the
 * one case where the underlying message isn't included in the response
 * (logged server-side instead, same posture as the rest of the app) — every
 * other kind is safe to expose in full because it only ever describes the
 * flow's own structure or the caller's own inputs, never server internals.
 */
function systemErrorResponse(c: Context<Env>, route: string, err: unknown) {
  // A caller-supplied RPC URL that failed the allowlist is the caller's problem,
  // not a system fault — and it must not be reported as a retryable 500.
  if (err instanceof RpcUrlNotAllowedError) {
    return c.json({ ok: false, kind: 'invalid_input', reason: err.message }, 400)
  }

  console.error(`${route} failed`, err)
  return c.json(
    {
      ok: false,
      kind: 'system_error',
      reason:
        'Internal server error handling this request. This is not necessarily a problem with the flow, ' +
        'the FDL, or the inputs provided — retry, or report it if it persists.',
    },
    500,
  )
}

/**
 * GET /flows — catalog listing/search, read from the D1 `flows`/`flow_versions`
 * registry (migration 024). Empty until something is actually published —
 * there is no built-in/bundled flow data. Query params: `q` (free-text),
 * `intent`, `protocol`, `limit`. The same search is exposed over MCP as the
 * `list_flows` tool (routes/flow-mcp.ts) for MCP-only clients.
 */
app.get('/', async (c) => {
  try {
    const flows = await listFlows(c.env.DB, {
      query: c.req.query('q') || undefined,
      intent: c.req.query('intent') || undefined,
      protocol: c.req.query('protocol') || undefined,
      limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
    })
    return c.json({ ok: true, flows })
  } catch (err) {
    return systemErrorResponse(c, 'GET /flows', err)
  }
})

/** GET /flows/:slug — published contract for one flow. */
app.get('/:slug', async (c) => {
  const slug = c.req.param('slug')
  try {
    const flow = await getFlowMetadata(c.env.DB, slug)
    if (!flow) {
      return c.json({ ok: false, kind: 'not_found', reason: `No published flow with slug "${slug}".` }, 404)
    }
    return c.json({ ok: true, ...flow })
  } catch (err) {
    return systemErrorResponse(c, `GET /flows/${slug}`, err)
  }
})

/**
 * POST /flows — admin publish/upload. Same `X-Ingest-Key` auth as the
 * existing IDL bulk-ingest endpoint (`POST /api/ingest/idl`). Compiles the
 * submitted FDL document (rejecting anything that fails the static
 * compiler — unknown node types, cycles, dangling references), then
 * upserts it into the D1 `flows`/`flow_versions` registry (migration 024)
 * as a new content-addressed version.
 *
 * This is the one and only write path into the flow catalog today — there
 * is no AI-authoring pipeline yet (design doc §8.3, later phase). Until
 * that exists, flows are hand-authored (or generated out-of-band by
 * whatever means) and uploaded through this endpoint.
 *
 * Body: { fdl: FlowDocument, tier?: 'instruction'|'intent'|'composed', publish?: boolean }
 * `publish` defaults to true — this endpoint is already the trusted/admin
 * approval gate (protected by INGEST_API_KEY), so there's no separate
 * review step for MVP. Pass `publish: false` to land a draft version
 * without moving the `@stable` alias.
 */
app.post('/', ingestKeyMiddleware, async (c) => {
  try {
    type PublishBody = { fdl?: FlowDocument; tier?: string; publish?: boolean }
    const body = await c.req.json<PublishBody>().catch((): PublishBody => ({}))

    if (!body.fdl) {
      return c.json({ ok: false, kind: 'bad_request', reason: 'body.fdl is required.' }, 400)
    }

    const compiled = await compile(body.fdl)
    if (!compiled.ok) {
      return c.json(
        {
          ok: false,
          kind: 'compile_error',
          reason: 'FDL failed to compile — not published. See `errors` for exactly what to fix.',
          errors: compiled.errors,
        },
        400,
      )
    }

    const { plan } = compiled
    const result = await publishFlowVersion(c.env.DB, body.fdl, plan, {
      tier: body.tier,
      publish: body.publish,
      requireProof: true,
    })
    cachePlan(plan)

    return c.json({ ok: true, ...result })
  } catch (err) {
    return systemErrorResponse(c, 'POST /flows', err)
  }
})

/**
 * POST /flows/:slug/estimate — resolve + build + compose + simulate. No
 * payment, no settlement (x402 execute endpoint is a later phase). Response
 * is watermarked `estimate` per design doc §15's `estimate_flow` contract.
 * Same logic is exposed over MCP as the `estimate_flow` tool.
 */
app.post('/:slug/estimate', async (c) => {
  const slug = c.req.param('slug')
  try {
    type EstimateBody = { inputs?: Record<string, unknown>; network?: string; rpcUrlOverride?: string }
    const body = await c.req.json<EstimateBody>().catch((): EstimateBody => ({ inputs: {} }))

    const { rpcUrl } = resolveSolanaRpcUrl({
      network: body.network ?? 'mainnet',
      rpcUrlOverride: body.rpcUrlOverride,
      env: c.env,
    })
    const ctx: NodeContext = { db: c.env.DB, cache: c.env.CACHE, idls: c.env.IDLS, rpcUrl }

    const outcome = await estimateFlow(c.env.DB, ctx, slug, body.inputs ?? {})
    if (!outcome.ok) {
      return c.json({ ok: false, watermark: 'estimate', kind: outcome.kind, reason: outcome.reason }, 404)
    }

    const { versionHash, latencyMs, result } = outcome.outcome
    c.executionCtx?.waitUntil(
      recordFlowRun(c.env.DB, { versionHash, inputs: body.inputs ?? {}, result, latencyMs }).catch((err) =>
        console.error(`failed to record flow_runs row for ${slug}`, err),
      ),
    )

    if (!result.ok) {
      return c.json(
        {
          ok: false,
          watermark: 'estimate',
          kind: 'run_error',
          reason: result.error.message,
          nodeId: result.error.nodeId ?? null,
          partialOutputs: result.nodeOutputs,
        },
        422,
      )
    }

    return c.json({ ok: true, watermark: 'estimate', outputs: result.nodeOutputs })
  } catch (err) {
    return systemErrorResponse(c, `POST /flows/${slug}/estimate`, err)
  }
})

export default app
