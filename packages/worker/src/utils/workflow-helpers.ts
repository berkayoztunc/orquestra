import type { WorkflowStep } from 'cloudflare:workers'
import type { WorkflowSleepDuration } from '@cloudflare/workers-types'

/**
 * The Workflows engine can pack several fast consecutive steps into ONE
 * Worker invocation, and the 1000-subrequest budget accumulates across them.
 * Call this after every iteration of a chunked loop — it sleeps (forcing a
 * fresh invocation with a reset budget) every `everyN` iterations.
 *
 * `guard` lets a caller add an extra condition (e.g. "not the last chunk") —
 * the sleep only fires when both the modulo check and `guard` are true.
 */
export async function hibernateEvery(
  step: WorkflowStep,
  iteration: number,
  everyN: number,
  label: string,
  opts?: { duration?: WorkflowSleepDuration; guard?: boolean },
): Promise<void> {
  const { duration = '1 minute', guard = true } = opts ?? {}
  if (iteration % everyN === 0 && guard) {
    await step.sleep(`cooldown after ${label}`, duration)
  }
}
