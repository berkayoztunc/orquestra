/**
 * In-memory registry mapping `${type}@${major}` -> NodeImplementation.
 *
 * Node implementations register themselves (typically via a side-effecting import in
 * an index/bootstrap module) before a flow plan referencing them is compiled or run.
 */

import type { NodeImplementation } from './types'

const registry = new Map<string, NodeImplementation>()

function registryKey(type: string, major: number): string {
  return `${type}@${major}`
}

/**
 * Register a node implementation. Throws if `${type}@${major}` is already registered,
 * to catch duplicate-registration bugs (e.g. two modules registering the same node type)
 * as early as possible.
 */
export function registerNode(impl: NodeImplementation): void {
  const key = registryKey(impl.type, impl.major)
  if (registry.has(key)) {
    throw new Error(`node-registry: duplicate registration for "${key}"`)
  }
  registry.set(key, impl)
}

/** Look up a registered node implementation by `${type}@${major}` key, e.g. "resolve.pda@1". */
export function getNode(key: string): NodeImplementation | undefined {
  return registry.get(key)
}

/** List every currently registered node implementation. */
export function listNodes(): NodeImplementation[] {
  return Array.from(registry.values())
}
