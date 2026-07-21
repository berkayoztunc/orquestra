/**
 * `resolve.quote@1` — price/route quote for a token swap. Design doc §7.3:
 * "Jupiter v6 (primary), protocol-native (fallback)." This MVP wraps Jupiter
 * only (the fallback path is a follow-up). URL-building and response-parsing
 * are pure, exported, unit-testable functions, separate from the actual
 * `fetch` — this node is what `external.http@1`'s allowlist exists for
 * (`quote-api.jup.ag` is the one entry in `EXTERNAL_HTTP_ALLOWLIST`).
 * Classified `external`, not `read` — it's a third-party HTTP call, not RPC.
 */

import type { NodeImplementation } from '../types'
import { registerNode } from '../node-registry'
import { isUrlAllowlisted } from '../nodes/external-http'

export interface ResolveQuoteInput {
  inputMint: string
  outputMint: string
  /** Input amount in base units (decimal string), e.g. "1000000". */
  amount: string
  /** Defaults to 50 (0.5%). */
  slippageBps?: number
}

export interface ResolveQuoteOutput {
  outAmount: string
  minOutAmount: string
  priceImpactPct: string | null
  route: unknown
}

const JUPITER_QUOTE_BASE = 'https://quote-api.jup.ag/v6/quote'

/** Pure — builds the Jupiter v6 quote URL. Exported for unit testing without a network call. */
export function buildJupiterQuoteUrl(input: ResolveQuoteInput): string {
  const params = new URLSearchParams({
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    amount: input.amount,
    slippageBps: String(input.slippageBps ?? 50),
  })
  return `${JUPITER_QUOTE_BASE}?${params.toString()}`
}

interface JupiterQuoteResponse {
  outAmount: string
  otherAmountThreshold: string
  priceImpactPct?: string
  [key: string]: unknown
}

/** Pure — parses a Jupiter v6 quote response. Exported for unit testing with a fixture, no network call. */
export function parseJupiterQuoteResponse(json: unknown): ResolveQuoteOutput {
  const data = json as JupiterQuoteResponse
  if (typeof data?.outAmount !== 'string' || typeof data?.otherAmountThreshold !== 'string') {
    throw new Error('resolve.quote@1: unexpected Jupiter response shape (missing outAmount/otherAmountThreshold)')
  }
  return {
    outAmount: data.outAmount,
    minOutAmount: data.otherAmountThreshold,
    priceImpactPct: data.priceImpactPct ?? null,
    route: data,
  }
}

export const resolveQuoteNode: NodeImplementation<ResolveQuoteInput, ResolveQuoteOutput> = {
  type: 'resolve.quote',
  major: 1,
  effect: 'external',
  async run(input: ResolveQuoteInput): Promise<ResolveQuoteOutput> {
    const url = buildJupiterQuoteUrl(input)
    if (!isUrlAllowlisted(url)) {
      throw new Error(`resolve.quote@1: built URL "${url}" is not on the external.http allowlist`)
    }
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`resolve.quote@1: Jupiter quote request failed with status ${response.status}`)
    }
    return parseJupiterQuoteResponse(await response.json())
  },
}

registerNode(resolveQuoteNode as unknown as NodeImplementation)
