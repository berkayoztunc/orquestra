# Orquestra

Orquestra turns Solana Anchor and Codama IDLs into hosted REST APIs, AI-ready docs, and MCP tools.

Upload an IDL once, then use Orquestra to inspect instructions, derive PDAs, decode account data, and build unsigned Solana transactions from HTTP clients or AI agents.

## Quick Start

```bash
git clone https://github.com/berkayoztunc/orquestra.git
cd orquestra
bun install
bun run db:migrate:dev
bun run dev
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:8787`
- Production API: `https://api.orquestra.dev`
- MCP endpoint: `https://api.orquestra.dev/mcp`

## Features

- IDL upload and versioning for Anchor and Codama programs
- Auto-generated REST endpoints for instructions, accounts, program account queries, errors, events, types, and docs
- Unsigned transaction builder with cluster-aware blockhash lookup
- Optional preflight simulation with decoded Anchor errors
- PDA discovery, derivation, single-account decoding, and program-owned account queries with `dataSize` and `memcmp` filters
- AI-ready `llms.txt` documentation for each public project
- Public MCP server for agent tools
- Companion Rust CLI for local IDL and API-backed workflows
- GitHub OAuth, project ownership, private projects, and project API keys
- Program lists with MCP scope keys
- Known address notes and external API documentation for richer AI context
- Cloudflare Workers, D1, and KV deployment

## MCP Tools

Orquestra exposes these tools over Streamable HTTP MCP:

- `search_programs`
- `list_instructions`
- `build_instruction`
- `simulate_instruction`
- `list_pda_accounts`
- `derive_pda`
- `read_llms_txt`
- `get_ai_analysis`
- `fetch_pda_data`
- `get_program_data`

`get_program_data` wraps Solana `getProgramAccounts` for a project program ID. It supports `accountType` discriminator filters, exact `dataSize`, raw byte-offset `memcmp`, fixed-offset IDL `fieldFilters`, decoded results, and optional raw base64 output. Helius RPC URLs use `getProgramAccountsV2` automatically and return `paginationKey` for large account sets.

Example Claude Code config:

```json
{
  "mcpServers": {
    "orquestra": {
      "type": "http",
      "url": "https://api.orquestra.dev/mcp"
    }
  }
}
```

## Development Commands

```bash
bun run dev             # frontend + worker
bun run build           # build all packages
bun run test            # worker tests
bun run type-check      # TypeScript checks
bun run lint:fix        # lint and fix
bun run db:migrate:dev  # local D1 migrations
bun run db:seed         # local seed data
bun run deploy          # production deploy
```

## Repository

- `packages/frontend` - React dashboard
- `packages/worker` - Hono API and MCP server on Cloudflare Workers
- `packages/shared` - shared TypeScript types and utilities
- `packages/cli` - on-chain program discovery utilities
- `agents` - Orquestra agent skill contracts
- `docs` - GitBook documentation

## Documentation

Start with [docs/README.md](./docs/README.md). The companion Rust CLI is documented in [docs/user-cli.md](./docs/user-cli.md).

## License

[MIT](./LICENSE)
