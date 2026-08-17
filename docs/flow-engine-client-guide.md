# Flow Engine — Client Guide (using flows via MCP)

How to connect any MCP-capable LLM client to the Flow Engine: find and run an already-published flow
(the fast path — no authoring needed), or author a new one for a real Solana program, test it, and
publish it — entirely client-side. **No flow generation happens on the server** — the authoring tools
only document the grammar, validate, simulate, and publish what your LLM writes.

For what a flow actually is, see [the overview](flow-engine.md).

## Connect

The Flow Engine has its own MCP server, **separate from the main Orquestra MCP** — connect to both, you
need each for a different half of the job:

```text
https://api.orquestra.dev/mcp        ← program/IDL discovery (search_programs, list_instructions, ...)
https://api.orquestra.dev/flow/mcp   ← everything flow-related: find, run, author, test, publish
```

Local development:

```text
http://localhost:8787/mcp
http://localhost:8787/flow/mcp
```

Claude Code / Claude Desktop / Cursor — add both as separate MCP servers (see
[MCP Tools](mcp-tools.md) for the exact client config JSON per client; the shape is identical, just a
different `url`):

```json
{
  "mcpServers": {
    "orquestra": {
      "type": "http",
      "url": "https://api.orquestra.dev/mcp"
    },
    "orquestra-flows": {
      "type": "http",
      "url": "https://api.orquestra.dev/flow/mcp"
    }
  }
}
```

## The fast path: find and run an existing flow

Always try this before authoring anything — if a flow already covers what you need, you skip straight
to a transaction:

```text
1. list_flows        (flow /mcp)  — search by free-text query, intent, or protocol
2. get_flow_metadata  (flow /mcp)  — (often not needed — list_flows already returns full inputs/outputs)
3. estimate_flow      (flow /mcp)  — run it: resolve + build + compose + simulate, returns the
                                     unsigned transaction(s), ready to hand to a wallet/signer
```

`list_flows` with no arguments lists everything published. An empty result means nothing existing
covers your case — fall back to the authoring workflow below.

## The authoring path: no existing flow covers what you need

```text
1. search_programs / list_instructions / read_llms_txt   (main /mcp)  — learn the target program
2. get_flow_schema                                    (flow /mcp)  — learn the FDL grammar + nodes
3. write the FDL yourself                                          — no tool call, just author it
4. validate_flow                                       (flow /mcp)  — static check, fast, free
5. simulate_flow                                       (flow /mcp)  — real run, real RPC, nothing published
6. publish_flow                                        (flow /mcp)  — requires your ingest key
7. estimate_flow                                       (flow /mcp)  — now runnable the fast-path way too
```

Steps 4 and 5 are meant to be iterated — write, validate, fix, simulate, fix, repeat — before ever
calling `publish_flow`.

## Tool reference (`/flow/mcp`)

### `list_flows`

Inputs (all optional):

- `query` — free-text substring match against slug, name, intent, protocol, and program addresses.
- `intent` — exact match, e.g. `"swap"`, `"stake"`, `"transfer"`.
- `protocol` — exact match, e.g. `"raydium"`.
- `limit` — cap the result count.

Returns each matching flow's full contract (slug, meta, inputs, outputs) — usually enough to go
straight to `estimate_flow` without a separate `get_flow_metadata` call. Call with no arguments to
list the whole published catalog.

### `get_flow_metadata`

Inputs:

- `slug` — from `list_flows`.

Returns the full published contract (meta/inputs/outputs) for one flow.

### `estimate_flow`

Inputs:

- `slug` — from `list_flows`.
- `inputs` — values for the flow's declared inputs (see its `inputs` schema from `list_flows` /
  `get_flow_metadata`), e.g. `{ "wallet": "...", "amount": "1000" }`.
- `network` — optional, `mainnet-beta` | `devnet` | `testnet`. Defaults to `mainnet-beta`.
- `rpcUrl` — optional full RPC URL override. Must be an https URL on an allowlisted RPC provider (`api.*.solana.com`, `helius-rpc.com`, `quiknode.pro`, `rpcpool.com`); anything else is rejected with 400.

Actually **runs** a published flow: resolves accounts, builds the real instruction(s) from the live
IDL, composes and simulates. Returns the unsigned transaction(s) (base64 v0) — this is the tool that
produces the transaction you're actually looking for. No payment, no signing performed here; hand the
result to a wallet/signer.

### `get_flow_schema`

No inputs. Returns the full FDL grammar (document structure, `$ref` syntax, the `?`-optional idiom)
plus every registered node type's exact input/output shape and a worked example. This is the
authoritative, self-consistency-checked spec — always call this first when authoring, don't assume you
remember the grammar from a previous session.

### `validate_flow`

Inputs:

- `fdl` — the full FDL document JSON.

