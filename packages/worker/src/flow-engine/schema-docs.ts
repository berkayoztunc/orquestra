/**
 * Human/LLM-facing documentation for the Flow Definition Language (FDL) and
 * the registered node-type catalog. This is deliberately separate from
 * `fdl-schema.ts` (the machine-enforced zod schema): this module is prose +
 * structured examples meant to be read by an LLM client (over MCP) that is
 * authoring a flow for an arbitrary IDL, with no access to this repo's
 * source. It must stay in sync with what's actually registered — see the
 * `assertCatalogMatchesRegistry` check below, which throws at import time if
 * a registered node has no catalog entry (or vice versa), so an undocumented
 * node type can't silently ship.
 */

import { listNodes } from './node-registry'
import { FLOW_INPUT_TYPES } from './fdl-schema'

const FLOW_INPUT_TYPES_DOC = FLOW_INPUT_TYPES.map((t) => `"${t}"`).join(' | ')

export interface NodeCatalogEntry {
  /** `${type}@${major}`, matches the node-registry key exactly. */
  key: string
  summary: string
  input: string // human-readable shape description
  output: string // human-readable shape description
  example: Record<string, unknown> // an example `in` object for this node
}

export const NODE_CATALOG: NodeCatalogEntry[] = [
  {
    key: 'resolve.pda@1',
    summary: 'Derives a Program Derived Address from raw seeds. Pure (no RPC) — deterministic math only.',
    input:
      '{ program: pubkey, seeds: (string | { kind: "pubkey"|"string"|"bytes"|"u8"|"u16"|"u32"|"u64"|"u128"' +
      '|"i8"|"i16"|"i32"|"i64"|"i128", value: string })[] } — ' +
      'a plain string seed is UTF-8 encoded; { kind: "pubkey" } encodes a base58 pubkey\'s 32 raw bytes; ' +
      '{ kind: "bytes" } decodes `value` as base64 raw bytes; the numeric kinds (u8/u16/u32/u64/u128 and ' +
      'their signed i* counterparts) little-endian-encode a decimal string `value` at that type\'s fixed ' +
      'byte width — use these for a PDA seed component declared as a numeric type in the program\'s IDL ' +
      '(e.g. a u64 id), instead of requiring the finished PDA address as a direct flow input.',
    output: '{ address: pubkey, bump: number }',
    example: {
      program: '$inputs.programId',
      seeds: ['vault', { kind: 'pubkey', value: '$inputs.owner' }],
    },
  },
  {
    key: 'resolve.ata@1',
    summary:
      'Derives an SPL associated-token-account address and checks on-chain existence. If missing, also ' +
      'builds the create-ATA instruction (owner pays). RPC read.',
    input: '{ owner: pubkey, mint: pubkey }',
    output: '{ address: pubkey, exists: boolean, createIx: FlowInstruction | null }',
    example: { owner: '$inputs.wallet', mint: '$inputs.mint' },
  },
  {
    key: 'resolve.pda_state@1',
    summary: 'Checks whether an account exists on-chain and reads its lamports balance. RPC read.',
    input: '{ address: pubkey }',
    output: '{ exists: boolean, decoded: null, lamports: number | null } — decoded is always null in this MVP',
    example: { address: '$somePda.address' },
  },
  {
    key: 'resolve.blockhash@1',
    summary: 'Fetches the latest blockhash. RPC read. No input fields.',
    input: '{}',
    output: '{ blockhash: string, lastValidBlockHeight: number }',
    example: {},
  },
  {
    key: 'resolve.constant@1',
    summary:
      'Looks up a value from the `protocol_descriptors` D1 table (per-protocol fact sheet: canonical ' +
      'addresses, non-IDL-derivable constants). Returns null if no descriptor row exists for the protocol.',
    input: '{ protocol: string, key: string }',
    output: '{ value: unknown }',
    example: { protocol: 'raydium', key: 'ammProgramId' },
  },
  {
    key: 'resolve.accounts_by_filter@1',
    summary:
      'Discovers program-owned accounts by dataSize/memcmp/field filters instead of a hardcoded address ' +
      '— how a flow finds e.g. "the pool for mint A + mint B" without knowing its address up front. ' +
      'Generic across any program\'s IDL-decodable account types, same as orquestra.build_instruction@1. ' +
      'RPC scan.',
    input:
      '{ projectId: string, accountType?: string (IDL account type name), dataSize?: number, ' +
      'memcmp?: { offset: number, bytes: string }[], fieldFilters?: { field: string, bytes: string }[] ' +
      '(field may be a dot-path into a nested struct field, e.g. "data.planId"; for pubkey fields ' +
      'pass a base58 pubkey string as bytes — other field types\' required byte encoding is undocumented), ' +
      'limit?: number }',
    output: '{ accounts: { address: pubkey, data: json | null }[], count: number }',
    example: { projectId: '$inputs.projectId', accountType: 'Pool', memcmp: [{ offset: 8, bytes: '$inputs.mintA' }] },
  },
  {
    key: 'external.http@1',
    summary:
      'The engine\'s only generic outbound-HTTP node. The target URL is checked against a fixed allowlist ' +
      '(exact host + path prefix, https-only) at RUN time against the fully resolved URL — SSRF is ' +
      'excluded by construction, not by filtering. Not meant to be called with arbitrary URLs; today\'s ' +
      'allowlist only covers Jupiter\'s quote API (used internally by resolve.quote@1) — a caller-supplied ' +
      'or flow-input-derived host will be rejected unless it is separately allowlisted.',
    input: '{ url: string, method?: "GET"|"POST", headers?: Record<string,string>, body?: json }',
    output: '{ status: number, body: json | string }',
    example: { url: 'https://quote-api.jup.ag/v6/quote?inputMint=...', method: 'GET' },
  },
  {
    key: 'resolve.quote@1',
    summary:
      'Price/route quote for a token swap, via Jupiter v6 (the only quote source wired up so far — ' +
      'protocol-native fallback is a follow-up). Use `minOutAmount` as a guard input to ' +
      'orquestra.build_instruction@1\'s swap-instruction args, or in a logic.assert@1 / `if` expression ' +
      '(e.g. `"$quote.outAmount > 0"`) to abort the flow if no route exists.',
    input: '{ inputMint: pubkey, outputMint: pubkey, amount: string (base units), slippageBps?: number (default 50) }',
    output: '{ outAmount: string, minOutAmount: string, priceImpactPct: string | null, route: json }',
    example: { inputMint: '$inputs.inputMint', outputMint: '$inputs.outputMint', amount: '$inputs.amount', slippageBps: 50 },
  },
  {
    key: 'orquestra.build_instruction@1',
    summary:
      'THE generic instruction builder — works for ANY program with an IDL registered in the Orquestra ' +
      'catalog (Anchor or Codama, auto-detected). Fetches the IDL by projectId, validates the instruction ' +
      'name and required accounts/args against it, and encodes the instruction. This is the only ' +
      'instruction-building node type — there is no per-protocol node. RPC read (fetches the IDL).',
    input:
      '{ projectId: string (Orquestra project id — NOT the program address; use search_programs to find ' +
      'it), instruction: string (exact instruction name from list_instructions), ' +
      'accounts: Record<accountName, pubkey> (every non-optional account the IDL declares for this ' +
      'instruction), args: Record<argName, value> (every arg the IDL declares), feePayer: pubkey }',
    output: '{ instruction: FlowInstruction, riskLevel: "low"|"medium"|"high", riskReasons: string[] }',
    example: {
      projectId: '$inputs.projectId',
      instruction: 'initialize',
      accounts: { receipts: '$receiptsPda.address', authority: '$inputs.wallet', system_program: '11111111111111111111111111111111' },
      args: { store_name: '$inputs.storeName' },
      feePayer: '$inputs.wallet',
    },
  },
  {
    key: 'solana.compose_transaction@1',
    summary:
      'Composes a list of instructions into ONE OR MORE unsigned v0 transactions (each ' +
      'base64, simulated by default). Almost always returns exactly one — it only splits into ' +
      'more when the instructions do not fit a single 1232-byte packet, in which case ' +
      '`transactions` has length > 1 and MUST be submitted in array order (later transactions ' +
      'can depend on state written by earlier ones). This is always the LAST node in a flow. ' +
      'Use the `?` optional-ref idiom in `instructions` to drop instructions that were not ' +
      'needed (e.g. an ATA that already existed). RPC read (blockhash + simulate per transaction). ' +
      'CAVEAT: when it does split, each transaction is simulated independently against CURRENT ' +
      'chain state, not the state after earlier transactions in the split would have landed — a ' +
      'simulation failure on transaction 2+ that references an account transaction 1 creates can ' +
      'be a false negative; check `risk.reasons` for the split notice before trusting it.',
    input:
      '{ feePayer: pubkey, instructions: FlowInstruction[] (reference other nodes\' `.instruction` or ' +
      '`.createIx` fields, `?`-suffixed where the instruction may not exist), simulate?: boolean (default ' +
      'true), lookupTableAddresses?: pubkey[] (addresses of EXISTING, already-created-and-extended ' +
      'Address Lookup Tables — reduces per-account bytes in the compiled message, can avoid or reduce a ' +
      'multi-transaction split; an address that is not a real ALT is skipped with a note in ' +
      'risk.reasons, not a hard failure; creating a NEW table is not supported here, it requires its ' +
      'own on-chain transaction(s) to land first) }',
    output:
      '{ transactions: { unsignedTransaction: string (base64 v0 wire tx), instructionCount: number, ' +
      'simulation?: { success, computeUnits, logs, err } }[], risk: { level, reasons: string[] } }',
    example: {
      feePayer: '$inputs.wallet',
      instructions: ['$srcAta.createIx?', '$dstAta.createIx?', '$buildIx.instruction'],
      simulate: true,
    },
  },
  {
    key: 'logic.assert@1',
    summary:
      'Throws (aborting the run with a structured error naming this node) if `condition` is falsy. ' +
      'Pure — `condition` must already be a resolved boolean by the time this node runs (a bare $ref to ' +
      'another node\'s boolean output field), not an expression string.',
    input: '{ condition: boolean, message?: string }',
    output: '{ ok: true }',
    example: { condition: '$quoteGuard.ok', message: 'no route found' },
  },
]

