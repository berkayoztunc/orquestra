/**
 * Kill switch for BACKGROUND Workers AI usage (neuron billing).
 *
 * `AI_BACKGROUND_DISABLED = "1"` stops the bulk/automatic AI paths — program
 * analysis, categorization fallback, upload-triggered analysis. User-initiated
 * features (tx-agent, flow builder, manual /ai endpoints) are NOT affected.
 *
 * Helius identity lookups are not AI and keep working.
 */
export function aiBackgroundDisabled(env: { AI_BACKGROUND_DISABLED?: string } | undefined | null): boolean {
  return env?.AI_BACKGROUND_DISABLED === '1'
}

/** The AI binding to hand to background code paths: undefined when the kill switch is on. */
export function backgroundAi<T extends { AI?: any; AI_BACKGROUND_DISABLED?: string }>(env: T): any {
  return aiBackgroundDisabled(env) ? undefined : env.AI
}
