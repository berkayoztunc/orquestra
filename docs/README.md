# Orquestra Documentation

Orquestra is an IDL-to-API platform for Solana programs. It accepts Anchor and Codama IDLs, generates REST endpoints and Markdown documentation, and exposes MCP tools that AI agents can use to discover programs, derive PDAs, decode account data, simulate instructions, and build unsigned transactions.

## What Orquestra Provides

- Hosted REST API for every uploaded public IDL
- Streamable HTTP MCP server for AI agents
- GitHub-authenticated dashboard
- Project API keys for automation
- IDL versioning and generated documentation
- PDA derivation and decoded on-chain account data
- Transaction building with optional simulation
- Public program search and AI analysis
- Program lists with scope keys for constrained MCP search
- Known addresses and external API notes for richer docs
- On-chain discovery CLI utilities
- Companion Rust CLI for interactive local and API-backed program calls

## Documentation Map

- [Getting Started](./getting-started.md)
- [Architecture](./architecture.md)
- [Dashboard](./dashboard.md)
- [API Reference](./api-reference.md)
- [MCP Tools](./mcp-tools.md)
- [Agent Skills](./agent-skills.md)
- [User CLI](./user-cli.md)
- [CLI Discovery Tools](./cli-discovery.md)
- [Deployment](./deployment.md)
- [Data Model](./data-model.md)

## Base URLs

- Production frontend: `https://orquestra.dev`
- Production API: `https://api.orquestra.dev`
- Local frontend: `http://localhost:5173`
- Local API: `http://localhost:8787`
- MCP endpoint: `https://api.orquestra.dev/mcp`
