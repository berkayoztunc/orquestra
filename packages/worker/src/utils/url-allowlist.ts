/**
 * Shared outbound-URL allowlist primitive.
 *
 * Extracted from `flow-engine/nodes/external-http.ts` so both the flow engine's
 * `external.http@1` node and Solana RPC resolution (`utils/solana-rpc.ts`) apply
 * the same rule to caller-supplied URLs. It lives in `utils/` rather than
 * `flow-engine/` so `utils` never has to import from `flow-engine` — the
 * dependency only runs the other way.
 *
 * The rule: https-only, exact hostname match by default. `allowSubdomains`
 * opts an entry into suffix matching for providers that issue a per-user
 * subdomain (QuickNode: `<name>.solana-mainnet.quiknode.pro`). The suffix test
 * requires a leading dot so `evil-quiknode.pro` cannot match `quiknode.pro`.
 */

export interface AllowlistEntry {
  host: string
  pathPrefix?: string
  /**
   * Match `*.host` in addition to `host` itself. Off by default — only enable
   * for providers that genuinely hand out per-customer subdomains, since it
   * widens the entry to everything the provider's DNS delegates.
   */
  allowSubdomains?: boolean
}

function hostMatches(hostname: string, entry: AllowlistEntry): boolean {
  if (hostname === entry.host) return true
  return entry.allowSubdomains === true && hostname.endsWith(`.${entry.host}`)
}

export function isUrlAllowlisted(url: string, allowlist: AllowlistEntry[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  return allowlist.some(
    (entry) => hostMatches(parsed.hostname, entry) && (!entry.pathPrefix || parsed.pathname.startsWith(entry.pathPrefix)),
  )
}
