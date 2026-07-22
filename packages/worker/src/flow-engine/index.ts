/**
 * Side-effect-only barrel for the flow engine's built-in node implementations.
 *
 * Importing this module runs every `registerNode(...)` call in the files below (each
 * node module registers itself at import time). `registerAllNodes()` is a no-op — the
 * registration work already happened via the top-level imports — it exists purely so
 * callers (e.g. worker startup) have an explicit, readable "call this once" entry point.
 */

import './resolvers/pda'
import './resolvers/state'
import './resolvers/account-data'
import './resolvers/constant'
import './resolvers/blockhash'
import './resolvers/accounts-by-filter'
import './resolvers/quote'
import './nodes/build-instruction'
import './nodes/assert'
import './nodes/compose-transaction'
import './nodes/external-http'
import './nodes/system-transfer'

export function registerAllNodes(): void {}
