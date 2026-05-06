# Getting Started

## Run Locally

```bash
git clone https://github.com/berkayoztunc/orquestra.git
cd orquestra
bun install
bun run db:migrate:dev
bun run dev
```

Local services:

- Frontend: `http://localhost:5173`
- Worker API: `http://localhost:8787`

## Common Commands

```bash
bun run dev
bun run build
bun run test
bun run type-check
bun run lint:fix
bun run db:migrate:dev
bun run db:seed
```

## Upload a Program IDL

1. Sign in with GitHub.
2. Open the dashboard.
3. Upload an Anchor or Codama IDL JSON file.
4. Provide the program name, Solana program ID, description, and visibility.
5. Optionally include `CPI.md` content for extra integration context.

After upload, Orquestra creates:

- A project record
- IDL version 1
- Generated docs
- REST routes for the program
- Search metadata
- AI categorization when Cloudflare AI is available

## Use the Generated API

List instructions:

```bash
curl https://api.orquestra.dev/api/<projectId>/instructions
```

Build an unsigned transaction:

```bash
curl -X POST https://api.orquestra.dev/api/<projectId>/instructions/<instruction>/build \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <project-api-key>" \
  -d '{
    "accounts": {
      "authority": "<pubkey>"
    },
    "args": {},
    "feePayer": "<pubkey>",
    "network": "mainnet-beta",
    "simulate": true,
    "encoding": "base64"
  }'
```

## Connect MCP

Use the hosted MCP endpoint:

```text
https://api.orquestra.dev/mcp
```

Claude Code example:

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
