/**
 * Orquestra Flow Engine (OFE) — shared type contract.
 *
 * This module is imported by node implementations (resolvers, tx nodes) and by the
 * compiler/interpreter. Keep it dependency-free (aside from the Workers type
 * declarations) so it can be imported from anywhere in the worker without pulling
 * in the rest of the flow engine.
 */

import type { D1Database, KVNamespace } from '@cloudflare/workers-types'

/** Base58-encoded Solana public key. */
export type Pubkey = string

/** A single Solana instruction in the flow engine's wire-agnostic shape. */
export interface FlowInstruction {
  programId: Pubkey
  keys: { pubkey: Pubkey; isSigner: boolean; isWritable: boolean }[]
  data: string // base64
}

/**
 * Declared side-effect class for a node implementation.
 * - "pure": deterministic, no I/O (e.g. constant lookup, PDA derivation math).
 * - "read": in-process RPC/D1/KV read (counted against `policies.budgets.rpcCalls`).
 * - "external": outbound HTTPS to a third party (counted against `policies.budgets.externalCalls`).
 */
export type NodeEffect = 'pure' | 'read' | 'external'

/** Per-run execution context handed to every node's `run()`. */
export interface NodeContext {
  db: D1Database
  cache: KVNamespace
  /** IDL registry KV namespace (project IDLs) — used by orquestra.* IDL-reflection nodes. */
  idls: KVNamespace
  rpcUrl: string
}

/**
 * A registered node implementation. `type` + `major` together form the registry key
 * (`${type}@${major}`), matching the `"type": "resolve.ata@1"` syntax used in FDL documents.
 */
export interface NodeImplementation<TIn = Record<string, unknown>, TOut = unknown> {
  type: string // e.g. "resolve.pda"
  major: number // e.g. 1
  effect: NodeEffect
  run(input: TIn, ctx: NodeContext): Promise<TOut>
}
