# Frontend Package

React, TypeScript, Vite, and Tailwind dashboard for Orquestra.

## Features

- Home, explorer, API, MCP, CLI, pricing, analytics, and dashboard pages
- GitHub OAuth flow
- IDL upload and project management
- Instruction explorer and transaction build UI
- PDA explorer and account data viewer
- API key management
- Known addresses and external API docs panels
- Program lists and MCP scope keys

## Development

```bash
bun --cwd packages/frontend run dev
```

The frontend runs on `http://localhost:5173`.

## Build

```bash
bun --cwd packages/frontend run build
```

The production output is written to `packages/frontend/dist`.

See [../../docs/dashboard.md](../../docs/dashboard.md) for user-facing dashboard documentation.
