# Flow Engine — Admin Guide

How to run migrations, publish/inspect flows, and operate the flow catalog directly with an ingest key.
For the client/MCP-authoring workflow see the [client guide](flow-engine-client-guide.md). For
background on what a flow is see [the overview](flow-engine.md).

The flow registry rides the existing `orquestra` worker — there is no separate deploy, no separate
Cloudflare Worker, and no new binding. `GET/POST /flows` and `/flow/mcp` are just more routes on the
same worker you already deploy with `bun run deploy` / `bun run deploy:worker`.

## One-time setup: apply migration 024

The registry tables (`flows`, `flow_versions`, `flow_runs`, `protocol_descriptors`) live in
`migrations/024_flows.sql`. Apply them the same way as any other migration (see
[Deployment](deployment.md)):

```bash
# local
bun run db:migrate:dev

# remote (only when you're ready to publish real flows in prod)
bun run db:migrate
```

Nothing else to configure — no new KV namespace (flows reuse the existing `CACHE` binding), no new
secret beyond the `INGEST_API_KEY` you already have for IDL ingest.

## Auth

Every write endpoint (publishing) uses the same `X-Ingest-Key` header and `INGEST_API_KEY` Worker
secret as the existing CLI IDL-ingest endpoint (`POST /api/ingest/idl`). Read endpoints (catalog list,
get one flow, estimate) are open, matching the rest of the public API.

```bash
wrangler secret put INGEST_API_KEY --env production
```

## Publishing a flow

```bash
curl -X POST https://api.orquestra.dev/flows \
  -H "Content-Type: application/json" \
  -H "X-Ingest-Key: $INGEST_API_KEY" \
  -d '{
    "fdl": { ...full FDL document... },
    "tier": "instruction",
    "publish": true
  }'
```

- `fdl` — the full FDL document. Required. Rejected with `kind: "compile_error"` and a per-node
  `errors` list if it doesn't compile — nothing is written to D1 in that case.
- `tier` — `"instruction" | "intent" | "composed"`. Optional, defaults to `"instruction"`. Catalog
  metadata only, not enforced by the compiler.
- `publish` — defaults to `true` (goes live immediately — this endpoint is already the trusted/admin
  gate, there's no separate review step). Pass `false` to land a draft version without moving the
  `@stable` pointer.

Success response:

```json
{ "ok": true, "slug": "letmebuy-initialize-store", "flowId": "...", "contentHash": "...", "status": "published" }
```

Publishing is **content-addressed and idempotent**: re-publishing byte-identical FDL is a no-op (same
`contentHash`, no duplicate version row). Publishing a *changed* FDL under the same `meta.slug` creates
a new version under the same flow and moves the `@stable` pointer to it — the old version stays in
`flow_versions`, just no longer served.

The MCP tool `publish_flow` (on `/flow/mcp`) does exactly the same thing with `ingestKey` as a tool
argument instead of a header — useful when the flow was authored by an MCP-connected client. See the
[client guide](flow-engine-client-guide.md).

## Inspecting the catalog

```bash
# list every published flow
curl https://api.orquestra.dev/flows

# get one flow's published contract (meta/inputs/outputs)
curl https://api.orquestra.dev/flows/letmebuy-initialize-store
```

Both are read-only, no auth required, and only ever return `status = 'published'` flows — drafts
(`publish: false`) don't show up here.

## Running a flow (estimate)

```bash
curl -X POST https://api.orquestra.dev/flows/letmebuy-initialize-store/estimate \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": { "wallet": "...", "storeName": "my-store" },
    "network": "mainnet-beta"
  }'
```

This resolves every node, builds the real instruction(s) against the live IDL, composes the
transaction(s), and (by default) simulates. **No payment, nothing is signed or submitted** — the
`x402`-metered `execute` endpoint is a planned, not-yet-built layer on top of this. Success response:

```json
{ "ok": true, "watermark": "estimate", "outputs": { "<lastNodeId>": { "transactions": [...], "risk": {...} }, ... } }
```

`outputs` is every node's output keyed by node id — the transaction(s) you actually want are on
whichever node id is your flow's `solana.compose_transaction@1` step.

## Error shapes

Every flow-engine endpoint always returns a structured JSON body — never an unhandled 500 with a
stripped message (that's deliberately how the *rest* of the API behaves for security; flow responses
are meant to be read and acted on, often by an LLM). `kind` tells you what to do next:

| `kind` | Meaning | What to do |
| --- | --- | --- |
| `not_found` | No published flow with that slug | Check `GET /flows` for the real slug |
| `bad_request` | Malformed request body | Fix the request shape |
| `compile_error` | FDL itself is structurally invalid | Fix the FDL per `errors[]`, not published |
| `run_error` | Compiled fine, failed at run time (bad input, a node threw) | Check `nodeId` + `reason`; `partialOutputs` shows what ran before the failure |
| `system_error` | Something broke server-side, not the flow's fault | Retry; report if it persists (message is intentionally not echoed, logged server-side instead) |

## Lifecycle notes (current state, MVP)

- `flows.status` is either `draft` or `published` today — the fuller state machine in the design doc
  (`validated → simulated → canary → published → stale → …`) isn't wired up yet. Publishing with
  `publish: true` (the default) goes straight to `published`.
- There is no automated re-verification / staleness detection yet (design doc §9.4). If an underlying
  program's IDL changes, a published flow that references it silently starts failing at `estimate`
  time (`run_error`) rather than being auto-demoted — check flows after an IDL bump on a program you
  depend on.
- No authoring pipeline exists yet — every flow in the registry got there via a human or an
  MCP-connected LLM calling `POST /flows` / `publish_flow` directly. See the
  [client guide](flow-engine-client-guide.md) for that workflow.
