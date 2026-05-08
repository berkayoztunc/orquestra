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
  "rpcUrl": "https://optional-rpc.example",
  "simulate": true,
  "encoding": "base64"
}
```

Notes:

- `network` supports `mainnet-beta`, `devnet`, and `testnet`.
- `rpcUrl` overrides the cluster RPC.
- If `recentBlockhash` is omitted, the worker fetches one from the selected RPC.
- `encoding` defaults to `base58`; `base64` is recommended for modern Solana RPC usage.
- `simulate: true` runs unsigned preflight and may return decoded Anchor errors.

### Program Account Query Request

```json
{
  "accountType": "Counter",
  "network": "mainnet-beta",
  "rpcUrl": "https://optional-rpc.example",
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
| `GET` | `/api/:projectId/external-apis` | List documented external APIs |
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
