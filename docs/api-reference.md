# API Reference

Production base URL:

```text
https://api.orquestra.dev
```

Local base URL:

```text
http://localhost:8787
```

## Authentication

Supported auth modes:

- `Authorization: Bearer <jwt>` for signed-in user routes
- `X-API-Key: <project-api-key>` for project-scoped automation
- `X-Ingest-Key: <ingest-key>` for ingest and admin automation

Public project read routes do not require auth. Private project routes require ownership.

## Health

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Service health |
| `GET` | `/health/ping` | Lightweight ping |

## Auth

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/auth/github` | Start GitHub OAuth |
| `GET` | `/auth/github/callback` | Browser OAuth callback |
| `POST` | `/auth/github/callback` | API OAuth callback |
| `GET` | `/auth/me` | Current user |
| `POST` | `/auth/logout` | Logout |

## Project Discovery

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/stats` | Public platform stats |
| `GET` | `/api/projects` | List and search public projects |
| `GET` | `/api/projects/mine` | List authenticated user's projects |
| `GET` | `/api/projects/by-program/:programId` | Find a project by Solana program ID |
| `GET` | `/api/projects/:projectId` | Get project details |
| `PUT` | `/api/projects/:projectId` | Update owned project |

## API Keys

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/projects/:projectId/keys` | List project API keys |
| `POST` | `/api/projects/:projectId/keys` | Create project API key |
| `DELETE` | `/api/projects/:projectId/keys/:keyId` | Delete project API key |
| `POST` | `/api/projects/:projectId/keys/:keyId/rotate` | Rotate project API key |

## IDL Lifecycle

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/idl/upload` | Upload a new IDL project |
| `GET` | `/api/idl/:projectId` | Get latest or selected IDL version |
| `GET` | `/api/idl/:projectId/versions` | List IDL versions |
| `PUT` | `/api/idl/:projectId` | Upload a new IDL version |
| `DELETE` | `/api/idl/:projectId` | Delete a project IDL |

Upload limits:

- IDL JSON: 10 MB
- Optional `CPI.md`: 5 MB
- `programId` must be a valid base58 Solana address (32 bytes)

### On-chain IDL check and provenance

Program IDs are first-come-first-served, so an uploaded IDL is only the uploader's claim about a program. On
`POST /api/idl/upload` and `PUT /api/idl/:projectId` Orquestra therefore looks for the program's own IDL on
Solana mainnet-beta (Program Metadata Program, then the legacy Anchor IDL account):

| On-chain result | What happens |
| --- | --- |
| IDL found | The **on-chain IDL is stored instead of the uploaded file** (`idl_source` = `anchor`/`pmp`). `warnings` says so and lists any instruction differences. |
| No IDL (or an unreadable IDL account) | The upload is accepted and stored as **`manual`**. The response `warnings` and `provenance.notice` say that *no on-chain IDL exists and this is a manual upload*. |
| RPC unreachable | `503` with `code: "ONCHAIN_IDL_CHECK_FAILED"` — nothing is stored; retry. |

A `provenance` object (`origin`, `idlSource`, `verifiedOnChain`, `notice`) is returned by the upload/update responses,
`GET /api/projects/:id`, `GET /api/projects/by-program/:programId`, `GET /api/:projectId/idl`,
`GET /api/:projectId/instructions[/:name]`, `GET /api/:projectId/docs` and the build endpoint. For manual IDLs `notice`
is non-null and `llms.txt` / `docs` / MCP tool output start with a **"Manually uploaded IDL — no on-chain IDL"** banner
(applied when served, so owner-written `custom_docs` cannot remove it). The project page shows the same notice.

Manual-IDL projects are additionally hidden from search and blocked from building by default — see *Manual-IDL projects are hidden by default (`secure`)* below.

Manual uploads made before this change (recorded as `anchor`) were relabeled once on production, only for programs that have no on-chain IDL; migration `029_idl_manual_provenance.sql` is a no-op.

### Manual-IDL projects are hidden by default (`secure`)

Projects whose latest IDL is a **manual upload** (no on-chain IDL) are treated as unverified and potentially unsafe, so they are
**excluded by default** from every discovery and action surface. Pass `secure=false` to opt in explicitly. `secure` defaults to
`true`; only an explicit `false` (`"false"`, `"0"`, `"no"`) changes it.

