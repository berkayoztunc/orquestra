/**
 * Synthetic inputs used when simulating a draft flow that has no real caller
 * yet — the Flow Builder Agent authoring loop, the workflow's post-authoring
 * verification, and the Telegram approve-path re-simulation all need the same
 * values, so they live here rather than being re-derived in each place.
 *
 * Simulation uses a REAL funded mainnet wallet, not a placeholder. The previous
 * placeholder (`11111111111111111111111111111111`, the System Program) owns no
 * token accounts and holds no lamports, so every flow touching an ATA or a
 * balance failed on the placeholder rather than on its own logic — the
 * simulation gate was effectively meaningless.
 *
 * Caveat: this wallet holds only ~0.002 SOL. Simulation runs with
 * `sigVerify: false`, so that is fine for account resolution and instruction
 * assembly, but a flow that actually moves lamports may fail on insufficient
 * funds rather than on a real defect.
 */

import type { FlowInputSpec } from '../flow-engine/fdl-schema'

/** Real mainnet wallet used for draft-flow simulation: funded, owns SPL token accounts. */
export const SIMULATION_WALLET = 'EgJVwJN5enK7h74cdAKFogEYNCH1va9eWPzLZSZRNutH'

/** Wrapped SOL — a mint that always exists, for inputs that are clearly mints. */
export const WSOL_MINT = 'So11111111111111111111111111111111111111112'

/**
 * Fill every declared input with a plausible value so a draft flow can be run.
 * A spec's own `default` always wins — the interpreter applies defaults too,
 * but doing it here keeps the simulated inputs identical to what a caller
 * omitting that input would get.
 */
export function buildSyntheticInputs(inputSpecs: Record<string, FlowInputSpec>): Record<string, unknown> {
  const inputs: Record<string, unknown> = {}
  for (const [key, spec] of Object.entries(inputSpecs)) {
    if (spec.default !== undefined) {
      inputs[key] = spec.default
      continue
    }
    switch (spec.type) {
      case 'pubkey':
        // A mint input filled with a wallet address decodes as nothing, so use
        // a real, universally-present mint. Everything else defaults to the
        // wallet; inputs naming a specific on-chain account (pool/market/vault)
        // cannot be guessed here and should be passed explicitly by the caller.
        inputs[key] = /mint/i.test(key) ? WSOL_MINT : SIMULATION_WALLET
        break
      case 'bps':
        inputs[key] = 50
        break
      case 'bool':
        inputs[key] = true
        break
      case 'string':
        inputs[key] = 'test'
        break
      default:
        // every numeric width (u8..u64, i32, i64)
        inputs[key] = 1
        break
    }
  }
  return inputs
}
