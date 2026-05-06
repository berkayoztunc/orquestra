import { Hono } from 'hono'
import type { D1Database, KVNamespace } from '@cloudflare/workers-types'
import { runTxAgent } from '../services/tx-agent'
import type { TxAgentRequest } from '../services/tx-agent'

type Env = {
  Variables: Record<string, unknown>
  Bindings: {
    DB: D1Database
    IDLS: KVNamespace
    AI: Ai
    SOLANA_RPC_URL?: string
    SOLANA_MAINNET_RPC_URL?: string
    SOLANA_DEVNET_RPC_URL?: string
    SOLANA_TESTNET_RPC_URL?: string
  }
}

const app = new Hono<Env>()

app.post('/tx', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Request body must be valid JSON' }, 400)
  }

  const validation = validateTxAgentRequest(body)
  if (!validation.ok) {
    return c.json({ error: validation.error }, 400)
  }

  const response = await runTxAgent(c.env, validation.request)
  return c.json(response, response.status === 'failed' && response.error ? 422 : 200)
})

function validateTxAgentRequest(body: unknown): { ok: true; request: TxAgentRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be an object' }
  }

  const request = body as Record<string, unknown>
  if (typeof request.message !== 'string' || request.message.trim().length === 0) {
    return { ok: false, error: 'message is required and must be a non-empty string' }
  }
  if (request.message.length > 4000) {
    return { ok: false, error: 'message must be 4000 characters or less' }
  }

  if (request.state !== undefined && (!request.state || typeof request.state !== 'object' || Array.isArray(request.state))) {
    return { ok: false, error: 'state must be an object when provided' }
  }

  return {
    ok: true,
    request: {
      message: request.message.trim(),
      state: request.state as TxAgentRequest['state'],
    },
  }
}

export default app