function assertCatalogMatchesRegistry(): void {
  // `test.*` node types are excluded: node-registry.ts is a module-level singleton
  // with no unregister, so synthetic nodes registered by unit tests (e.g.
  // "test.probe@1" in flow-engine.test.ts) persist for the rest of that test
  // process. They're never registered outside of tests, so excluding the
  // "test." prefix here doesn't hide any real undocumented production node.
  const registered = new Set(
    listNodes()
      .filter((n) => !n.type.startsWith('test.'))
      .map((n) => `${n.type}@${n.major}`),
  )
  const documented = new Set(NODE_CATALOG.map((n) => n.key))

  const undocumented = [...registered].filter((k) => !documented.has(k))
  const stale = [...documented].filter((k) => !registered.has(k))

  if (undocumented.length > 0 || stale.length > 0) {
    throw new Error(
      `flow-engine/schema-docs.ts is out of sync with the node registry. ` +
        (undocumented.length > 0 ? `Undocumented node types: ${undocumented.join(', ')}. ` : '') +
        (stale.length > 0 ? `Documented but not registered: ${stale.join(', ')}.` : ''),
    )
  }
}

const FDL_GRAMMAR = `# Flow Definition Language (FDL) — how to write a flow

A flow is one JSON document. Structure:

\`\`\`jsonc
{
  "fdl": "1.0",
  "meta": {
    "slug": "kebab-case-unique-id",
    "name": "Human readable name",
    "description": "optional one or two sentence summary — this is what shows as the card description in the catalog UI, write one",
    "intent": "free-form tag, e.g. swap | stake | transfer | initialize",
    "protocol": "optional protocol name",
    "programs": ["optional array of program addresses this flow touches"],
    "networks": ["mainnet-beta", "devnet"]
  },
  "inputs": {
    "someInput": { "type": ${FLOW_INPUT_TYPES_DOC}, "description": "...", "default": "..." }
  },
  "outputs": {
    "someOutput": { "type": "transaction" | "transaction[]" | "json" | "u64" | "string" | "bool", "description": "..." }
  },
  "nodes": [
    {
      "id": "myNodeId",
      "type": "resolve.ata@1",
      "in": { "owner": "$inputs.wallet", "mint": "$inputs.mint" },
      "if": "$someOtherNode.someBooleanField",
      "after": ["someOtherNodeId"]
    }
  ],
  "policies": {
    "budgets": { "wallTimeMs": 4000, "externalCalls": 0, "rpcCalls": 20 }
  }
}
\`\`\`

## Reference syntax (used inside any node's "in" object, at any nesting depth)

- \`$inputs.<key>\` — a declared flow input.
- \`$<nodeId>.<path>\` — another node's output field. Dot-separated path, e.g. \`$srcAta.address\`, \`$node.a.b\`.
- Trailing \`?\` (e.g. \`$dstAta.createIx?\`) — OPTIONAL reference. If it resolves to null/undefined:
  - as the whole value of an "in" field: becomes null.
  - as one entry inside an array-typed "in" field: that array entry is DROPPED entirely. This is how you
    write "include this instruction only if it was actually needed" (see solana.compose_transaction@1 example).
- Anything not starting with \`$\` is a literal (string/number/boolean/array/object), used as-is.
- A string containing a \`$ref\` PLUS an operator — \`>\` \`<\` \`>=\` \`<=\` \`==\` \`!=\` \`&&\` \`||\` \`!\` \`+\` \`-\` \`*\` \`/\`
  parens — is an EXPRESSION, e.g. \`"$quote.outAmount > 0"\` or \`"$a.count + $b.count >= $inputs.minTotal"\`.
  Evaluates to a primitive (string/number/boolean/null). No \`?\`-optional form inside an expression — an
  undefined ref anywhere in one is always a hard error. No function calls, no loops, no computed array
  indices, no string concatenation. A BARE ref with no operator always returns the raw value unmodified
  (including whole objects/arrays) — expressions only kick in when an operator is actually present.
- \`"if"\` on a node must be a single BARE reference (no \`?\`) OR an expression, evaluating to boolean.
  Falsy or unresolvable skips the node — its outputs become undefined for every downstream reference.
- \`"after"\` adds ordering with no data dependency (run after another node with no ref needed).
- Dependencies between nodes are inferred automatically from every \`$\` reference found in \`in\`/\`if\`
  (including refs embedded inside expressions) — you never declare them separately.

## The two things every real flow ends with

1. One or more \`orquestra.build_instruction@1\` nodes (one per instruction the flow needs).
2. Exactly one \`solana.compose_transaction@1\` node, referencing every instruction produced above, as
   the LAST node. Its \`transactions\` output (an array — almost always length 1, see the node catalog
   entry for when it splits) is the flow's actual deliverable. Declare the flow's own \`outputs\` entry
   for it as \`{ "type": "transaction[]" }\` (use plain \`"transaction"\` only if you can guarantee, from
   the specific instructions involved, that a split will never happen — \`"transaction[]"\` is the safe
   default for any flow you didn't hand-verify stays under one packet).

## Typical shape

resolver nodes (PDA/ATA/state — all can run in parallel, the compiler figures out the DAG from your
refs) → orquestra.build_instruction@1 node(s) (using the resolved addresses as \`accounts\`) →
solana.compose_transaction@1 (composing all the instructions into one or more unsigned txs — the
caller must submit \`transactions\` in order if there is more than one).

## How to find the values you need before writing a flow

1. \`search_programs\` / a known program id → get the Orquestra \`projectId\`.
2. \`list_instructions\` on that projectId → exact instruction names, their account names (and whether
   each is a PDA — check for a \`pda.seeds\` block, which tells you what \`resolve.pda@1\` node you need),
   and arg names/types.
3. \`read_llms_txt\` on that projectId → full prose docs if you need more context on what an instruction does.
4. Write the FDL using the node catalog below.
5. Call \`validate_flow\` (static compile only — no RPC, no DB) to catch structural mistakes fast.
6. Call \`simulate_flow\` with realistic test inputs (real RPC calls, real mainnet simulation, nothing is
   published or charged) to prove it actually works.
7. Call \`publish_flow\` with your ingest key once it simulates cleanly.
`

/** The full document handed back by the `get_flow_schema` MCP tool. */
export function getFlowSchemaDocument(): string {
  assertCatalogMatchesRegistry()

  const catalogMd = NODE_CATALOG.map(
    (n) =>
      `### \`${n.key}\`\n\n${n.summary}\n\n- **input**: ${n.input}\n- **output**: ${n.output}\n- **example \`in\`**:\n\`\`\`json\n${JSON.stringify(n.example, null, 2)}\n\`\`\``,
  ).join('\n\n')

  return `${FDL_GRAMMAR}\n\n# Node type catalog\n\n${catalogMd}\n`
}