Static compile only — schema shape, unknown node types, reference cycles, dangling `$refs`. No RPC, no
DB, nothing published. Returns the content hash and execution strata (which nodes run in parallel) on
success, or a list of exactly what's wrong (`nodeId`/`path` + `message`) on failure.

### `simulate_flow`

Inputs:

- `fdl` — the full FDL document (doesn't need to be published).
- `inputs` — test values for the flow's declared `inputs`, e.g. `{ "wallet": "...", "amount": "1000" }`.
- `network` — optional, `mainnet-beta` | `devnet` | `testnet`. Defaults to `mainnet-beta`.
- `rpcUrl` — optional full RPC URL override. Must be an https URL on an allowlisted RPC provider (`api.*.solana.com`, `helius-rpc.com`, `quiknode.pro`, `rpcpool.com`); anything else is rejected with 400.

Compiles **and actually runs** the flow: real IDL lookups, real PDA/ATA resolution against live chain
state, real instruction building, real transaction composition and simulation. Nothing is published, no
payment involved — this is "does it actually work" before you commit to it. (Same thing `estimate_flow`
does, but for a draft FDL that isn't published yet.)

### `publish_flow`

Inputs:

- `fdl` — the full FDL document. Should already pass `validate_flow` / `simulate_flow`.
- `ingestKey` — your `INGEST_API_KEY`. Required — publishing is not open/anonymous.
- `tier` — optional, `"instruction" | "intent" | "composed"`. Defaults to `"instruction"`.
- `publish` — optional, defaults to `true`. Pass `false` to land a draft without going live.

Compiles the document again (rejects the same way `validate_flow` does — nothing half-published) and
upserts it into the flow registry. Idempotent on identical FDL content. Once published, it's immediately
findable via `list_flows` and runnable via `estimate_flow`.

## Writing the FDL

Every real flow ends with the same two-node tail:

1. One or more `orquestra.build_instruction@1` nodes — the generic, IDL-driven instruction builder.
   Works for **any** program in the catalog; there is no per-protocol node type. Give it `projectId`
   (from `search_programs`, not the program address), `instruction` (exact name from
   `list_instructions`), `accounts`, `args`, `feePayer`.
2. Exactly one `solana.compose_transaction@1` node, referencing every instruction produced above, as
   the last node. Its `transactions` output (an array — almost always length 1, only splits when
   instructions don't fit one 1232-byte packet) is the flow's actual deliverable.

Everything before that tail is resolver nodes (`resolve.pda@1`, `resolve.ata@1`,
`resolve.pda_state@1`, `resolve.blockhash@1`, `resolve.constant@1`, `resolve.accounts_by_filter@1`,
`resolve.quote@1`) — they run in parallel wherever the graph allows, and their job is turning the
flow's minimal declared `inputs` into the full account set the instruction actually needs.

The `?` suffix on a reference (e.g. `"$dstAta.createIx?"` inside `compose_transaction`'s
`instructions` array) is how a flow says "include this instruction only if it turned out to be
needed" — an ATA-create that gets silently dropped when the ATA already exists is the canonical
example. A string with a `$ref` plus an operator (e.g. `"$quote.outAmount > 0"`) is a small expression
— comparisons/boolean/arithmetic, usable in `if` guards or any `in` field. Full grammar, every field,
and a complete worked example: call `get_flow_schema`.

## Reading errors

Every tool response is designed to be actionable by an LLM without a human in the loop — the failure
mode tells you what to change:

- **`**Compile failed:**`** (from `validate_flow`/`simulate_flow`/`publish_flow`) — the FDL itself is
  structurally wrong (unknown node type, cycle, dangling `$ref`, malformed expression). Fix the FDL,
  not the inputs.
- **`**Run failed:**`** (from `simulate_flow`/`estimate_flow`) — the FDL compiled, but a node failed at
  run time against the given `inputs` (e.g. an invalid pubkey, a missing account, a program-side
  rejection). Names the failing node and includes partial outputs from everything that ran before it.
- **`**Not found:**`** (from `get_flow_metadata`/`estimate_flow`) — no published flow with that slug.
  Call `list_flows` to see what actually exists.
- **`**Unauthorized:**`** (from `publish_flow`) — your `ingestKey` is wrong or missing. Not a flow
  problem.
- **`**System error (not a flow/FDL issue):**`** — something broke on the server side (unrelated to
  your FDL or inputs). The underlying message isn't included on purpose (same policy as the rest of
  the API); retry, or report it if it keeps happening. Don't waste turns rewriting an FDL that was
  actually fine.

## After publishing

A published flow is also runnable over plain REST, if you're not going through MCP for that part:

```bash
curl -X POST https://api.orquestra.dev/flows/<slug>/estimate \
  -H "Content-Type: application/json" \
  -d '{ "inputs": { ... } }'
```

Same underlying logic as the `estimate_flow` MCP tool — pick whichever fits your client.
