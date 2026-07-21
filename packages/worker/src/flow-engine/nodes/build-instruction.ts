/**
 * `orquestra.build_instruction@1` — builds a single instruction for ANY
 * program registered in the Orquestra catalog, generically, from its IDL
 * (Anchor or Codama — `buildTransaction` auto-detects the format). This is
 * the flow engine's IDL-reflection primitive: it's driven entirely by
 * `projectId` + `instruction` + `accounts` + `args`, with zero protocol- or
 * instruction-specific code. There is no per-protocol node type in this
 * engine — every flow, for every program, goes through this one node.
 *
 * Reuses the existing generic `services/tx-builder.ts` `buildTransaction()`
 * (the same function the `build_instruction` MCP tool calls) and keeps only
 * its `.instruction` field, converted to the flow engine's `FlowInstruction`
 * shape. `buildTransaction` also builds a full legacy transaction and fetches
 * a blockhash internally as a side effect of its own MCP-tool contract — that
 * work is discarded here (the flow's `solana.compose_transaction@1` node
 * builds the real v0 transaction from all of a flow's instructions together).
 * A leaner "build just the instruction" entry point in tx-builder.ts would
 * avoid that redundant work; not done here to avoid touching a shared,
 * heavily-used function as part of this fix.
 */

import { fetchProjectIdl } from '../../services/idl-registry'
import { buildTransaction, type RiskLevel } from '../../services/tx-builder'
import { rpcUrlHost } from '../../utils/solana-rpc'
import type { FlowInstruction, NodeContext, NodeImplementation } from '../types'
import { registerNode } from '../node-registry'

export interface BuildInstructionInput {
  projectId: string
  instruction: string
  accounts: Record<string, string>
  args: Record<string, unknown>
  feePayer: string
}

export interface BuildInstructionOutput {
  instruction: FlowInstruction
  riskLevel: RiskLevel
  riskReasons: string[]
}

function inferCluster(rpcUrl: string): 'mainnet-beta' | 'devnet' | 'testnet' {
  const lower = rpcUrl.toLowerCase()
  if (lower.includes('devnet')) return 'devnet'
  if (lower.includes('testnet')) return 'testnet'
  return 'mainnet-beta'
}

function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16)
  }
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export const buildInstructionNode: NodeImplementation<BuildInstructionInput, BuildInstructionOutput> = {
  type: 'orquestra.build_instruction',
  major: 1,
  effect: 'read',
  async run(input: BuildInstructionInput, ctx: NodeContext): Promise<BuildInstructionOutput> {
    const project = await fetchProjectIdl(input.projectId, { DB: ctx.db, IDLS: ctx.idls })
    if (!project) {
      throw new Error(`orquestra.build_instruction@1: project "${input.projectId}" not found or has no IDL`)
    }

    const cluster = inferCluster(ctx.rpcUrl)
    const response = await buildTransaction(
      project.idl,
      input.instruction,
      {
        accounts: input.accounts,
        args: input.args,
        feePayer: input.feePayer,
      },
      project.programId,
      ctx.rpcUrl,
      { cluster, rpcUrlHost: rpcUrlHost(ctx.rpcUrl) },
    )

    const instruction: FlowInstruction = {
      programId: response.instruction.programId,
      keys: response.instruction.accounts.map((acc) => ({
        pubkey: acc.pubkey,
        isSigner: acc.isSigner,
        isWritable: acc.isWritable,
      })),
      data: hexToBase64(response.instruction.data),
    }

    return { instruction, riskLevel: response.riskLevel, riskReasons: response.riskReasons }
  },
}

registerNode(buildInstructionNode as unknown as NodeImplementation)
