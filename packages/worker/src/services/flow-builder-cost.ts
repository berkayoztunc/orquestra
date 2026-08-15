/**
 * Per-model cost estimation for the Flow Builder Agent.
 *
 * Replaces the single hardcoded llama-3.1-70b neuron rate that used to live in
 * flow-builder-generator.ts. That rate applied to a different model would have
 * silently misreported every `flow_builder_attempts.usd_estimated` row and the
 * `/status` Telegram total — understating input cost and overstating output.
 *
 * Note: Workers AI bills in Neurons; the $/M figures below are the published
 * per-model prices. `neurons` is returned as a normalized equivalent (so the
 * existing `neurons_estimated` column keeps working), not a billed quantity.
 *
 * Cache caveat: `result.usage` does not tell us how much of the input hit the
 * prompt cache, so input is costed at the uncached rate. Reported cost is
 * therefore an upper bound — actual spend with session affinity is lower.
 */

export const USD_PER_NEURON = 0.011 / 1000

interface ModelRate {
  usdPerInputToken: number
  usdPerOutputToken: number
}

const MODEL_RATES: Record<string, ModelRate> = {
  // $0.95 / M input ($0.19 cached), $4.00 / M output
  '@cf/moonshotai/kimi-k2.7-code': {
    usdPerInputToken: 0.95 / 1_000_000,
    usdPerOutputToken: 4.0 / 1_000_000,
  },
  // Neuron-derived: 26,668 neurons/M input, 204,805 neurons/M output
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': {
    usdPerInputToken: (26_668 / 1_000_000) * USD_PER_NEURON,
    usdPerOutputToken: (204_805 / 1_000_000) * USD_PER_NEURON,
  },
}

const FALLBACK_RATE = MODEL_RATES['@cf/meta/llama-3.3-70b-instruct-fp8-fast']

export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): { neurons: number; usd: number } {
  let rate = MODEL_RATES[model]
  if (!rate) {
    // Loud, not silent — a future model swap should be obvious in the logs
    // rather than quietly producing wrong cost figures.
    console.warn(`[flow-builder-cost] no rate for model "${model}" — falling back to llama rates`)
    rate = FALLBACK_RATE
  }
  const usd = promptTokens * rate.usdPerInputToken + completionTokens * rate.usdPerOutputToken
  return { neurons: usd / USD_PER_NEURON, usd }
}
