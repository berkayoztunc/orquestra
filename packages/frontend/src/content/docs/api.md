Query public Solana program metadata, inspect instruction schemas, derive PDAs, and build unsigned transaction payloads through the same Orquestra API surface used by the docs and MCP server.

[Open OpenAPI Spec](https://api.orquestra.dev/openapi.json) · [View API Catalog](/.well-known/api-catalog)

## Workflow

1. **Find a program** — search public projects or resolve a known Solana program id into an Orquestra project.
2. **Inspect the IDL surface** — list instructions, accounts, PDA derivation schemas, and program account query filters before building a request.
3. **Build unsigned payloads** — generate base58 transaction payloads that wallets or agents can sign client-side.

## Base URL

```text
https://api.orquestra.dev
```

## Discovery

| Resource | URL | Description |
| --- | --- | --- |
| OpenAPI | `https://api.orquestra.dev/openapi.json` | Machine-readable API description for the public Orquestra endpoints. |
| API Catalog | `/.well-known/api-catalog` | RFC 9727 API catalog for automated service discovery. |
| OAuth Metadata | `https://api.orquestra.dev/.well-known/oauth-protected-resource` | Protected resource metadata for API authentication discovery. |

## Authentication

Public discovery endpoints are open. Build and protected project flows use either a session token or an API key.

| Mode | Header | Value |
| --- | --- | --- |
| Bearer session token | `Authorization` | `Bearer <session-token>` |
| Project API key | `X-API-Key` | `<project-api-key>` |

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/projects` | List and search public projects. |
| GET | `/api/projects/by-program/{programId}` | Resolve a project from its Solana program id. |
| GET | `/api/{projectId}/instructions` | List available instructions and their arguments. |
| **POST** | `/api/{projectId}/instructions/{instructionName}/build` | Build an unsigned transaction payload. Legacy by default; opt in to `v0` or `v1` with `txVersion`. |
| GET | `/api/{projectId}/pda` | Discover PDA-derivable accounts and seed schemas. |
| GET | `/api/{projectId}/pda/fetch/{address}` | Fetch on-chain account data and decode it against the project IDL. Accepts `?network=`. |
| **POST** | `/api/{projectId}/program-accounts/query` | Query program-owned accounts with `dataSize` and `memcmp` filters. Accepts `?network=`. |
| **POST** | `/mcp` | Streamable HTTP MCP endpoint for agent tooling. |

## Network parameter

Endpoints marked `?network=` accept an optional `network` query parameter to target a specific Solana cluster. Omitting it defaults to `mainnet-beta`.

- `mainnet-beta` — default, live production cluster.
- `devnet` — Solana devnet for development and testing.
- `testnet` — Solana testnet for validator staging.

```text
GET https://api.orquestra.dev/api/{projectId}/pda/fetch/{address}?network=devnet
```

## Example request

```bash
curl -X POST https://api.orquestra.dev/api/{projectId}/instructions/{instructionName}/build \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_PROJECT_KEY" \
  -d '{
    "accounts": {"payer": "..."},
    "args": {},
    "feePayer": "..."
  }'
```

## Transaction format (`txVersion`)

`txVersion` is optional. Omit it and the build endpoint returns a **legacy** transaction, exactly as before.

| `txVersion` | Format | Limits |
| --- | --- | --- |
| omitted / `legacy` | Legacy message (default) | 1232 bytes |
| `v0` | Versioned message, no lookup tables | 1232 bytes |
| `v1` | Solana Transaction v1 (SIMD-0385) | 4096 bytes, max 64 inline accounts, no address lookup tables |

For `v1`:

- `encoding` defaults to `base64`. `base58` is rejected when the transaction is over 1232 bytes.
- Compute-unit and loaded-accounts limits live in the message config, not in ComputeBudget instructions. Orquestra measures them with one preflight simulation (+10%), or falls back to protocol maxima. Override with `txConfig`: `{ "priorityFeeLamports": 5000, "computeUnitLimit": 20000, "loadedAccountsDataSizeLimit": 65536, "heapSize": 65536 }`. `priorityFeeLamports` is a total in lamports.
- `txConfig` without `txVersion: "v1"` is rejected with a 400.
- The response `wireFormat` says what was produced. A v1 transaction starts with byte `0x81`; `@solana/web3.js` 1.x cannot decode it (use `@solana/kit` 8+). Make sure your signer or wallet supports v1.

## IDL provenance

Every IDL served by Orquestra carries a `provenance` object (`origin`, `idlSource`, `verifiedOnChain`, `notice`) on project detail, by-program, `/idl`, `/instructions`, `/docs` and build responses.

- `origin: "onchain"` — the IDL was read from the program's on-chain IDL account (`anchor` or `pmp`).
- `origin: "manual"` — **no on-chain IDL exists**; the project owner uploaded the IDL manually. It is not verified against the chain, so check instruction names, accounts and arguments before signing. `notice` explains this, and the same warning is added to `llms.txt`, docs and MCP tool output.

When a program has an on-chain IDL, an upload or update is replaced by the on-chain IDL, and the response `warnings` list any differences. If the chain cannot be reached, uploads fail with `503 ONCHAIN_IDL_CHECK_FAILED` instead of guessing.

## Manual-IDL projects (secure)

Projects whose IDL was **uploaded manually** (no on-chain IDL) are unverified and may be malicious, so they are excluded by default. Pass `secure=false` to opt in explicitly. `secure` defaults to `true`; only an explicit `false` changes it.

| Surface | Default | With `secure=false` |
| --- | --- | --- |
| `GET /api/projects` (browse and search) | Not listed | Listed, with a `provenance` notice |
| `GET /api/projects/by-program/{programId}` | `404` (`MANUAL_IDL_HIDDEN`); the owner still sees it | Returned |
| `POST /api/{projectId}/instructions/{name}/build` | `403` (`MANUAL_IDL_BLOCKED`); the owner may still build | Builds, response carries `provenance` |
| MCP `search_programs`, `build_instruction`, `simulate_instruction` | Hidden / refused | Allowed, with the manual-IDL warning |

Use `?secure=false` on GET routes, and `?secure=false` or `"secure": false` in the build body. Only do this when the user explicitly asked for that program and trusts its uploader: a manual IDL is just the uploader's claim about what a program does, and anyone can upload one for a program ID they do not control. Reading a project directly by ID still works and always carries the warning.

## Which integration should I use?

- **App backends** — use the REST API directly if you're wiring Orquestra into a dashboard, API layer, cron workflow, or custom signing service.
- **Agents** — use the `/mcp` endpoint when you want AI clients to discover tools, inspect instruction metadata, and build payloads conversationally.
