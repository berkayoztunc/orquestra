# Architecture

Orquestra is a Bun monorepo with a Cloudflare backend and a React frontend.

## Packages

| Path | Purpose |
| --- | --- |
| `packages/frontend` | React dashboard built with Vite and Tailwind |
| `packages/worker` | Hono API, MCP server, auth, docs, and Cloudflare bindings |
| `packages/shared` | Shared TypeScript types and helpers |
| `packages/cli` | Local discovery utilities for scanning programs and IDLs |
| `agents` | Agent skill contracts for Orquestra MCP workflows |
| `docs` | GitBook documentation |

## Backend

The worker uses:

- Hono for routing
- Cloudflare Workers for runtime
- Cloudflare D1 for relational data
- Cloudflare KV for IDL and docs cache
- Cloudflare AI for optional categorization and analysis
- Web Crypto APIs for JWT handling
- Streamable HTTP MCP transport for `/mcp`

## Frontend

The dashboard uses:

- React 18
- TypeScript
- Vite
- Tailwind CSS
- Zustand stores
- GitHub OAuth session state

## Core Flow

1. A user uploads an IDL from the dashboard or ingest endpoint.
2. The worker validates and parses the IDL.
3. The project and IDL version are stored in D1.
4. The latest IDL and generated docs are cached in KV.
5. Public project data becomes available through REST, `llms.txt`, OpenAPI, and MCP.
6. Agents or clients inspect instructions, derive PDAs, fetch account data, simulate calls, or build unsigned transactions.

## Supported IDL Formats

- Anchor IDL
- Codama IDL

Both formats support instruction inspection and PDA derivation. Account decoding depends on recognizable account discriminators and type definitions in the IDL.
