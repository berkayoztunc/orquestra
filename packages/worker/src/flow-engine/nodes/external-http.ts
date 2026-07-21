/**
 * `external.http@1` — the engine's only generic outbound-HTTP node. Design
 * doc §12.4: "external.http targets an allowlist registry (exact hosts +
 * path prefixes + methods), never caller-supplied URLs — SSRF is excluded by
 * construction, not by filtering." The URL is typically built from a flow's
 * own inputs (so it's not a literal, static string at author time), which is
 * exactly why the allowlist check happens at RUN time against the fully
 * resolved URL, not at compile time.
 *
 * `EXTERNAL_HTTP_ALLOWLIST` is intentionally tiny and hardcoded for now — a
 * real per-protocol allowlist registry (design doc's "allowlist registry")
 * is a follow-up; this is the honest MVP boundary: a short, reviewed list of
 * hosts, not an open proxy.
 */

import type { NodeContext, NodeImplementation } from '../types'
import { registerNode } from '../node-registry'

export interface AllowlistEntry {
  host: string
  pathPrefix?: string
}

export const EXTERNAL_HTTP_ALLOWLIST: AllowlistEntry[] = [{ host: 'quote-api.jup.ag', pathPrefix: '/v6/' }]

export function isUrlAllowlisted(url: string, allowlist: AllowlistEntry[] = EXTERNAL_HTTP_ALLOWLIST): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  return allowlist.some((entry) => parsed.hostname === entry.host && (!entry.pathPrefix || parsed.pathname.startsWith(entry.pathPrefix)))
}

export interface ExternalHttpInput {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: unknown
}

export interface ExternalHttpOutput {
  status: number
  body: unknown
}

export const externalHttpNode: NodeImplementation<ExternalHttpInput, ExternalHttpOutput> = {
  type: 'external.http',
  major: 1,
  effect: 'external',
  async run(input: ExternalHttpInput): Promise<ExternalHttpOutput> {
    if (!isUrlAllowlisted(input.url)) {
      throw new Error(`external.http@1: "${input.url}" is not on the allowlist (https-only, host + path-prefix must match)`)
    }

    const response = await fetch(input.url, {
      method: input.method ?? 'GET',
      headers: input.headers,
      body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
    })

    const contentType = response.headers.get('content-type') ?? ''
    const body = contentType.includes('application/json') ? await response.json() : await response.text()

    return { status: response.status, body }
  },
}

registerNode(externalHttpNode as unknown as NodeImplementation)
