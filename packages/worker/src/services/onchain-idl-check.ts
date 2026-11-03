import { validateIDL } from './idl-parser'
import { MANUAL_IDL_NOTICE, compareInstructionSets, type IdlComparison, type IdlSource } from './idl-provenance'

/**
 * Looks up the on-chain IDL for a program so a manual upload can be judged against it.
 *
 * Unlike `fetchIdlWithSource` (which returns null for "absent" AND for "all RPCs failed"),
 * this keeps the outcomes apart — they mean different things to an uploader:
 *   found       a readable on-chain IDL exists → the upload must match it
 *   absent      no on-chain IDL → the upload is accepted but labeled manual/unverified
 *   unreadable  an IDL account exists but could not be decoded → accepted, labeled manual
 *   error       every RPC failed → we cannot say anything; callers should fail closed
 */

export type OnChainIdlCheck =
  | { status: 'found'; source: 'pmp' | 'anchor'; idl: any; idlJson: string }
  | { status: 'absent' }
  | { status: 'unreadable'; source: 'pmp' | 'anchor' }
  | { status: 'error'; message: string }

const PER_RPC_TIMEOUT_MS = 10_000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`on-chain IDL lookup timed out after ${ms}ms`)), ms)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

export async function checkOnChainIdl(programId: string, rpcUrls: string[]): Promise<OnChainIdlCheck> {
  let lastError = 'no RPC endpoint configured'

  for (const url of rpcUrls) {
    try {
      const { fetchIdlWrapped } = await import('@solana/idl')
      const { createSolanaRpc, address } = await import('@solana/kit')
      const rpc = createSolanaRpc(url)
      // Throws only on RPC failure; a missing / undecodable IDL is a normal result.
      const result = await withTimeout(fetchIdlWrapped(rpc, address(programId)), PER_RPC_TIMEOUT_MS)

      if (result.status === 'absent') return { status: 'absent' }

      const source = (result.source ?? 'anchor') as 'pmp' | 'anchor'
      if (result.status === 'corrupt') return { status: 'unreadable', source }

      try {
        const idl = JSON.parse(result.content)
        if (idl && typeof idl === 'object' && !Array.isArray(idl)) {
          return { status: 'found', source, idl, idlJson: result.content }
        }
      } catch {
        // fall through
      }
      return { status: 'unreadable', source }
    } catch (err) {
      lastError = (err as Error).message
    }
  }

  return { status: 'error', message: lastError }
}

// ─── Resolving an uploaded IDL against the chain ─────────────────────────────

export interface ResolvedIdl {
  /** The IDL to store: the on-chain one when it exists, otherwise the uploaded one. */
  idl: any
  idlJson: string
  /** 'anchor' | 'pmp' when taken from the chain, 'manual' when no usable on-chain IDL exists. */
  idlSource: IdlSource
  /** Messages the uploader must be shown. */
  warnings: string[]
  onChain: {
    status: 'found' | 'absent' | 'unreadable'
    source?: 'pmp' | 'anchor'
    /** Set when an on-chain IDL was used and the uploaded IDL's instruction set differed from it. */
    differences?: IdlComparison
  }
}

/**
 * Decides what actually gets stored for a user upload.
 *
 * Program IDs are first-come-first-served, so an uploaded IDL is only the uploader's claim
 * about what a program looks like. When the chain has its own IDL, the chain wins — the
 * upload can never replace what the program publishes about itself. When there is none,
 * the upload is accepted but permanently labeled `manual`, and the uploader is told so.
 * If the chain cannot be reached we say nothing rather than guess (`ok: false`).
 */
export async function resolveIdlAgainstChain(
  programId: string,
  uploadedIdl: any,
  rpcUrls: string[],
  check: (programId: string, rpcUrls: string[]) => Promise<OnChainIdlCheck> = checkOnChainIdl,
): Promise<{ ok: true; value: ResolvedIdl } | { ok: false; message: string }> {
  const result = await check(programId, rpcUrls)

  if (result.status === 'error') {
    return { ok: false, message: `Could not verify whether this program has an on-chain IDL (${result.message}). Please retry shortly.` }
  }

  if (result.status === 'found' && validateIDL(result.idl).valid) {
    const differences = compareInstructionSets(uploadedIdl, result.idl)
    const warnings = [
      `An on-chain IDL (${result.source}) exists for this program, so it was imported from the chain instead of your uploaded file — ` +
        'an IDL published by the program itself always takes precedence over a manual upload.',
    ]
    if (!differences.matches) {
      warnings.push(
        `Your uploaded IDL differed from the on-chain IDL (only in yours: ${differences.onlyInUploaded.join(', ') || 'none'}; ` +
          `only on-chain: ${differences.onlyOnChain.join(', ') || 'none'}).`,
      )
    }
    return {
      ok: true,
      value: {
        idl: result.idl,
        idlJson: JSON.stringify(result.idl),
        idlSource: result.source,
        warnings,
        onChain: { status: 'found', source: result.source, differences: differences.matches ? undefined : differences },
      },
    }
  }

  const unreadable = result.status === 'unreadable' || result.status === 'found'
  const warnings = [
    unreadable
      ? 'An on-chain IDL account exists for this program but could not be read, so your upload is stored as a MANUAL IDL. ' + MANUAL_IDL_NOTICE
      : MANUAL_IDL_NOTICE,
  ]
  return {
    ok: true,
    value: {
      idl: uploadedIdl,
      idlJson: JSON.stringify(uploadedIdl),
      idlSource: 'manual',
      warnings,
      onChain: { status: unreadable ? 'unreadable' : 'absent' },
    },
  }
}
