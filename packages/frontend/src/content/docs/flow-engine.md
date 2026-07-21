## What is a flow

The Orquestra Flow Engine (OFE) turns a Solana program's IDL into a **flow** — a small, published,
minimal-input recipe that resolves accounts, builds one or more instructions, and composes them into
an unsigned transaction, without the caller ever touching raw account/arg encoding.

Orquestra's atomic APIs (`build_instruction`, `derive_pda`, `simulate_instruction`, …) already turn any
IDL into low-level building blocks. The Flow Engine is the layer on top that chains those blocks into a
graph and runs the graph for you — a flow like "Stake SOL with Marinade" exposes just a handful of
inputs (`wallet`, `amount`) and resolves everything else — PDA derivation, ATA existence checks,
instruction encoding, transaction composition — at request time, against live chain state.

A flow is never signed and never custodies funds. It always ends in a composed, **unsigned** v0
transaction plus a risk report — signing is entirely the caller's responsibility.

## Connect

The Flow Engine has its own MCP server, separate from the main Orquestra MCP server — connect to both,
each covers a different half of the job:

```text
https://api.orquestra.dev/mcp        — program/IDL discovery (search_programs, list_instructions, ...)
https://api.orquestra.dev/flow/mcp   — everything flow-related: find, run, author, test, publish
```

```json
{
  "mcpServers": {
    "orquestra": { "type": "http", "url": "https://api.orquestra.dev/mcp" },
    "orquestra-flows": { "type": "http", "url": "https://api.orquestra.dev/flow/mcp" }
  }
}
```

## Find and run an existing flow

Always try this first — if a flow already covers what you need, you go straight to a transaction, no
authoring required:

- **`list_flows`** — search by free-text query, intent, or protocol. Called with no arguments, it lists
  everything published. Returns each flow's full contract (inputs/outputs) directly.
- **`get_flow_metadata`** — full contract for one flow by slug (usually not needed — `list_flows`
  already returns it).
- **`estimate_flow`** — actually runs a flow: resolves accounts, builds the real instruction(s), composes
  and simulates. Returns the unsigned transaction(s), ready for a wallet/signer. No payment, no signing.

An empty `list_flows` result means nothing existing covers your case — move on to authoring.

## Author a new flow

No flow generation happens on the server — an LLM (or a person) writes the FDL document itself, using
these tools to learn the grammar, validate, test, and publish it:

| Tool | What it does |
| --- | --- |
| `get_flow_schema` | Returns the full FDL grammar plus every node type's exact input/output shape and a worked example. Always call this first. |
| `validate_flow` | Static compile only — schema shape, unknown node types, cycles, dangling references. No RPC, no DB, nothing published. |
| `simulate_flow` | Compiles **and runs** a draft flow against real RPC — proves it actually works before publishing. |
| `publish_flow` | Publishes a proven FDL document into the flow registry. Requires an ingest key — not open/anonymous. |

Typical loop: `get_flow_schema` → write the FDL → `validate_flow` → `simulate_flow` → fix → repeat →
`publish_flow`.

## Writing the FDL

Every real flow ends with the same two-node tail:

1. One or more `orquestra.build_instruction@1` nodes — the generic, IDL-driven instruction builder.
   Works for **any** program in the catalog; there is no per-protocol node type.
2. Exactly one `solana.compose_transaction@1` node, referencing every instruction produced above. Its
   `transactions` output (an array — almost always length 1) is the flow's actual deliverable.

Everything before that tail is resolver nodes — `resolve.pda@1`, `resolve.ata@1`,
`resolve.pda_state@1`, `resolve.blockhash@1`, `resolve.constant@1`, `resolve.accounts_by_filter@1`,
`resolve.quote@1` — turning the flow's minimal declared inputs into the full account set the
instruction actually needs. A trailing `?` on a reference (e.g. `"$dstAta.createIx?"`) means "include
this instruction only if it turned out to be needed" — the idiom for skipping an ATA-create when the
account already exists.

## Reading errors

Every tool response is designed to be actionable without a human in the loop:

- **Compile failed** — the FDL itself is structurally wrong. Fix the FDL, not the inputs.
- **Run failed** — the FDL compiled, but a node failed against the given inputs. Names the failing
  node and includes partial outputs from everything that ran before it.
- **Not found** — no published flow with that slug. Call `list_flows` to see what exists.
- **System error** — something broke on the server side, unrelated to your FDL or inputs. Retry, or
  report it if it persists.
