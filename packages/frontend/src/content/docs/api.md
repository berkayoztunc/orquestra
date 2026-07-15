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
| **POST** | `/api/{projectId}/instructions/{instructionName}/build` | Build an unsigned base58 transaction payload. |
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

## Which integration should I use?

- **App backends** — use the REST API directly if you're wiring Orquestra into a dashboard, API layer, cron workflow, or custom signing service.
- **Agents** — use the `/mcp` endpoint when you want AI clients to discover tools, inspect instruction metadata, and build payloads conversationally.
