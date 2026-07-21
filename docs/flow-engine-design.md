# Orquestra Flow Engine (OFE)

## Technical Design Document — Autonomous, x402-Monetized Workflow Platform for Solana

**Version:** 1.0 · **Date:** July 2026 · **Status:** Design proposal
**Author:** Orquestra · **Audience:** Engineering, investors, grant committees

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement & Motivation](#2-problem-statement--motivation)
3. [Design Goals & Non-Goals](#3-design-goals--non-goals)
4. [Theoretical Foundations](#4-theoretical-foundations)
5. [System Architecture](#5-system-architecture)
6. [Flow Definition Language (FDL)](#6-flow-definition-language-fdl)
7. [Execution Flow & Orchestration](#7-execution-flow--orchestration)
8. [Agent Communication Patterns](#8-agent-communication-patterns)
9. [Workflow Lifecycle](#9-workflow-lifecycle)
10. [Scalability & Performance](#10-scalability--performance)
11. [Reliability, Fault Tolerance & Recovery](#11-reliability-fault-tolerance--recovery)
12. [Security Model](#12-security-model)
13. [Monetization Architecture (x402)](#13-monetization-architecture-x402)
14. [Data Model](#14-data-model)
15. [API Surface](#15-api-surface)
16. [Development Roadmap](#16-development-roadmap)
17. [Deployment Strategy](#17-deployment-strategy)
18. [Operational Processes](#18-operational-processes)
19. [Future Expansion](#19-future-expansion)
20. [Trade-offs & Design Decisions](#20-trade-offs--design-decisions)
21. [Appendices](#21-appendices)

---

## 1. Executive Summary

Orquestra today turns Solana IDLs into hosted APIs, AI-ready documentation, and MCP tools. An AI agent can already discover a program, derive PDAs, decode accounts, and build unsigned transactions — but only one low-level call at a time, supplying every account and argument itself.

The **Orquestra Flow Engine (OFE)** adds an intent layer on top of this substrate. A *flow* is a published, versioned, machine-readable unit of on-chain capability — "Swap token on Raydium," "Stake SOL with Marinade," "Deposit to Kamino" — that:

- **receives a minimal set of typed inputs** (wallet, amount, mint), published in its metadata;
- **performs all intermediate computation and decision-making autonomously** — PDA derivation, account discovery, ATA existence checks, on-chain state reads, quoting, routing, conditional branching — with zero manual intervention;
- **invokes external tools and services** (price/route APIs, RPC nodes, other flows) when its graph requires them;
- **returns a final, verifiable result**: an unsigned Solana transaction plus structured outputs, never touching a private key;
- **is paid for per execution over x402**, the HTTP-native stablecoin payment protocol now live on Solana with public facilitators.

The engine is designed to host **thousands of concurrent autonomous workflows** as *data, not code*: every flow is a declarative dataflow graph compiled once into an execution plan and interpreted by a single, deterministic runtime. New flows are authored by AI agents (packaged as Orquestra skills), pass an automated verification pipeline, and go live without a deploy. Hosting 10,000 flows costs storage, not compute.

Three properties differentiate OFE from workflow products like n8n, Temporal, or chain-specific SDK wrappers:

1. **Late-binding resolution.** Flow definitions are static; every environment-dependent value (PDA, ATA, pool account, quote, wallet state) is resolved at execution time against live chain state. The same flow adapts automatically to any wallet, any amount, and any market condition.
2. **AI-native supply side.** Flows are generated from IDL + documentation metadata by a constrained authoring agent, validated by simulation, and published to a discoverable catalog. The marginal cost of a new flow is cents; the engine's catalog grows at machine speed across Orquestra's indexed program registry (top-100 most-used programs plus 214 verified programs, ≈4,000 instructions measured from the live IDL corpus).
3. **Machine-payable by construction.** Every flow execution is an x402-metered HTTP call. The buyers are AI agents; the product surface (HTTP + MCP + payment in one round trip) is shaped for them.

The remainder of this document specifies the architecture, theory, runtime, security, and operations of this system at production depth, together with a costed roadmap.

---

## 2. Problem Statement & Motivation

### 2.1 The integration gap

Executing a single meaningful action on Solana — a swap, a stake, a lending deposit — requires orchestrating a pipeline that today lives in protocol-specific SDKs: derive PDAs, discover pools and reserves, check and create associated token accounts, fetch quotes, serialize instructions with correct discriminators and Borsh layouts, assemble a transaction under the 1,232-byte packet limit, and simulate before signing. Each protocol ships its own TypeScript/Rust SDK with its own conventions. For a human developer this is days of work per protocol; for an AI agent it is a wall of 20+ under-documented parameters per instruction.

Orquestra's existing atomic APIs (build_instruction, derive_pda, fetch_pda_data, get_program_data, simulate_instruction) removed the *encoding* problem generically, for any program with an IDL. What remains unsolved is the *orchestration* problem: the sequencing, discovery, and decision-making between those calls.

### 2.2 The agent-economy opportunity

Autonomous agents are becoming first-class economic actors. The x402 protocol — HTTP 402 + stablecoin settlement, now stewarded by the x402 Foundation under the Linux Foundation with backing from Google, Coinbase, Stripe, Solana, and Visa — has processed over 100M transactions on Base and ~35M on Solana as of early 2026. Google's AP2 standardizes agent payment authorization above it, with x402 as its crypto settlement extension. The missing piece of this stack for on-chain execution is a *capability layer*: a catalog of priced, trustable, machine-readable actions an agent can discover, pay for, and consume in one HTTP round trip. That is exactly what OFE provides.

### 2.3 Why not hardcode flows?

A hand-written "swap flow" per protocol reproduces the SDK problem one level up: N protocols × M intents × continuous protocol upgrades = an unmaintainable matrix. The system must instead be an *engine* whose flows are cheap, disposable, regenerable data artifacts — authored by AI from machine-readable protocol metadata, verified by simulation, and repaired automatically when the underlying protocol changes. Autonomy applies twice: flows execute autonomously, and the *catalog maintains itself* autonomously.

---

## 3. Design Goals & Non-Goals

### 3.1 Goals

| # | Goal | Measurable target |
| --- | --- | --- |
| G1 | Minimal-input intent execution | Median published flow exposes ≤ 6 external inputs |
| G2 | Full runtime autonomy | Zero human interaction between request and result |
| G3 | Low latency | p50 ≤ 900 ms, p95 ≤ 2.5 s for synchronous flows (excl. payment round trip) |
| G4 | Scale as data | 10,000+ published flows with no per-flow deploy or idle cost |
| G5 | Machine-payable | Every execution meterable via x402 `exact` scheme on Solana USDC |
| G6 | AI-generated supply | New instruction-level flow authored, verified & published with < 5 min machine time, < $0.25 marginal cost |
| G7 | Self-healing catalog | IDL change → affected flows re-verified or quarantined within 1 hour, automatically |
| G8 | Non-custodial safety | Engine can never sign; output is always an unsigned transaction + risk report |

### 3.2 Non-Goals

- **Key custody or transaction submission.** Signing remains in the client (wallet, signer skill, or embedded wallet provider). This is a safety boundary, a regulatory posture, and a trust story for investors — the platform cannot lose user funds because it never holds them.
- **General-purpose compute hosting.** Flow nodes come from a curated, audited node-type registry. Arbitrary tenant code is a future extension (§19), not a launch feature.
- **Being a wallet, an aggregator UI, or a trading strategy product.** OFE is infrastructure; strategies are what customers build on top.
- **LLM inference inside the execution hot path.** Intelligence is applied at authoring time; execution is deterministic (§4.3).

---

## 4. Theoretical Foundations

### 4.1 Flows as typed dataflow graphs

A flow is a directed acyclic graph `F = (N, E)` where nodes are effectful operations drawn from a finite, versioned **node-type registry**, and edges are typed data dependencies expressed as references (`$node.field`) from one node's output schema to another node's input schema. This is the classical dataflow model (Kahn process networks restricted to acyclic, single-shot evaluation), which yields three properties for free:

- **Implicit parallelism.** Any two nodes without a path between them may execute concurrently. The scheduler derives maximal parallel batches from the graph structure alone (Kahn's algorithm → topological strata); flow authors never write concurrency primitives.
- **Static analyzability.** Because the graph and all types are declared, the compiler can prove before execution: absence of cycles, type-compatibility of every edge, resolvability of every reference, coverage of every required input, and — critically for §12 — absence of any signing capability.
- **Determinism modulo effects.** Given identical inputs *and* identical responses from effectful nodes (RPC reads, quotes), execution is a pure function. Divergence can only enter through declared effect boundaries, which is what makes record/replay testing (§9.3) and idempotent retries (§11.2) tractable.

### 4.2 Late binding: the three-class parameter calculus

Every account and argument of an underlying instruction is classified at authoring time into exactly one of three classes. This classification *is* the mechanism by which "20+ parameters" becomes "4 inputs":

| Class | Definition | Bound at | Examples |
| --- | --- | --- | --- |
| **I — Input** | Values only the caller can know | Request time | wallet, amount, output mint, slippage |
| **R — Resolvable** | Values derivable from chain state, other nodes, or external services | Execution time (late-bound) | PDAs, ATAs, pool/reserve accounts, quotes, blockhash |
| **C — Constant** | Values invariant for the flow version | Compile time | systemProgram, tokenProgram, known program addresses |

The completeness invariant — *every parameter is classified, and only class I appears in public metadata* — is machine-checked at validation time. A flow with an unclassified parameter cannot be published. Class R is what makes flows *adaptive*: a resolver re-reads live PDA state, wallet balances, and pool registries on every execution, so a flow published in January remains correct in July even as pools migrate, ATAs appear, and prices move.

### 4.3 The authoring/execution intelligence split

OFE applies a strict separation borrowed from compiler theory: **intelligence at compile time, determinism at run time.**

- *Authoring* (LLM territory): reading an IDL and its documentation, inferring which instruction realizes "swap," classifying parameters into I/R/C, choosing resolvers, composing multi-instruction graphs. Slow, expensive, reasoning-heavy, offline, human-auditable.
- *Execution* (no LLM): interpreting a compiled plan. Fast, cheap, deterministic, replayable.

If a decision seems to require an LLM at execution time, that is a design smell: the decision either becomes a conditional edge in the graph (data-driven branching) or a new resolver type. This split is what allows the same engine to promise both "AI-generated" and "p50 < 1 s / deterministic / auditable" — properties that are mutually exclusive in agent frameworks that run LLM loops per request. An optional, clearly-marked `ai.classify` node type exists for genuinely fuzzy inputs (e.g., free-text token names → mint addresses) but is banned from the transaction-construction path by the compiler.

### 4.4 Durable execution and the two-lane model

Most intent flows are *synchronous*: sub-second graph execution ending in an unsigned transaction. Some are *long-lived*: wait for the signed transaction to land, DCA over days, act when a PDA crosses a threshold. These have fundamentally different runtime requirements, so OFE runs two lanes over the same flow definition (§7.4): a **hot lane** (in-Worker interpreter, request-scoped, latency-optimized) and a **durable lane** (Cloudflare Workflows V2 — checkpointed steps, hibernation, `waitForEvent`, up to 50,000 concurrent instances per account after the 2026 control-plane rearchitecture). One flow language, two execution substrates, chosen automatically by the compiler based on whether the graph contains temporal nodes (`wait.*`, `schedule.*`).

### 4.5 Idempotency, sagas, and the read-mostly advantage

OFE's effect profile is unusually favorable for reliability: almost every node is a *read* (derive, fetch, quote, simulate). The only writes in the core system are (a) the x402 payment settlement, handled by the facilitator with its own idempotency guarantees, and (b) nothing else — the transaction OFE emits is unsigned and un-submitted. This means node-level retries are safe by default, full-flow retries are safe with an idempotency key on payment, and there is no distributed-saga compensation problem in the core path. Durable-lane flows that *react* to on-chain events (§19) reintroduce write semantics and use standard saga-style compensation declared per node.

### 4.6 Content-addressed versioning

A flow version is identified by the SHA-256 hash of its canonicalized definition. Plans are cached by content hash; executions record the hash they ran; audits can reproduce byte-for-byte what a caller paid for. Publishing is append-only — a new version never mutates an old one — which gives agents a stability contract: pin the hash for reproducibility, or follow the alias (`raydium-swap-token@stable`) for maintained behavior.

### 4.7 A working definition of autonomy

"Autonomous" is used precisely, in three layers: **execution autonomy** — from paid request to final result, no human in the loop; every decision the flow makes is a function of its inputs and live-resolved state. **Supply autonomy** — the catalog grows and repairs itself through the agent pipeline (author → validate → publish → monitor → repair) with humans only at policy-defined approval gates. **Economic autonomy** — payment, metering, and settlement are machine-to-machine via x402; no invoices, no API-key sales calls. The system is designed so that removing every human from daily operation degrades nothing except the approval gate for newly authored high-risk flows.

---

## 5. System Architecture

### 5.1 Overview

OFE is organized into five planes deployed on Cloudflare's edge platform, extending the existing Orquestra worker (Hono API + MCP server, D1, KV, Workers AI, Workflows) rather than replacing it.

```
                       ┌─────────────────────────────────────────────────────────┐
                       │                     CLIENTS (BUYERS)                    │
                       │   AI agents (MCP) · apps (REST) · other flows (compose) │
                       └────────────┬─────────────────────────────┬──────────────┘
                                    │ HTTP + X-PAYMENT            │ MCP (Streamable HTTP)
                                    ▼                             ▼
   ┌────────────────────────────────────────────────────────────────────────────────┐
   │  PAYMENT PLANE           x402 middleware · price catalog · facilitator client  │
   │                          (verify → execute → settle) · receipts · revenue split│
   ├────────────────────────────────────────────────────────────────────────────────┤
   │  EXECUTION PLANE                                                               │
   │   ┌──────────────┐   ┌─────────────────────────────┐   ┌────────────────────┐  │
   │   │ Plan Cache   │──▶│ HOT LANE: in-Worker DAG     │   │ DURABLE LANE:      │  │
   │   │ (KV, by hash)│   │ interpreter (parallel       │   │ Workflows V2       │  │
   │   └──────────────┘   │ batches, in-process calls)  │   │ (waits, schedules) │  │
   │                      └──────────┬──────────────────┘   └─────────┬──────────┘  │
   │                                 ▼                                ▼             │
   │   ┌────────────────────────────────────────────────────────────────────────┐   │
   │   │ NODE RUNTIME: node-type registry + resolver framework                  │   │
   │   │  orquestra.* (IDL reflection) · solana.* (compose/simulate)            │   │
   │   │  resolve.* (pda/ata/state/filter/quote/wallet) · external.http · flow.*│   │
   │   └───────┬──────────────────────────┬──────────────────────┬──────────────┘   │
   ├───────────┼──────────────────────────┼──────────────────────┼──────────────────┤
   │  DATA     ▼                          ▼                      ▼                  │
   │  PLANE   D1 (flows, versions,   KV (IDLs, plans,      RPC pool (multi-        │
   │          runs, payments,        docs, quotes)         provider, hedged)        │
   │          health, descriptors)                                                  │
   ├────────────────────────────────────────────────────────────────────────────────┤
   │  CONTROL PLANE (authoring & lifecycle)                                         │
   │   flow-author agent → static verifier → simulation CI → canary → publisher     │
   │   (Cloudflare Workflow per authoring job; Queues for fan-out; approval UI)     │
   ├────────────────────────────────────────────────────────────────────────────────┤
   │  OBSERVABILITY PLANE                                                           │
   │   structured run logs → Analytics Engine · health cron · alerting · dashboards │
   └────────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Component responsibilities

**Flow Registry (D1 + KV).** Source of truth for flow definitions, metadata, versions, aliases, pricing, and lifecycle state. Read path is KV-cached (metadata and compiled plans) so catalog reads and plan fetches never touch D1 in the hot path.

**Flow Compiler.** Pure function `definition → plan | error[]`. Validates (JSON Schema, cycle check, type check of every edge, I/R/C completeness, node-type allowlist, no-sign invariant), then emits an execution plan: topological strata of node invocations with pre-resolved constants, pre-parsed references, and per-node timeout/retry/budget policies. Runs at publish time and on node-registry upgrades; never per request.

**Execution Runtime.** The interpreter described in §7. Stateless per request in the hot lane; checkpointed in the durable lane. Calls node implementations *in-process* — the existing route handlers in `packages/worker/src/routes/` are refactored so their logic lives in exported service functions (`services/*`), callable both over HTTP (existing API, unchanged) and directly by the runtime. This avoids HTTP-to-self subrequests, which would multiply latency and consume subrequest quota for zero benefit.

**Resolver Framework.** The implementation of parameter class R (§4.2): a library of late-binding resolvers, each a node type with declared effects, caching policy, and failure semantics. Detailed in §7.3.

**Payment Gateway.** Hono middleware implementing x402: constructs `PaymentRequirements` for 402 responses, verifies `X-PAYMENT` headers via facilitator `/verify`, gates execution, settles via `/settle`, and records receipts. Detailed in §13.

**Authoring Plane.** The AI supply chain: `orquestra-flow-author` and `orquestra-flow-validator` agents packaged as Orquestra skills (consistent with the existing `agents/skills/` contracts), orchestrated by a durable authoring Workflow per job, fanned out via Queues for batch catalog generation. Detailed in §8.3 and §9.

**Observability Plane.** Every run emits a structured record (flow hash, per-node timings, resolver cache hits, RPC endpoints used, payment receipt, result status) to Workers Analytics Engine; a health cron re-simulates every active flow daily; alerting and dashboards sit on top. Detailed in §18.

### 5.3 What is deliberately reused

The engine adds no new infrastructure category: it reuses Orquestra's Hono worker, D1 database (new tables via the existing numbered-migration convention), KV namespaces, Workers AI binding, the Workflows pattern already used by ten production workflows (`idl-sync`, `ai-analysis`, …), the MCP server, and the IDL corpus with its generated `llms.txt` documentation and AI analyses. The largest prerequisite change to existing code is the transaction builder: `tx-builder.ts` currently emits single-instruction legacy transactions; Phase 0 (§16) extends it to multi-instruction **v0 (versioned) transactions with Address Lookup Table support**, which real intent flows (ATA creation + swap; wrap + deposit) require, and without which packet-size limits (1,232 bytes) are quickly exceeded.

---

## 6. Flow Definition Language (FDL)

### 6.1 Design rationale

FDL is JSON, not YAML and not code. JSON because it is what a constrained LLM emits most reliably under structured-output enforcement, what JSON Schema validates natively, and what hashes canonically. Not code because code cannot be statically verified to the same depth (the no-sign invariant, effect typing, and budget analysis all depend on the definition being *data*), cannot be safely authored by an LLM without a sandbox, and cannot be interpreted with sub-millisecond startup in the hot lane.

### 6.2 Document structure

A flow document has four sections: `meta` (public metadata — the discoverable contract), `inputs`/`outputs` (typed schemas, JSON Schema dialect with Solana-specific formats: `pubkey`, `u64`, `bps`, `mint`), `nodes` (the graph), and `policies` (execution budgets, pricing, risk posture).

```jsonc
{
  "fdl": "1.0",
  "meta": {
    "slug": "raydium-swap-token",
    "name": "Swap token on Raydium",
    "intent": "swap",
    "protocol": "raydium",
    "programs": ["675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"],
    "networks": ["mainnet-beta"],
    "sideEffects": ["may create associated token accounts"],
    "author": { "kind": "agent", "id": "orquestra-flow-author@2", "reviewedBy": "human:berkay" }
  },
  "inputs": {
    "wallet":      { "type": "pubkey", "role": "feePayer+signer", "description": "Wallet that will sign" },
    "inputMint":   { "type": "mint" },
    "outputMint":  { "type": "mint" },
    "amount":      { "type": "u64", "description": "Input amount in base units" },
    "slippageBps": { "type": "bps", "default": 50, "maximum": 500 }
  },
  "outputs": {
    "unsignedTransaction": { "type": "transaction", "wireFormat": "v0", "encoding": "base64" },
    "expectedOut":         { "type": "u64" },
    "route":               { "type": "json" },
    "risk":                { "type": "riskReport" }
  },
  "nodes": [
    { "id": "pool",    "type": "resolve.accounts_by_filter@1",
      "in": { "program": "$meta.programs[0]", "filters": { "mints": ["$inputs.inputMint", "$inputs.outputMint"] } } },
    { "id": "quote",   "type": "resolve.quote@1",
      "in": { "source": "jupiter", "inputMint": "$inputs.inputMint", "outputMint": "$inputs.outputMint",
              "amount": "$inputs.amount", "slippageBps": "$inputs.slippageBps" } },
    { "id": "srcAta",  "type": "resolve.ata@1", "in": { "owner": "$inputs.wallet", "mint": "$inputs.inputMint" } },
    { "id": "dstAta",  "type": "resolve.ata@1", "in": { "owner": "$inputs.wallet", "mint": "$inputs.outputMint" } },
    { "id": "guard",   "type": "logic.assert@1",
      "in": { "condition": "$quote.outAmount > 0", "message": "no route found" } },
    { "id": "swapIx",  "type": "orquestra.build_instruction@1", "after": ["guard"],
      "in": { "program": "$meta.programs[0]", "instruction": "swap",
              "accounts": { "pool": "$pool.address", "userSource": "$srcAta.address",
                            "userDestination": "$dstAta.address", "owner": "$inputs.wallet" },
              "args": { "amountIn": "$inputs.amount", "minAmountOut": "$quote.minOutAmount" } } },
    { "id": "tx",      "type": "solana.compose_transaction@1",
      "in": { "feePayer": "$inputs.wallet",
              "instructions": ["$srcAta.createIx?", "$dstAta.createIx?", "$swapIx.instruction"],
              "simulate": true } }
  ],
  "policies": {
    "budgets": { "wallTimeMs": 4000, "externalCalls": 12, "rpcCalls": 20 },
    "pricing": { "x402": { "scheme": "exact", "amount": "0.005", "asset": "USDC" },
                 "inTxFeeBps": 8, "feeDisclosure": "8 bps fee instruction appended to transaction" },
    "onSimulationFailure": "abort"
  }
}
```

### 6.3 Language mechanics

**References.** `$nodeId.field` (JSONPath-lite: dot access and integer indexing only). Dependencies are *inferred* from references; the optional `after: [...]` adds ordering without dataflow (e.g., run the build only after an assertion passes). The `?` suffix marks an optional reference: if the producing node was skipped or the field is null, the value is omitted rather than erroring — the idiom for "include the create-ATA instruction only when the ATA is missing."

**Expressions.** Guard conditions and simple arithmetic use a deliberately minimal, non-Turing-complete expression grammar (comparisons, boolean operators, arithmetic, field access — no loops, no user functions, CEL-inspired). Anything more belongs in a node type.

**Conditionals.** A node may carry `"if": "<expr>"`. Skipped nodes propagate skip through required references and null through optional ones. There are no loops in FDL 1.0; bounded iteration (e.g., "for each of the wallet's positions") is provided by dedicated fan-out node types (`map.over@1` with a compiler-enforced cardinality cap), preserving static analyzability.

**Node type versioning.** Every node reference pins a major version (`resolve.ata@1`). The node-type registry is append-only per major version; breaking a node contract requires a new major and a catalog-wide recompilation pass with re-verification of affected flows (§9.4).

**Composition.** `flow.call@1` invokes another published flow as a node, by hash or alias, with its metadata-declared inputs/outputs as the contract. The compiler inlines the callee's plan (up to a depth limit) so composition costs nothing at run time. This makes flows the *unit of reuse*: a "swap" flow becomes a node inside a "zap into LP position" flow.

**The absent primitive.** There is no `sign` node type, no key-material type, and no node with submit semantics in the registry. The no-sign invariant is enforced at the type-system level, not by policy (§12.2).

### 6.4 Metadata as the product surface

`meta` + `inputs` + `outputs` + `pricing` form the **published contract**, served from the catalog (REST `GET /flows/:slug`, MCP `get_flow_metadata`) and designed to be sufficient for an agent to decide *whether* to call, *what* to send, *what* it will receive, and *what it will pay* — without reading the graph. The graph itself is public by default (auditable marketplace) but may be private for proprietary flows; the metadata contract is always public.

---

## 7. Execution Flow & Orchestration

### 7.1 Request lifecycle (hot lane)

```
Agent                    OFE Gateway                Runtime              External
  │ POST /flows/x/execute     │                        │                     │
  ├──────────────────────────▶│ no X-PAYMENT           │                     │
  │ 402 + PaymentRequirements │                        │                     │
  │◀──────────────────────────┤                        │                     │
  │ (sign SPL transfer authorization)                  │                     │
  │ POST … + X-PAYMENT        │                        │                     │
  ├──────────────────────────▶│ facilitator /verify ───┼────────────────────▶│
  │                           │ input validation       │                     │
  │                           │ plan fetch (KV, by hash)                     │
  │                           ├───────────────────────▶│ stratum 1 (parallel)│
  │                           │                        │  pool│quote│atas ──▶│ RPC/Jupiter
  │                           │                        │ stratum 2: guard    │
  │                           │                        │ stratum 3: build ──▶│ (in-process)
  │                           │                        │ stratum 4: compose  │
  │                           │                        │  + simulate ───────▶│ RPC
  │                           │ facilitator /settle ───┼────────────────────▶│
  │ 200 {outputs, receipt}    │◀───────────────────────┤                     │
  │◀──────────────────────────┤                        │                     │
```

Order of operations is deliberate: **verify before execute, settle after success.** Verification is fast and free; settlement is deferred so a failed execution never charges the caller (the facilitator's `exact` scheme supports verify-then-settle as distinct steps). A settlement failure after successful execution is logged for reconciliation and the result is still returned — the economic risk of one unsettled call is bounded by its price, and the alternative (settle-first) systematically charges callers for failures.

### 7.2 The interpreter

The compiled plan is a list of strata; each stratum is a list of node invocations independent of one another. The interpreter walks strata sequentially, executing each stratum's nodes with `Promise.all`, materializing outputs into a run context keyed by node id, then evaluating conditionals for the next stratum. Per node it enforces: input materialization from pre-parsed references → effect execution via the node implementation → output schema validation → budget accounting (wall-time, external calls, RPC calls — hard-aborting the run if a `policies.budgets` ceiling is hit). Node timeouts use `AbortController`; the per-node and per-flow retry discipline is described in §11.2.

Because all `orquestra.*` and `solana.*` nodes execute in-process (direct service-function calls), a typical 7-node intent flow performs only 3–5 genuine network calls (RPC reads, one quote), all parallelized where the graph allows. This is the structural source of the latency target: the engine adds microseconds; the network calls dominate, and the graph minimizes and overlaps them.

### 7.3 The resolver framework (class R in practice)

| Resolver | Backing | Effects | Cache policy |
| --- | --- | --- | --- |
| `resolve.pda@1` | existing `derive_pda` service | pure | plan-lifetime (deterministic) |
| `resolve.ata@1` | ATA derivation + `getAccountInfo` | RPC read | per-run (existence may change) |
| `resolve.pda_state@1` | existing `fetch_pda_data` (decode via IDL) | RPC read | per-run; optional `maxStalenessMs` |
| `resolve.accounts_by_filter@1` | existing `get_program_data` (dataSize/memcmp) | RPC scan | KV 30–300 s (pool sets change slowly) |
| `resolve.wallet_context@1` | balances, token accounts, positions | RPC read | per-run |
| `resolve.quote@1` | Jupiter v6 (primary), protocol-native (fallback) | HTTPS | 2–5 s micro-cache keyed by pair+amount band |
| `resolve.blockhash@1` | RPC `getLatestBlockhash` | RPC read | 15 s warm-isolate cache (existing `MemoCache`) |
| `resolve.constant@1` | protocol descriptor table | pure | plan-lifetime |
| `external.http@1` | allowlisted HTTPS endpoints | HTTPS | declared per registration |

Each resolver declares its **effect type** (pure / read / external), which the compiler uses for cache placement, retry safety (§11.2), and security review (§12.4). Resolvers are the *only* mechanism through which environment state enters a run — a property that makes the record/replay harness (§9.3) complete: capture resolver outputs, and you have captured everything non-deterministic.

**Protocol descriptors.** A small number of facts are neither derivable from an IDL nor from chain scans — canonical program addresses per protocol, which account in a pool layout is the "authority," which external quote source is authoritative. These live in a versioned `protocol_descriptors` table: machine-readable fact sheets (not code), authored once per protocol during onboarding, referenced by `resolve.constant`. They are the honest boundary of genericity, kept deliberately thin: the target is that a descriptor fits in one screen of JSON.

### 7.4 Lane selection and the durable lane

The compiler routes a flow to the durable lane iff its graph contains temporal node types (`wait.for_event@1`, `wait.until@1`, `schedule.recurring@1`). Durable-lane flows execute as instances of a single generic `FlowRunnerWorkflow` class (Cloudflare Workflows V2): each stratum becomes a `step.do` (checkpointed, independently retryable), temporal nodes map to `step.sleep`/`step.waitForEvent`, and the instance hibernates at zero compute cost between steps. Workflows V2 capacity (50,000 concurrent instances/account, 300 creations/s, configurable step and subrequest limits) comfortably covers the durable-lane share of projected load; the engine does not need Dynamic Workflows at launch because flow *data* is interpreted by one static class — per-tenant *code* (the case Dynamic Workflows exists for) arrives only with the §19 extension.

x402 interacts with the durable lane via a **quote-hold-settle** pattern: payment is verified and settled at instance creation (the service purchased is "run this durable flow to completion"), and the instance id is returned immediately; result delivery is by webhook or polling `GET /runs/:id`.

### 7.5 Worked example: autonomy under changing state

The same `raydium-swap-token` call made by two different wallets diverges automatically: wallet A (has both ATAs) → `srcAta.createIx`/`dstAta.createIx` resolve to null, optional references drop them, 1-instruction transaction; wallet B (missing destination ATA) → `dstAta.createIx` materializes, 2-instruction transaction, fee estimate updated, risk report notes the account creation. No flag was passed; no branch was authored per case beyond the optional reference. Multiply this pattern across pool migrations (filter-resolver re-discovers), price movement (quote re-resolves), and program upgrades (§9.4 re-verification) — that is the operational meaning of "flows adapt to wallets, external parameters, and PDA state."

---

## 8. Agent Communication Patterns

### 8.1 Consumption surface: MCP-first, HTTP-always

Buyers are predominantly AI agents, so the catalog is exposed simultaneously as REST and as MCP tools on the existing Orquestra MCP server (`https://api.orquestra.dev/mcp`):

| MCP tool | Purpose |
| --- | --- |
| `list_flows` | filtered catalog browse (intent, protocol, price ceiling, network) |
| `get_flow_metadata` | full published contract for one flow |
| `execute_flow` | run a flow; surfaces x402 requirements as structured content when unpaid |
| `get_run` | fetch a durable-lane run's status/result |
| `estimate_flow` | dry-run: resolve + build + simulate, no payment, no settlement — the "try before you buy" call, itself rate-limited |

The 402 interaction degrades gracefully across client capabilities: raw HTTP agents follow the standard x402 dance; MCP clients receive the `PaymentRequirements` as structured tool output and may delegate payment to a wallet-holding component; agents using x402-aware HTTP clients (e.g., `fetchWithPayment`) need no special handling at all.

### 8.2 Discovery and the wider agent stack

OFE positions itself inside the emerging agentic-commerce stack rather than beside it: **MCP** for discovery and invocation (shipped at launch), **x402** for settlement (shipped at launch), **AP2/A2A x402 extension** for mandate-based authorization (roadmap, §19) — AP2's verifiable mandates slot in *above* OFE's payment gateway without changing the execution engine, since AP2 explicitly uses x402 as its crypto settlement rail. Flow metadata is additionally published as a signed, crawlable catalog feed (`/.well-known/x402` style manifest) so external agent marketplaces and x402 index sites (the "Bazaar" pattern) can list Orquestra flows without integration work.

### 8.3 Supply-side agents: the authoring pipeline

The producer side is itself an agent system, packaged as Orquestra skills in the existing `agents/skills/` contract format, so the pipeline runs identically under Claude-class agents in CI or interactively:

```
        (per program or per intent; durable Workflow per job; Queue fan-out per batch)

  orquestra-flow-author ──▶ draft FDL ──▶ Flow Compiler (static verify) ──▶ errors?
        ▲                                                                    │ yes: structured
        └────────────────── repair loop (max K attempts) ◀───────────────────┘ error feedback
                                        │ no
                                        ▼
  orquestra-flow-validator: simulation CI (§9.3) ──▶ risk & coverage report
                                        │
                                        ▼
  policy gate: auto-publish (low-risk instruction flows) │ human approval (intent flows, high-risk)
                                        │
                                        ▼
  publisher: content-hash, sign, insert version, warm KV plan cache, emit catalog event
```

The author agent's inputs are exactly the machine-readable assets Orquestra already produces per program: the IDL, generated `llms.txt` docs, stored AI analysis, plus the protocol descriptor if present. Its output is FDL constrained by JSON Schema (structured output enforcement), so the failure mode is *semantic* (wrong account mapping — caught by simulation), not syntactic. Model tiering: a frontier model (Claude Sonnet/Opus class) for intent-flow composition and I/R/C classification; the existing Workers AI model for cheap auxiliary classification (e.g., tagging instructions by intent category during batch triage). Measured against the live corpus (212 IDLs, mean 12.8 instructions, median 8), the full catalog seed — top-100 programs + 214 verified programs ≈ 4,000 instructions — costs on the order of **$500–900 in authoring inference** at current Sonnet pricing with a 1.7-attempt average, generated in under a week of wall time through Queue-paced batches (§16).

### 8.4 Inter-flow communication

Flows communicate only through typed composition (`flow.call`) at compile time — never through shared mutable state at run time. Two runs of any flows share nothing. Cross-run coordination (e.g., "notify when my durable flow completes") is evented: durable-lane completion pushes to Queues, fanning out to webhooks and to the health/metrics consumers. This shared-nothing discipline is what keeps the horizontal-scaling story (§10) trivial.

---

## 9. Workflow Lifecycle

### 9.1 State machine

```
 draft ──▶ validated ──▶ simulated ──▶ canary ──▶ published ──▶ deprecated ──▶ archived
   ▲            │             │           │            │
   └────────────┴─────────────┴───────────┘            ▼
        (repair loop, re-enters at draft)           stale ──▶ (auto-repair) ──▶ validated…
```

**draft** — authored, not yet verified. **validated** — passed static compilation. **simulated** — passed the CI battery (§9.3). **canary** — live for a policy-defined trial: callable, priced at zero or discounted, capped call volume, results watermarked `canary`; promotion requires N successful paid-pattern executions with zero invariant violations. **published** — generally available, priced, listed. **stale** — a dependency changed (IDL version bump, node-type upgrade, descriptor edit) and re-verification hasn't passed; immediately delisted from execution (metadata remains, returns `409 FLOW_STALE` with a pointer to the successor version). **deprecated/archived** — alias moved to a successor; hash-pinned callers get a sunset window, then archival.

### 9.2 Versioning and aliases

Every mutation creates a new content-addressed version (§4.6). Public aliases (`@stable`, `@latest`, `@vN`) move atomically. Executions always record the resolved hash, so billing disputes and audits reference an immutable artifact.

### 9.3 The verification battery (pre-publish CI)

1. **Static** — schema, cycles, edge type-check, I/R/C completeness, node allowlist, budget sanity, no-sign (vacuously guaranteed but asserted), reference resolvability, fee disclosure present if `inTxFeeBps > 0`.
2. **Mainnet simulation, unsigned** — the decisive gate. Execute the full plan against mainnet RPC with a funded throwaway wallet set and `simulateTransaction(sigVerify: false)` on the composed transaction. Devnet is used as a cheap pre-filter only, because major DeFi protocols are not faithfully deployed there; correctness claims come from mainnet simulation.
3. **Matrix & property fuzzing** — execute across a parameter matrix (amount extremes, wallets with/without ATAs, empty balances, max slippage) asserting invariants: transaction ≤ packet size; no unresolved references at compose time; simulation success or *declared* failure mode; risk level consistent with the flow's declared risk posture; fee instruction present iff disclosed.
4. **Record/replay determinism check** — capture all resolver outputs from run 1, replay the plan against the capture, assert byte-identical composed transaction. Catches hidden nondeterminism in node implementations.
5. **Policy gate** — auto-publish for low-risk single-instruction flows (sampled human audit, 10% + all `risk: high`); mandatory human approval for multi-instruction intent flows and anything touching value-transfer instruction patterns (the existing `riskLevel` heuristics in `tx-builder.ts`, promoted to flow-level aggregation).
6. **Fixture persistence** — every published flow's matrix becomes regression fixtures under the existing `bun test` suite, so engine changes re-verify the catalog in CI.

### 9.4 Continuous verification and self-healing

Post-publish, three feedback loops keep the catalog honest without human attention: a **daily health cron** re-runs step 2 for every published flow (spread across the day; ~4,000 flows × 1 simulation ≈ trivial RPC load) and demotes failures to `stale`; the existing **idl-sync workflow** emits change events that immediately mark dependent flows `stale` and enqueue authoring-pipeline *repair jobs* (author agent receives the old FDL + IDL diff and proposes a migration, which re-enters the battery); and **runtime anomaly triggers** (simulation-failure rate over a sliding window, budget-abort spikes) demote flows between cron passes. Target G7 — change to re-verified-or-quarantined within one hour — is met because staleness marking is event-driven; only *repair* is asynchronous.

---

## 10. Scalability & Performance

### 10.1 The core scaling argument: flows are data

The design's central scalability property is that adding a flow adds **rows and KV entries, not code or processes**. All flows share one worker deployment, one interpreter, one node registry. Cloudflare's isolate model gives request-level horizontal scaling across 300+ PoPs with no capacity planning; an idle flow costs a few KB of storage. The practical ceiling on catalog size is therefore governance (can you keep 10,000 flows *verified*? — §9.4's automation exists precisely for this), not infrastructure. This is the difference between "hosting thousands of autonomous workflows" as a marketing claim and as an architectural consequence.

### 10.2 Latency budget (hot lane, p50 targets)

| Segment | Budget | Notes |
| --- | --- | --- |
| Edge routing + middleware | 5 ms | Hono, same worker |
| x402 verify (facilitator) | 50–150 ms | parallelizable with plan fetch + input validation |
| Plan fetch | 5 ms (KV hit) | warm plans pinned; hash-keyed |
| Stratum 1 (parallel resolvers) | 150–400 ms | dominated by 1 RPC read + 1 quote; hedged (§10.4) |
| Build + compose (in-process) | < 5 ms | pure CPU, microseconds per instruction |
| Preflight simulation | 150–350 ms | single RPC call |
| Settle (async tail) | 0 ms perceived | after response on success path where policy allows |
| **Total p50** | **≈ 400–900 ms** | meets G3 |

Two structural accelerators: facilitator verification runs concurrently with plan fetch and input validation (both must pass before stratum 1 side effects — but resolvers are reads, so they may optimistically start and be discarded on verify failure, a policy toggle per deployment); and quote/blockhash/pool-set micro-caches convert the most common RPC round trips into memory or KV hits under load — *higher traffic makes the system faster per request*, an unusual and investor-relevant property.

### 10.3 Throughput and platform limits

Steady-state load is ordinary stateless HTTP against Workers (millions of requests/day is routine). The relevant ceilings, checked against 2026 platform limits: subrequests per invocation (a hot-lane run uses 4–8; the paid-plan limit is orders of magnitude above), CPU time (interpreter + Borsh encoding is sub-millisecond; the 30 s default is not a factor), durable-lane concurrency (Workflows V2: 50K instances, 300 creations/s — a bound to monitor only if scheduled/reactive flows become the dominant product, at which point instance sharding across multiple Workflow definitions raises it), and D1 write throughput (run records are batched and are the first candidate to move to Analytics Engine / R2 cold storage at volume; §14).

### 10.4 RPC strategy

RPC is the true external bottleneck and cost center. The design treats it as a pooled, tiered resource: a provider pool (2+ commercial providers + fallback public endpoints) with per-provider health scoring; **hedged reads** for latency-critical resolver calls (fire the second provider after p90 of the first; take the winner) bounding tail latency at roughly 2× median; sticky provider selection per run for read-your-write consistency within a run; and per-provider circuit breakers (§11.3). Quote traffic to Jupiter is isolated in its own breaker + cache domain so an aggregator brownout degrades swap flows to protocol-native quote fallbacks rather than failing them.

### 10.5 Capacity envelope (design validation targets)

The load model used for design validation — 100K executions/day (~1.2 rps sustained, 50 rps burst), 10K published flows, 500 concurrent durable instances, catalog fully re-simulated daily — sits at least an order of magnitude inside every platform limit above. The engineering risk is therefore not "will it scale" but "will RPC costs scale linearly" — addressed by the caching tiers and by metering RPC consumption per flow in the run record, so pricing (§13.3) can track true marginal cost per flow class.

---

## 11. Reliability, Fault Tolerance & Recovery

### 11.1 Failure taxonomy

| Class | Example | Detection | Response |
| --- | --- | --- | --- |
| Transient infra | RPC timeout, quote 5xx | node error + effect type | bounded retry w/ jitter (reads only) |
| Provider degradation | RPC provider brownout | breaker statistics | failover within pool; hedging |
| Stale definition | IDL changed under a flow | simulation failure pattern, sync events | demote to `stale`, repair job (§9.4) |
| Bad input | invalid pubkey, amount > balance | schema + `logic.assert` guards | 4xx with structured error, no charge |
| Engine defect | interpreter bug | invariant violations, replay divergence | alert; catalog-wide halt switch |
| Payment plane | facilitator outage | verify/settle errors | §11.4 |
| Platform | Workers/D1/KV incident | CF status + synthetic probes | multi-plane degradation modes (§11.5) |

### 11.2 Retry discipline

Retries are governed by declared node effect types (§7.3): **pure** nodes never need retrying (deterministic); **read** nodes retry up to 2× with exponential backoff + jitter inside the node budget; **external** nodes follow their registration's retry contract (quotes: retry once, then fallback source; never retry a non-idempotent external POST — none exist in the core registry). Whole-run retries by the *caller* are safe by construction: execution has no on-chain side effects, and payment carries an idempotency key — re-presenting the same `X-PAYMENT` payload for the same request hash returns the cached result rather than double-charging. In the durable lane, Workflows checkpointing means a crash between strata resumes exactly once from the last committed step.

### 11.3 Circuit breakers and backpressure

Every external dependency (each RPC provider, each quote source, the facilitator) sits behind an independent breaker (closed → open on error-rate/latency threshold → half-open probes). Breakers are per-isolate with KV-published aggregate state so cold isolates inherit a warm view. On saturation signals the gateway sheds load early — returning 503 with `Retry-After` *before* payment verification, so callers are never charged into a degraded system.

### 11.4 Payment-plane failure semantics

The invariant is **no result without verified payment; no settlement without delivered result; every divergence recorded.** Concretely: verify unavailable → 503 pre-charge (fail closed); verify passes / execution fails → no settle, structured error, no charge; execution succeeds / settle fails → result *is* delivered, receipt marked `settlement_pending`, retried by a reconciliation cron, exposure bounded by per-caller unsettled-value caps that trip a temporary block. Facilitator dependence is mitigated by the pluggable facilitator client (CDP-hosted at launch; the Solana Kora-based self-hosted facilitator path is the documented escape hatch — §20).

### 11.5 Degradation modes and disaster recovery

The system degrades by plane, not as a monolith: catalog reads work from KV even if D1 is down; execution works if D1 is down (plans in KV, run records buffered to Queues for deferred write); `estimate_flow` (unpaid) remains available if the payment plane is down; only KV + Workers loss (a platform-wide event) stops execution. State is recoverable by tier: D1 point-in-time restore (30-day Time Travel) for the registry; KV is a rebuildable cache (full plan-cache rebuild ≈ minutes of recompilation); flow definitions are additionally mirrored append-only to R2 on publish, so even a total registry loss reduces to re-import + recompile. RTO target: catalog reads < 5 min, execution < 30 min, full control plane < 4 h. Chaos drills (§18.4) rehearse the top three scenarios quarterly.

### 11.6 SLOs

| SLO | Target | Error budget consequence |
| --- | --- | --- |
| Execution availability (paid calls) | 99.9% monthly | freeze feature deploys; reliability-only |
| Hot-lane p95 latency | ≤ 2.5 s | RPC pool/caching review |
| Wrongful-charge rate (charged, no result) | < 0.01% | automatic refund path + incident |
| Catalog freshness (stale flows executable) | 0 tolerated | any occurrence = Sev-2 |
| Health-cron coverage | 100% daily | pipeline alert |

---

## 12. Security Model

### 12.1 Trust boundaries and threat actors

Four boundaries: caller ↔ gateway (untrusted input, payment fraud), flow definition ↔ engine (malicious or defective flows — the *supply chain*), engine ↔ external services (RPC/quote manipulation, SSRF), and platform ↔ operator (key and secret handling). Threat actors considered: malicious callers, malicious flow authors (in the future third-party marketplace), compromised external dependencies, and a compromised authoring model emitting subtly wrong flows.

### 12.2 The no-sign invariant (defense in depth)

The signature property of the entire platform: **OFE cannot spend funds.** Enforced in four independent layers — (1) *type system*: no sign/submit node type exists in the registry, so no FDL document can express signing; (2) *capability*: the worker holds no key material of any kind; there is nothing to exfiltrate; (3) *output contract*: the terminal artifact is an unsigned transaction plus a machine-readable risk report; the caller (or their signer skill, per the existing `agents/SKILLS.md` policy) is the sole approval point; (4) *audit*: the composed transaction embeds only instructions traceable to plan nodes — the runtime rejects any instruction not originating from a node output (preventing a compromised node implementation from smuggling an extra transfer).

The one deliberate, disclosed exception to "OFE adds nothing": the optional in-transaction fee instruction (§13.3), which is appended by the trusted composer itself, is declared in `policies.pricing.feeDisclosure`, appears in the risk report, and is capped by schema (`inTxFeeBps ≤ 50`). Undisclosed fees are structurally impossible to publish (static check §9.3-1).

### 12.3 Input, expression, and resource safety

All inputs validate against the flow's published JSON Schema before any effect (existing zod infrastructure). The expression language is non-Turing-complete with no reflection, no string-to-code path, and evaluator-enforced step limits. Budgets (`wallTimeMs`, `externalCalls`, `rpcCalls`) bound every run; the compiler rejects graphs whose worst-case fan-out exceeds policy ceilings — an FDL document cannot express an amplification attack against the RPC pool.

### 12.4 External call security

`external.http` targets an **allowlist registry** (exact hosts + path prefixes + methods + response schemas), never caller-supplied URLs — SSRF is excluded by construction, not by filtering. Responses are schema-validated at the boundary and treated as untrusted data; a quote source can lie about prices, which is why value-bearing flows must carry guard nodes asserting output sanity (e.g., `minOutAmount` within tolerance of an independent reference) — a *pattern enforced by the validator* for flows tagged `intent: swap`.

### 12.5 Supply-chain integrity of flows

Published versions are content-hashed and signed by the publisher key; the runtime executes only signed hashes; alias moves are audit-logged with approver identity. The authoring model is treated as an untrusted generator: nothing it emits reaches `published` without the full battery (§9.3), and its own prompt context is assembled exclusively from Orquestra-controlled artifacts (IDL, generated docs, descriptors) — never from caller-supplied text — closing the prompt-injection path from users into published flows. Third-party authorship (marketplace) adds staking/slashing-style economic accountability in §19.

### 12.6 Payment and abuse

Standard x402 verification via facilitator (signature, amount, asset, replay protection); per-caller and per-IP rate limits on the unpaid surfaces (`402` issuance, `estimate_flow`) since they consume resolver work; per-flow and per-caller concurrency caps; anomaly detection on the run stream (same caller × failing runs × high-cost flows). Secrets (RPC keys, publisher signing key, facilitator credentials) live in Workers Secrets, rotated on schedule, never in FDL or D1.

### 12.7 Simulation is not a guarantee — honest framing

Preflight simulation executes against *current* state; landing occurs later against *future* state. OFE therefore never markets simulation as protection: the risk report states simulation time, slot, and the caveat, and value-bearing flows embed on-chain guards (min-out amounts, slippage bounds) so that adverse state drift makes the transaction *fail on-chain* rather than execute badly. This framing discipline is part of the security model: the platform's trust story survives its first adversarial audit only if its claims are exact.

---

## 13. Monetization Architecture (x402)

### 13.1 Protocol integration

x402 on Solana works as follows: the server responds `402` with `PaymentRequirements` (scheme `exact`, asset USDC SPL, amount, recipient, network); the client constructs and signs a partial SPL token-transfer transaction and sends it base64-encoded in the `X-PAYMENT` header; the facilitator verifies it (`/verify`), co-signs as fee payer, and submits it on settlement (`/settle`); the server returns `X-PAYMENT-RESPONSE` with the settlement reference. OFE implements this as a Hono middleware (peer of the existing `middleware/auth.ts` and `rate-limit.ts`) with a pluggable facilitator client — Coinbase CDP's hosted facilitator at launch (free tier: 1,000 tx/month, then $0.001/tx; supports Solana), and a documented migration path to a self-hosted Kora-based facilitator if fees, features, or neutrality ever demand it.

### 13.2 Why x402 fits this product exactly

The buyer is software. x402 requires no accounts, no API-key provisioning, no invoicing, and no minimums — an agent that discovered a flow via MCP thirty seconds ago can pay for one execution of it with no human onboarding. Micro-prices ($0.001–$0.05) are uneconomic on card rails and native on x402. And because settlement is on Solana itself, the payment and the product live on the same chain — one integration surface for the buyer.

### 13.3 Revenue lines

| Line | Mechanism | Price posture | Notes |
| --- | --- | --- | --- |
| Execution fees | x402 `exact` per call | $0.001–0.005 (instruction flows) · $0.005–0.02 (intent flows) · $0.02–0.05 (quote-bearing/composed) | pure margin above RPC+facilitator cost |
| In-transaction fee | fee-transfer instruction appended by composer | 5–10 bps on value-bearing intents | the high-ceiling line; standard aggregator practice; always disclosed (§12.2) |
| Subscriptions | monthly tiers replacing per-call x402 for high-volume callers | $49 / $199 / $499 + committed-use discounts | for agents with wallets *and* budgets |
| Marketplace share | third-party flow authors publish; platform takes 30% | 70/30 author/platform | activates with §19 marketplace |
| Free tier | metadata, discovery, N estimates/day, canary flows | $0 | the adoption engine |

Line 2 deserves emphasis in any investor narrative: per-call fees price the *computation*; the bps fee prices the *value flowing through the computation*, and scales with GMV rather than call count. At 10K executions/day with 30% value-bearing at $200 average notional and 8 bps: ≈ $14K/month from bps against ≈ $1.5K from per-call fees. All projections are sensitivity illustrations, not forecasts; the canary mechanism (§9.1) doubles as a live price-discovery instrument.

### 13.4 Unit economics per execution

Marginal cost per hot-lane execution: RPC reads (3–6 calls ≈ $0.0002–0.001 at commercial rates), facilitator ($0.001 beyond free tier), Workers request (≈ $0.0000003), amortized authoring (≈ $0.13 over a flow's lifetime of calls → effectively 0). Gross margin at the $0.005 median price point exceeds 60% from the first paid call and rises with cache hit rates. The published price floor per flow class is derived from metered RPC consumption in run records — pricing follows measured cost, not guesswork.

### 13.5 Accounting and reconciliation

Every execution writes an immutable receipt row (`flow_payments`): payment payload hash, facilitator settlement reference, amount, asset, payer, flow hash, run id, and split allocation. A reconciliation cron matches receipts against facilitator settlement records and on-chain transfers; divergences (settlement_pending, §11.4) age into alerts. Marketplace revenue splits accrue to author balances with monthly on-chain payout — itself executed, fittingly, as an OFE durable flow.

---

## 14. Data Model

New tables follow the existing numbered-migration convention (next: `022_*`). Abridged DDL:

```sql
-- 022_flows.sql
CREATE TABLE flows (
  id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, owner_user_id TEXT,
  intent TEXT NOT NULL, protocol TEXT, tier TEXT CHECK (tier IN ('instruction','intent','composed')),
  status TEXT NOT NULL CHECK (status IN ('draft','validated','simulated','canary','published','stale','deprecated','archived')),
  stable_version_hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE flow_versions (
  content_hash TEXT PRIMARY KEY, flow_id TEXT NOT NULL REFERENCES flows(id),
  version INTEGER NOT NULL, fdl_json TEXT NOT NULL, plan_json TEXT,      -- plan also cached in KV
  metadata_json TEXT NOT NULL, publisher_sig TEXT, battery_report_json TEXT,
  created_at TEXT NOT NULL, UNIQUE (flow_id, version)
);
CREATE TABLE flow_dependencies (            -- for stale-propagation on IDL/node/descriptor change
  version_hash TEXT NOT NULL, dep_kind TEXT NOT NULL CHECK (dep_kind IN ('program_idl','node_type','descriptor','flow')),
  dep_key TEXT NOT NULL, PRIMARY KEY (version_hash, dep_kind, dep_key)
);
CREATE TABLE flow_runs (
  id TEXT PRIMARY KEY, version_hash TEXT NOT NULL, lane TEXT CHECK (lane IN ('hot','durable')),
  status TEXT NOT NULL, inputs_hash TEXT, outputs_json TEXT, error_json TEXT,
  latency_ms INTEGER, rpc_calls INTEGER, external_calls INTEGER,
  payer TEXT, payment_id TEXT, created_at TEXT NOT NULL
);                                           -- hot-path writes batched; archived to R2 at volume
CREATE TABLE flow_payments (
  id TEXT PRIMARY KEY, run_id TEXT, version_hash TEXT NOT NULL,
  scheme TEXT, asset TEXT, amount TEXT, payer TEXT,
  payment_payload_hash TEXT, settlement_ref TEXT,
  status TEXT CHECK (status IN ('verified','settled','settlement_pending','refunded')),
  split_json TEXT, created_at TEXT NOT NULL
);
CREATE TABLE flow_health (
  version_hash TEXT PRIMARY KEY, last_sim_at TEXT, last_sim_ok INTEGER,
  fail_streak INTEGER DEFAULT 0, window_error_rate REAL, demoted_at TEXT
);
CREATE TABLE protocol_descriptors (
  protocol TEXT NOT NULL, version INTEGER NOT NULL, descriptor_json TEXT NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY (protocol, version)
);
CREATE TABLE node_types (
  name TEXT NOT NULL, major INTEGER NOT NULL, schema_json TEXT NOT NULL,
  effect TEXT CHECK (effect IN ('pure','read','external')), retry_policy_json TEXT,
  status TEXT CHECK (status IN ('active','deprecated')), PRIMARY KEY (name, major)
);
```

KV layout: `plan:{hash}` (compiled plan, immutable), `flowmeta:{slug}` (published contract), `catalog:index:{filterKey}` (paginated catalog pages), plus existing IDL/docs namespaces. R2: `flows/{hash}.json` append-only mirror (DR), `runs/archive/` cold storage.

---

## 15. API Surface

REST (public, x402-gated where noted):

| Endpoint | Payment | Purpose |
| --- | --- | --- |
| `GET /flows` · `GET /flows/:slug` | free | catalog, published contract |
| `POST /flows/:slug/estimate` | free (rate-limited) | resolve + build + simulate; no settlement; watermarked result |
| `POST /flows/:slug/execute` | x402 | full execution → outputs + unsigned tx + risk report + receipt |
| `GET /runs/:id` | free (owner) | durable-lane status/result |
| `POST /flows` · `POST /flows/:id/versions` | authed (authoring) | submit draft (enters lifecycle at `draft`) |
| `POST /admin/flows/:id/approve|demote` | admin | policy-gate actions, audit-logged |

MCP adds the tools in §8.1 to the existing server. Errors are structured (`code`, `message`, `nodeId?`, `retriable`, `docs` URL) — machine-actionable first, human-readable second.

---

## 16. Development Roadmap

Effort assumes one senior engineer full-time plus the authoring agents; calendar ranges reflect solo vs. +1 engineer.

| Phase | Deliverable | Exit criterion | Effort |
| --- | --- | --- | --- |
| **0. Transaction substrate** | multi-instruction `composeTransaction`, v0 + ALT support, route→service refactor (in-process callability) | existing tests green + new composer fixtures; a 4-instruction v0 tx simulates on mainnet | 2–3 wk |
| **1. Engine core** | FDL schema, compiler (validate + plan), hot-lane interpreter, resolver set (pda/ata/state/filter/blockhash/constant), node registry | 3 hand-written flows (swap via Jupiter, Marinade stake, Kamino deposit) execute p50 < 1 s | 3–4 wk |
| **2. Registry & lifecycle** | D1 migrations, KV caches, lifecycle state machine, verification battery, health cron, REST + MCP catalog surface | hand-written flows pass full battery and publish through the pipeline | 2–3 wk |
| **3. Payment plane** | x402 middleware, CDP facilitator client, receipts, reconciliation, estimate endpoint | first paid execution end-to-end on mainnet USDC; wrongful-charge tests pass | 1–2 wk |
| **4. Authoring plane** | flow-author + flow-validator skills, authoring Workflow, repair loop, policy gates, approval UI (frontend) | agent authors a novel instruction flow that publishes with zero human edits | 3–4 wk |
| **5. Catalog seed** | batch generation across top-100 + 214 verified programs (≈4,000 instruction flows), 30–60 curated intent flows | ≥90% of instruction flows pass battery; intent flows human-approved; catalog live | 2–3 wk (machine-parallel) |
| **6. Durable lane** | FlowRunnerWorkflow, temporal node types, webhooks, run polling | a DCA flow survives a deploy mid-schedule | 2 wk |
| **7. Hardening & launch** | breakers, hedged RPC, chaos drills, dashboards, runbooks, canary pricing experiments | SLO dashboard green for 2 consecutive weeks under synthetic + real load | 2–3 wk |

**Totals:** 17–24 weeks solo (≈ 4–5.5 engineer-months); 11–15 weeks with two engineers. **Revenue-capable MVP** (Phases 0–3 + 3 curated flows) lands at **8–10 weeks**. Non-labor cost to full catalog: authoring inference $700–1,100, CI simulation RPC $100–300, funded test wallets < $200, incremental Cloudflare < $50/month — under **$2K total**; labor dominates (≈ $30–55K contracted at $45–70/h, or founder time). Steady-state operating cost at 10K executions/day: ≈ $150–700/month (RPC-dominated), against §13.3 revenue.

---

## 17. Deployment Strategy

**Environments.** `development` (local wrangler + local D1), `staging` (workers.dev, devnet-default RPC, mock facilitator + CDP sandbox), `production` (existing `api.orquestra.dev` zone) — extending the current `wrangler.toml` env structure unchanged.

**Two independent release tracks.** *Engine releases* (worker code): CI (type-check, lint, `bun test` including the full catalog fixture suite) → staging soak with synthetic paid traffic → production via gradual deployment (Cloudflare's percentage-based rollout) with automatic rollback on SLO-breach signals; D1 migrations are expand-migrate-contract (additive first, destructive only after a full release cycle), preserving the existing numbered-migration workflow. *Catalog releases* (flow data): decoupled from deploys entirely — the lifecycle machine (§9) is the release process; canary is the catalog's staging. This decoupling is why a 10,000-flow platform can ship engine updates weekly without 10,000 regression cycles: the fixture suite + daily health cron *are* the catalog regression.

**Node-registry upgrades** (the risky middle): a new node-type major triggers a catalog impact query (`flow_dependencies`), batch recompilation, re-battery of affected flows on staging, then aliased promotion — never an in-place mutation of plans.

**Configuration.** All secrets in Workers Secrets; all tunables (breaker thresholds, cache TTLs, price floors, policy-gate rules) in a KV-backed config document with audit-logged writes, hot-reloaded per isolate — no deploy to change a threshold.

---

## 18. Operational Processes

### 18.1 Monitoring & alerting

Dashboards (Analytics Engine → Grafana/CF dashboards): execution funnel (402-issued → verified → executed → settled), latency percentiles per lane and per stratum, RPC pool health, catalog state distribution (published/stale/canary counts), payment reconciliation lag, revenue by line. Paging alerts map to SLOs (§11.6): availability burn rate, wrongful-charge > 0, stale-executable > 0, reconciliation lag > 1 h, health-cron gaps. Non-paging: authoring-pipeline failure rate, repair-queue depth, canary anomaly flags.

### 18.2 Runbooks (maintained in-repo, drilled quarterly)

RPC provider brownout (breaker confirms → pool weights → provider ticket); facilitator outage (verify fail-closed posture, queue-settlement replay, comms template); catalog mass-staleness after protocol upgrade (impact query → bulk repair jobs → priority-order by revenue); wrongful-charge report (receipt lookup → replay from capture → refund path → postmortem); engine invariant violation (halt switch → pin last-good release → replay divergent runs).

### 18.3 Catalog operations

A weekly "catalog editor" review (human, ~2 h/week at steady state): approve queued intent flows, audit the 10% instruction-flow sample, review canary price experiments, retire zero-traffic flows. This is deliberately the *only* recurring human process in the loop, and its scope is bounded by policy, not by catalog size.

### 18.4 Incident management & drills

Sev-1 (execution down / funds-relevant claim wrong) → 15 min acknowledgment target, public status note; Sev-2 (SLO breach, catalog integrity) → same-day; Sev-3 → weekly triage. Quarterly chaos drills: kill primary RPC mid-load, facilitator 5xx storm, forced D1 read-replica lag, and one full DR restore from R2 mirror + recompile.

---

## 19. Future Expansion

**Reactive flows (chain-triggered autonomy).** Durable-lane flows subscribed to on-chain events (webhook providers / WebSocket → Queues → `waitForEvent`): "when my Kamino health factor < 1.2, prepare a deleverage transaction and notify my signer." This is the step from *request-driven* to *condition-driven* autonomy — the engine's architecture already supports it; the work is event-source integration and subscription billing (x402 `upto`-style metered scheme as it standardizes).

**Third-party marketplace.** External authors publish flows through the same lifecycle; economic accountability via author staking + slashing on invariant violations; 70/30 split rails already in the payments schema. The catalog becomes a two-sided market: Orquestra seeds supply (§16 Phase 5), the marketplace compounds it.

**Tenant code nodes.** For logic FDL cannot express, Cloudflare's Dynamic Workers/Dynamic Workflows primitives allow sandboxed, tenant-supplied node implementations with isolate-level isolation at zero idle cost — the natural growth path once curated node types prove insufficient, without re-architecting (the node registry simply gains a `dynamic` effect class with its own review tier).

**AP2 mandates.** As Google's Agent Payments Protocol matures, accept AP2 verifiable mandates above the x402 layer — giving human principals cryptographic control over what their agents may buy ("this agent may spend ≤ $10/day on swap-intent flows"). OFE's per-flow metadata (intent, price, risk) is exactly the vocabulary mandates need.

**Multi-chain.** The engine is chain-agnostic above the node layer: FDL, compiler, lifecycle, payments, and catalog carry over; a chain is a namespace of node types (`evm.build_calldata`, `resolve.erc20_allowance`). SVM-adjacent targets (Eclipse) are near-free; EVM requires an ABI-reflection substrate analogous to Orquestra's IDL layer — a large but well-bounded project, and the reason the IDL-reflection asset is strategically portable.

**Verifiable execution.** Longer-horizon: publish signed execution transcripts (plan hash + resolver capture + output) so third parties can re-verify that a paid result was computed faithfully — a trust primitive for the agent economy, and a grant-friendly research direction (TEE or ZK attestation of the interpreter).

---

## 20. Trade-offs & Design Decisions

| # | Decision | Alternative rejected | Rationale / accepted cost |
| --- | --- | --- | --- |
| D1 | Declarative JSON DSL interpreted by one engine | per-flow generated code (Dynamic Workers) | static verifiability (incl. no-sign proof), zero-deploy publishing, hash-auditable artifacts; cost: expressiveness ceiling — mitigated by node registry growth + §19 tenant nodes |
| D2 | No LLM in execution path | agentic loop per request | determinism, p50 < 1 s, replayable audits, no per-request inference cost; cost: fuzzy decisions must be modeled as graph branches — an intended forcing function |
| D3 | Two-lane runtime (in-Worker + Workflows V2) | everything on Workflows / everything request-scoped | Workflows adds checkpoint latency the hot path doesn't need; request scope can't sleep or wait; the compiler choosing per graph removes the dilemma; cost: two execution substrates to test — shared interpreter core minimizes divergence |
| D4 | In-process node calls | HTTP-to-self microcalls | 6× fewer network hops, no subrequest quota burn; cost: a service-layer refactor of existing routes (Phase 0) — also improves the existing codebase |
| D5 | Cloudflare-native stack | Temporal/k8s/containers | zero-ops edge scale, isolate economics, existing team expertise and production workflows; cost: platform coupling — mitigated by R2 mirror + the engine being portable TypeScript with thin bindings |
| D6 | Unsigned-tx boundary (never custody) | server-side signing for "one-call UX" | eliminates the catastrophic risk class entirely, simplifies compliance posture, aligns with existing signer-skill policy; cost: callers need a signer — acceptable, that is the wallet ecosystem's job |
| D7 | x402 via hosted facilitator (CDP) at launch | self-hosted facilitator day one | weeks of saved scope, free tier covers early volume; cost: a dependency — mitigated by pluggable client + documented Kora self-host path |
| D8 | Verify → execute → settle | settle-first | never charge for failures (agent-trust critical); cost: bounded unsettled exposure, capped per caller (§11.4) |
| D9 | Protocol descriptors as data | "pure IDL genericity" claim | quotes/pool semantics are simply not in IDLs; a one-screen JSON fact sheet per protocol is the honest, minimal concession; cost: per-protocol onboarding step — measured in hours |
| D10 | Content-addressed, append-only versions | mutable flow records | reproducibility, billing auditability, safe rollback; cost: storage growth — trivial at JSON sizes |
| D11 | Catalog breadth (all ≈4,000 instructions) *and* curated intent depth | intent flows only | breadth makes the catalog the default lookup for any indexed program (SEO/discovery for agents) at near-zero marginal cost; depth is where revenue concentrates; the design funds breadth with automation so human attention goes exclusively to depth |
| D12 | In-tx bps fee, always disclosed | per-call fees only | value-linked revenue with GMV ceiling vs. call-count ceiling; cost: trust sensitivity — addressed structurally (schema-enforced disclosure, risk-report surfacing, §12.2) |

---

## 21. Appendices

### A. Glossary

**FDL** — Flow Definition Language (§6). **Flow** — a published, versioned FDL document; the unit of capability, discovery, pricing, and reuse. **Plan** — compiled, stratified execution form of a flow version. **Node type** — a registered, versioned, effect-typed operation. **Resolver** — a node type implementing late binding (class R). **Stratum** — a maximal set of mutually independent node invocations, executed in parallel. **Lane** — execution substrate (hot = request-scoped; durable = Workflows V2). **Battery** — the pre-publish verification suite (§9.3). **Descriptor** — a per-protocol machine-readable fact sheet (§7.3). **I/R/C** — the input/resolvable/constant parameter calculus (§4.2).

### B. Corpus measurements (basis for scale & cost claims)

Local IDL corpus at design time: 212 IDLs; 2,718 instructions; mean 12.8, median 8, max 129 instructions per program. Target catalog: top-100 most-used + 214 verified programs ⇒ ≈ 4,000 instruction-level flows ± 20% (exact figure to be read from production D1 before Phase 5 batch sizing).

### C. References

x402: [x402 Foundation spec (GitHub)](https://github.com/x402-foundation/x402) · [x402 on Solana — official guide](https://solana.com/developers/guides/getstarted/intro-to-x402) · [Building an x402 facilitator with Kora](https://solana.com/developers/guides/getstarted/build-a-x402-facilitator) · [Coinbase CDP x402 docs](https://docs.cdp.coinbase.com/x402/welcome) · [Facilitator concepts](https://x402.gitbook.io/x402/core-concepts/facilitator).
Agent payments stack: [Google AP2 announcement](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol) · [AP2 protocol docs](https://ap2-protocol.org/) · [Agentic payment protocols compared (Crossmint)](https://www.crossmint.com/learn/agentic-payments-protocols-compared) · [x402 under the Linux Foundation](https://genfinity.io/2026/04/02/x402-protocol-linux-foundation-ai-payment-protocol/).
Platform: [Cloudflare Workflows V2](https://blog.cloudflare.com/workflows-v2/) · [Dynamic Workflows](https://blog.cloudflare.com/dynamic-workflows/) · [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) · [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/).
Internal: `docs/architecture.md`, `docs/mcp-tools.md`, `docs/agent-skills.md`, `packages/worker/src/services/tx-builder.ts`, `agents/SKILLS.md`.
