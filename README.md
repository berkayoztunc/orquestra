<div align="center">
  <img src="packages/frontend/assets/logo.png" alt="orquestra logo" width="200"/>

  # orquestra

  **Transform Solana Anchor IDLs into Production-Ready REST APIs**

  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
  [![Solana](https://img.shields.io/badge/Solana-Anchor-9945FF)](https://anchor-lang.com)
  [![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020)](https://workers.cloudflare.com/)

</div>

---

**orquestra** is a free, open-source platform that converts Solana Anchor IDLs into REST APIs. Upload your IDL and get auto-generated endpoints for every instruction, account type, and error — with transaction building and AI-ready documentation included.

## Quick Start

```bash
git clone https://github.com/berkayoztunc/orquestra.git
cd orquestra
bun install
bun run db:migrate:dev
bun run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:8787

## Development

```bash
bun run dev             # start frontend + backend
bun run build           # build all packages
bun run deploy          # deploy to Cloudflare
bun run db:migrate:dev  # apply tracked D1 migrations locally
bun run db:seed         # seed test data
bun run type-check      # TypeScript check
bun run lint:fix        # lint & fix
```

## API Overview

Public API base:

- Local: `http://localhost:8787`
- Production: `https://api.orquestra.dev`

Core service and auth:

```text
GET  /health
GET  /health/ping

GET  /auth/github
GET  /auth/github/callback
POST /auth/github/callback
GET  /auth/me
POST /auth/logout
```

Project discovery and management:

```text
GET /api/projects
GET /api/projects/mine
GET /api/projects/by-program/:programId
GET /api/projects/:projectId
PUT /api/projects/:projectId

GET    /api/projects/:projectId/keys
POST   /api/projects/:projectId/keys
DELETE /api/projects/:projectId/keys/:keyId
POST   /api/projects/:projectId/keys/:keyId/rotate
```

IDL lifecycle:

```text
POST   /api/idl/upload
GET    /api/idl/:projectId
GET    /api/idl/:projectId/versions
PUT    /api/idl/:projectId
DELETE /api/idl/:projectId
```

Generated program API:

```text
GET  /api/:projectId/instructions
GET  /api/:projectId/instructions/:name
POST /api/:projectId/instructions/:name/build

GET  /api/:projectId/pda
POST /api/:projectId/pda/derive
GET  /api/:projectId/pda/fetch/:address

GET /api/:projectId/accounts
GET /api/:projectId/errors
GET /api/:projectId/events
GET /api/:projectId/types
GET /api/:projectId/docs
PUT /api/:projectId/docs
DELETE /api/:projectId/docs
GET /api/:projectId/addresses
POST /api/:projectId/addresses
PUT /api/:projectId/addresses/:addressId
DELETE /api/:projectId/addresses/:addressId
GET /api/:projectId/idl
```

AI, discovery, and machine-readable surfaces:

```text
GET /api/projects/:projectId/ai-analysis
GET /project/:projectId/llms.txt
GET /openapi.json
GET /.well-known/openid-configuration
GET /.well-known/oauth-authorization-server
GET /.well-known/jwks.json
GET /.well-known/oauth-protected-resource
GET /api/discovery/sitemap
GET /mcp
POST /mcp
```

Internal automation endpoints:

```text
POST /api/ingest/idl
POST /api/admin/recategorize
```

`/api/ingest/*` and `/api/admin/*` are protected with `X-Ingest-Key`. User-facing project management endpoints use JWT auth, and generated program build flows can use either JWT or `X-API-Key` depending on the operation.

**Auth via JWT:**
```bash
curl -H "Authorization: Bearer <token>" https://api.orquestra.dev/api/my-project/instructions
```

**Auth via API key:**
```bash
curl -H "X-API-Key: <key>" https://api.orquestra.dev/api/my-project/instructions/initialize/build \
  -d '{"args": {"amount": 1000000}, "accounts": {"authority": "..."}}'
```

**Build an instruction with network-aware simulation:**
```bash
curl -X POST https://api.orquestra.dev/api/<projectId>/instructions/<instruction>/build \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <key>" \
  -d '{
    "accounts": {
      "authority": "<pubkey>",
      "vault": "<pubkey>"
    },
    "args": {
      "amount": 1000000
    },
    "feePayer": "<pubkey>",
    "network": "mainnet-beta",
    "simulate": true
  }'
```

## CLI

> The CLI is a separate companion tool: [orquestra-cli](https://github.com/berkayoztunc/orquestra-cli)

The Rust CLI has two modes:

- API mode: use your Orquestra project and API key.
- Local IDL mode: point the CLI at a local Anchor IDL JSON file and run fully offline.

Quick setup examples:

```bash
# API mode
orquestra config set \
  --project-id <program-or-project-id> \
  --api-key <api-key> \
  --rpc https://api.mainnet-beta.solana.com \
  --keypair ~/.config/solana/id.json

# Local IDL mode
orquestra config set \
  --idl ./target/idl/my_program.json \
  --rpc https://api.mainnet-beta.solana.com \
  --keypair ~/.config/solana/id.json

orquestra config show
```

Core commands:

```bash
orquestra                              # interactive top-level menu
orquestra list
orquestra run [INSTRUCTION]            # supports --arg key=value --account name=pubkey --yes
orquestra pda [ACCOUNT]                # supports --seed name=value
orquestra sign <BASE58_TX>
orquestra simulate [BASE58_TX]
orquestra tx [SIGNATURE]
orquestra search [QUERY]
orquestra idl fetch [PROGRAM_ID] [-o output.json]
orquestra config set [--project-id] [--api-key] [--rpc] [--keypair] [--api-base] [--idl]
orquestra config show
orquestra config reset                  # interactively update config values
orquestra --version
orquestra --help
```

Typical workflows:

```bash
# List instructions for the configured project or local IDL
orquestra list

# Run a specific instruction with pre-filled values
orquestra run deposit \
  --arg amount=1000000 \
  --account authority=<pubkey> \
  --account vault=<pubkey> \
  --yes

# Derive a PDA directly
orquestra pda vault --seed owner=<pubkey>

# Search programs and set one as active
orquestra search marginfi

# Inspect a confirmed transaction
orquestra tx <signature>
```

The CLI will auto-fill signer accounts from your configured keypair, auto-derive resolvable PDAs, and print the unsigned base58 transaction when no keypair is configured.

This repo also includes tools for discovering on-chain programs:

```bash
bun run cli:scan      -- --rpc-url 'https://api.mainnet-beta.solana.com' --out-dir ./output
bun run cli:check-idl -- --rpc-url 'https://api.mainnet-beta.solana.com' --out-dir ./output
bun run cli:full      -- --rpc-url 'https://api.mainnet-beta.solana.com' --out-dir ./output
```

## Stack

- **Frontend:** React 18, Vite, Tailwind CSS, Zustand
- **Backend:** Hono, Cloudflare Workers, D1, KV
- **Auth:** GitHub OAuth, JWT (Web Crypto API)
- **Tooling:** Bun, Wrangler, TypeScript

## Contributing

1. Fork & clone the repo
2. `git checkout -b feature/my-feature`
3. Make changes, run `bun run type-check` and `bun run lint:fix`
4. Open a pull request

See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

## Contributors

<a href="https://github.com/berkayoztunc/orquestra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=berkayoztunc/orquestra" />
</a>

## License

[MIT](LICENSE)
