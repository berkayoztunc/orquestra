/**
 * Helius Wallet Identity API — verified name/category/socials for known
 * Solana programs, from the same database that powers Helius's Orb block
 * explorer (32,500+ labels, 3,000+ programs). This is ground truth for the
 * programs it recognizes, unlike `categorizeProgramWithAI`'s AI guess.
 *
 * https://www.helius.dev/docs/wallet-api/identity
 */

import { CATEGORY_TAXONOMY, type ProgramCategory } from './ai-categorization'

export interface HeliusIdentityEnv {
  HELIUS_API_KEY?: string
}

export interface HeliusProgramIdentity {
  address: string
  name: string
  /** Raw Helius category, e.g. "Swap", "Borrow Lend" — see mapHeliusCategory. */
  category: string
  /** Full, directly-fetchable image URL — already resolved from the raw filename Helius returns. */
  iconUrl?: string
  website?: string
  twitter?: string
  discord?: string
}

/**
 * Helius's `identity` response gives a bare filename (e.g. "jupiterIcon.svg"),
 * not a URL — not documented anywhere in their API docs. Confirmed live via
 * browser devtools against the real Orb frontend (which renders these icons
 * through Next.js's image-optimization proxy) and verified directly with
 * curl: `https://orbmarkets.io/api/icons/{filename}` serves the raw image
 * (200, correct image/* content-type, no auth) — this is Orb's own backing
 * asset endpoint, the proxy just resizes/re-encodes it for their frontend.
 */
function resolveHeliusIconUrl(icon: string): string {
  return `https://orbmarkets.io/api/icons/${icon}`
}

/**
 * Look up a program's verified identity. Returns `null` whenever this can't
 * produce an answer — 404 (not in Helius's DB, the normal case for most
 * programs), no key configured, non-program type, or a network error. Never
 * throws: this sits in front of the AI fallback and must not break it.
 */
export async function lookupProgramIdentity(
  programId: string,
  env: HeliusIdentityEnv,
): Promise<HeliusProgramIdentity | null> {
  if (!env.HELIUS_API_KEY) return null

  try {
    const res = await fetch(`https://api.helius.xyz/v1/wallet/${programId}/identity`, {
      headers: { 'X-Api-Key': env.HELIUS_API_KEY },
    })
    if (res.status === 404) return null
    if (!res.ok) {
      console.error(`[helius-identity] ${res.status} for ${programId}`)
      return null
    }
    const data = (await res.json()) as Record<string, unknown>
    if (data.type !== 'program' || typeof data.name !== 'string' || typeof data.category !== 'string') {
      return null
    }
    return {
      address: programId,
      name: data.name,
      category: data.category,
      iconUrl: typeof data.icon === 'string' ? resolveHeliusIconUrl(data.icon) : undefined,
      website: typeof data.website === 'string' ? data.website : undefined,
      twitter: typeof data.twitter === 'string' ? data.twitter : undefined,
      discord: typeof data.discord === 'string' ? data.discord : undefined,
    }
  } catch (err) {
    console.error(`[helius-identity] lookup failed for ${programId}:`, err)
    return null
  }
}

/**
 * Map Helius's ~28-value program category taxonomy onto our existing
 * CATEGORY_TAXONOMY (ai-categorization.ts). We keep our own taxonomy rather
 * than adopting theirs so the frontend's CATEGORY_LABELS and the FTS schema
 * need no changes.
 */
const HELIUS_CATEGORY_MAP: Record<string, ProgramCategory> = {
  Swap: 'dex-amm',
  'Proprietary AMM': 'dex-amm',
  Aggregator: 'dex-amm',
  'Borrow Lend': 'lending',
  NFT: 'nft-marketplace',
  Staking: 'staking',
  'Stake Pool': 'staking',
  Launchpad: 'token-launch',
  Governance: 'governance',
  'Game or Casino': 'gaming',
  Game: 'gaming',
  Payments: 'payments',
  Perpetuals: 'perpetuals',
  'Prediction Market': 'derivatives',
  RWA: 'derivatives',
  Bridge: 'infrastructure',
  'Cross-chain Bridge': 'infrastructure',
  Oracle: 'infrastructure',
  Compression: 'infrastructure',
  Privacy: 'infrastructure',
  Tools: 'infrastructure',
  DePIN: 'infrastructure',
  Native: 'infrastructure',
  DAO: 'governance',
}

export function mapHeliusCategory(heliusCategory: string): ProgramCategory {
  const mapped = HELIUS_CATEGORY_MAP[heliusCategory]
  if (mapped && (CATEGORY_TAXONOMY as readonly string[]).includes(mapped)) return mapped
  return 'other'
}
