# What is the Orquestra Flow Engine?

The Orquestra Flow Engine (OFE) turns a Solana program's IDL into a **flow** — a small, published,
minimal-input recipe that resolves accounts, builds one or more instructions, and composes them into
an unsigned transaction, without the caller ever touching raw account/arg encoding.

Orquestra's existing APIs (`build_instruction`, `derive_pda`, `simulate_instruction`, …) already turn
any IDL into low-level building blocks. OFE is the layer on top that chains those blocks into a graph
and runs the graph for you.

## The problem it solves

Building one real Solana instruction by hand means knowing every account name, which ones are PDAs and
what seeds derive them, which token accounts need to exist first, and how to encode every argument. A
flow hides all of that behind a handful of inputs (e.g. `wallet`, `storeName`) and does the rest —
PDA derivation, ATA existence checks, instruction encoding, transaction composition — at request time,
against live chain state.

## How it works

A flow is one JSON document (FDL — Flow Definition Language) describing a small dataflow graph:

```text
resolver nodes (PDA / ATA / account state)
        │  outputs feed into
        ▼
orquestra.build_instruction@1  (generic — works for ANY IDL'd program)
        │
        ▼
solana.compose_transaction@1  (composes everything into one or more unsigned v0 transactions)
```

- **Nodes are generic, not per-protocol.** There is exactly one instruction-building node type
  (`orquestra.build_instruction@1`) for every program in the catalog — no protocol-specific code
  anywhere in the engine. A flow supplies `projectId` + `instruction` + `accounts` + `args`; the node
  fetches that project's real IDL and encodes the instruction from it.
- **Resolvers do the account math.** `resolve.pda@1`, `resolve.ata@1`, `resolve.pda_state@1`,
  `resolve.blockhash@1`, `resolve.constant@1` derive addresses and read chain state so the flow author
  doesn't have to hardcode anything environment-dependent.
- **The output is never signed.** A flow always ends in `solana.compose_transaction@1`, which returns
  one or more unsigned, base64-encoded v0 transactions (split automatically only if the instructions
  don't fit one 1232-byte packet) plus a risk report. There is no signing capability anywhere in the
  engine — flows cannot custody funds.
- **Compiled once, run many times.** A flow document is statically validated (cycle checks, unknown
  node types, dangling references) and content-hashed at publish time; running it resolves everything
  fresh against current chain state and current inputs.

## Using it

As a client, over MCP — connect to `/flow/mcp`, learn the grammar, write a flow, test it, publish it.
See the [client guide](flow-engine-client-guide.md).

## What it deliberately doesn't do (yet)

- **No flow generation on the server.** Nothing here writes FDL for you — a human or an LLM client
  authors it, the engine only validates/runs/publishes what it's given.
- **No payment layer.** Flows are free to run today (`estimate` only — resolve, build, compose,
  simulate). x402-metered execution is a planned, not-yet-built layer on top.
- **No signing or submission.** The deliverable is always an unsigned transaction; a wallet or signer
  is the caller's responsibility.

Full technical design: [`flow-engine-design.md`](flow-engine-design.md).