| Surface | Default (`secure` omitted / `true`) | With `secure=false` |
| --- | --- | --- |
| `GET /api/projects` (browse and `?search=`) | manual-IDL projects are not listed | they are listed (each carries a `provenance` notice) |
| `GET /api/projects/by-program/:programId` | `404` with `code: "MANUAL_IDL_HIDDEN"` (the project owner still sees it) | returns the project |
| `POST /api/:projectId/instructions/:name/build` | `403` with `code: "MANUAL_IDL_BLOCKED"` (the project owner may still build) | builds; the response carries `provenance` |
| `GET /sitemap` / program discovery lists | excluded | not applicable |
| MCP `search_programs`, `build_instruction`, `simulate_instruction` | hidden / blocked | allowed, with the manual-IDL warning |

`GET /api/projects?uploaded=user` returns **only** manually uploaded projects (it implies `secure=false`); the Explorer's "Uploaded by user" filter uses it.

On `GET` routes pass it as a query parameter (`?secure=false`); on the build endpoint as `?secure=false` or `"secure": false` in the
JSON body. Do this only when the user explicitly asked for that program and trusts its uploader — a manual IDL is only the
uploader's claim about what the program does, and anyone can upload one for a program ID they do not control.
Direct reads by project ID (`GET /api/projects/:id`, `/idl`, `/instructions`, `/docs`, `llms.txt`) still work and always carry the warning.

## Generated Program API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/:projectId/instructions` | List instructions |
| `GET` | `/api/:projectId/instructions/:name` | Get one instruction |
| `POST` | `/api/:projectId/instructions/:name/build` | Build unsigned transaction |
| `GET` | `/api/:projectId/pda` | List PDA schemas |
| `POST` | `/api/:projectId/pda/derive` | Derive a PDA |
| `GET` | `/api/:projectId/pda/fetch/:address` | Fetch and decode account data |
| `POST` | `/api/:projectId/program-accounts/query` | Query program accounts with dataSize and memcmp filters |
| `GET` | `/api/:projectId/accounts` | List account types |
| `GET` | `/api/:projectId/errors` | List custom errors |
| `GET` | `/api/:projectId/events` | List events |
| `GET` | `/api/:projectId/types` | List custom types |
| `GET` | `/api/:projectId/docs` | Get generated or custom docs |
| `PUT` | `/api/:projectId/docs` | Replace docs with custom Markdown |
| `DELETE` | `/api/:projectId/docs` | Reset docs to generated Markdown |
| `GET` | `/api/:projectId/idl` | Get raw project IDL |

### Build Request

```json
{
  "accounts": {
    "authority": "<pubkey>"
  },
  "args": {},
  "feePayer": "<pubkey>",
  "recentBlockhash": "<optional-blockhash>",
  "network": "mainnet-beta",
  "rpcUrl": "https://mainnet.helius-rpc.com/?api-key=...",
  "simulate": true,
  "encoding": "base64"
}
```

Notes:

- `network` supports `mainnet-beta`, `devnet`, and `testnet`.
- `rpcUrl` overrides the cluster RPC. Must be an https URL on an allowlisted RPC provider (`api.*.solana.com`, `helius-rpc.com`, `quiknode.pro`, `rpcpool.com`); anything else is rejected with 400.
- If `recentBlockhash` is omitted, the worker fetches one from the selected RPC.
- `encoding` defaults to `base58`; `base64` is recommended for modern Solana RPC usage.
- `simulate: true` runs unsigned preflight and may return decoded Anchor errors.
- `txVersion` / `txConfig` are optional — see *Transaction format* below.

### Transaction format (`txVersion`) — optional

Omit `txVersion` and nothing changes: this endpoint returns a **legacy** transaction. Opt in per request:

| `txVersion` | Format | Limits |
|---|---|---|
| *(omitted)* / `"legacy"` | legacy message (default) | 1232 bytes |
| `"v0"` | versioned message, no lookup tables | 1232 bytes |
| `"v1"` | Transaction v1 ([SIMD-0385](https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0385-transaction-v1.md)) | 4096 bytes, max 64 inline accounts, **no address lookup tables** |

For `v1`:

