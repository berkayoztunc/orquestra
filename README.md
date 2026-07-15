<p align="center">
  <img src="packages/frontend/assets/brand/orquestra-v07/logo.png" alt="Orquestra" width="120" />
</p>

<h1 align="center">Orquestra</h1>

<p align="center">
  Turns Solana Anchor and Codama IDLs into a hosted API, AI-ready docs, and MCP tools.
</p>

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

## Add the MCP Server

Orquestra exposes `search_programs`, `list_instructions`, `build_instruction`, `simulate_instruction`, `simulate_transaction`, `list_pda_accounts`, `derive_pda`, `read_llms_txt`, `get_ai_analysis`, `fetch_pda_data`, and `get_program_data` over Streamable HTTP MCP at `https://api.orquestra.dev/mcp`. Full tool reference: [docs/mcp-tools.md](./docs/mcp-tools.md) · [live docs](https://orquestra.dev/docs/mcp).

**Claude Code** — fastest via CLI:

```bash
claude mcp add --transport http orquestra https://api.orquestra.dev/mcp
```

**Claude Desktop / Cursor / VS Code** — add to your MCP config file:

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

## Install Agent Skills

The `agents` directory defines Orquestra skill contracts for agentic Solana workflows: `orquestra-researcher` → `orquestra-pda-explorer` → `orquestra-tx-builder` → `orquestra-simulator` → `orquestra-signer`. Orquestra MCP builds and simulates; signing always happens in the signer skill after explicit user approval.

Install into the current project:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/berkayoztunc/orquestra/main/install-skills.sh)
```

Install globally for all projects:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/berkayoztunc/orquestra/main/install-skills.sh) --global
```

The installer writes agent files under `.claude/agents/`. Full skill contracts and MCP config: [docs/agent-skills.md](./docs/agent-skills.md).

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