- `encoding` defaults to `base64`; `base58` is rejected when the transaction is over 1232 bytes.
- Compute-unit and loaded-accounts limits live in the message config, not in ComputeBudget instructions, and an unset v1 limit is
  zero on-chain. Orquestra therefore measures them with one preflight simulation (+10%), or falls back to protocol maxima; how they were
  chosen is listed in `riskReasons`. Override with `txConfig`: `{ "priorityFeeLamports": 5000, "computeUnitLimit": 20000, "loadedAccountsDataSizeLimit": 65536, "heapSize": 65536 }`
  (`priorityFeeLamports` is a **total** in lamports, not micro-lamports per CU).
- `txConfig` without `txVersion: "v1"` is rejected (never silently ignored). Invalid combinations return 400.
- The response `wireFormat` tells you what was produced. A v1 transaction starts with byte `0x81`; `@solana/web3.js` 1.x cannot decode it
  (use `@solana/kit` 8+). The signer/wallet must support v1 — check before using it.
- Operators can disable v1 without a redeploy with `TX_V1_DISABLED=1`.

### Program Account Query Request

```json
{
  "accountType": "Counter",
  "network": "mainnet-beta",
  "rpcUrl": "https://mainnet.helius-rpc.com/?api-key=...",
  "dataSize": 48,
  "memcmp": [{ "offset": 8, "bytes": "<base58-bytes>" }],
  "fieldFilters": [{ "field": "authority", "bytes": "<pubkey>" }],
  "limit": 25,
  "paginationKey": "<optional-helius-v2-cursor>",
  "changedSinceSlot": 250000000,
  "includeRaw": false
}
```

Notes:

- `accountType` auto-applies the account discriminator filter and may infer fixed account size.
- `dataSize` applies Solana's exact account data length filter.
- `memcmp` is the raw Solana byte-offset filter for advanced queries.
- `fieldFilters` require `accountType` and only work for fixed-offset IDL fields.
- Dynamic fields such as `string`, `vec`, `bytes`, and variable arrays may require explicit `dataSize` or raw `memcmp` offsets.
- Helius RPC URLs use `getProgramAccountsV2` automatically, and overload responses from legacy `getProgramAccounts` are retried with V2 pagination.
- `paginationKey` fetches the next Helius V2 page; responses include `paginationKey` when another page is available.
- Results are decoded with the IDL by default; raw base64 is included only when `includeRaw` is true or decoding is not possible.

## Known Addresses

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/:projectId/addresses` | List known addresses |
| `POST` | `/api/:projectId/addresses` | Add known address |
| `PUT` | `/api/:projectId/addresses/:addressId` | Update known address |
| `DELETE` | `/api/:projectId/addresses/:addressId` | Delete known address |

## External API Docs

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/:projectId/external-apis` | List documented external API |
| `POST` | `/api/:projectId/external-apis` | Add documented external API |
| `PUT` | `/api/:projectId/external-apis/:endpointId` | Update documented external API |
| `DELETE` | `/api/:projectId/external-apis/:endpointId` | Delete documented external API |

## Program Lists

All list routes require auth.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/lists` | List user's program lists |
| `POST` | `/api/lists` | Create list with scope key |
| `PUT` | `/api/lists/:listId` | Update list metadata |
| `DELETE` | `/api/lists/:listId` | Delete list |
| `GET` | `/api/lists/:listId/items` | List programs in list |
| `POST` | `/api/lists/default/items` | Add program to default list |
| `POST` | `/api/lists/:listId/items` | Add program to list |
| `DELETE` | `/api/lists/:listId/items/:projectId` | Remove program from list |
| `POST` | `/api/lists/:listId/scope-key` | Regenerate scope key |

## AI and Machine-Readable Docs

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/projects/:projectId/ai-analysis` | AI project analysis |
| `GET` | `/project/:projectId/llms.txt` | AI-ready Markdown docs |
| `GET` | `/openapi.json` | OpenAPI spec |
| `GET` | `/.well-known/openid-configuration` | OpenID metadata |
| `GET` | `/.well-known/oauth-authorization-server` | OAuth server metadata |
| `GET` | `/.well-known/jwks.json` | JWKS metadata |
| `GET` | `/.well-known/oauth-protected-resource` | OAuth protected resource metadata |
| `GET` | `/api/discovery/sitemap` | Public project sitemap |
| `GET`/`POST` | `/mcp` | Streamable HTTP MCP endpoint |

## Ingest and Admin

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/ingest/idl` | Ingest an IDL through automation |
| `GET` | `/api/admin/analytics` | Admin analytics |
| `POST` | `/api/admin/recategorize` | Re-run categorization |

These routes are protected by `X-Ingest-Key`.
