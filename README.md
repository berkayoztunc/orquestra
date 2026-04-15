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
bun run db:migrate:dev  # apply migrations
bun run db:seed         # seed test data
bun run type-check      # TypeScript check
bun run lint:fix        # lint & fix
```

## API Overview

```
GET  /health

GET  /auth/github
POST /auth/github/callback

POST   /api/idl/upload
GET    /api/idl/:projectId
PUT    /api/idl/:projectId
DELETE /api/idl/:projectId

GET  /api/:projectId/instructions
GET  /api/:projectId/instructions/:name
POST /api/:projectId/instructions/:name/build
GET  /api/:projectId/accounts
GET  /api/:projectId/accounts/:name
GET  /api/:projectId/errors
GET  /api/:projectId/types
GET  /api/:projectId/docs
GET  /api/:projectId/idl
```

**Auth via JWT:**
```bash
curl -H "Authorization: Bearer <token>" https://api.orquestra.dev/api/my-project/instructions
```

**Auth via API key:**
```bash
curl -H "X-API-Key: <key>" https://api.orquestra.dev/api/my-project/instructions/initialize/build \
  -d '{"args": {"amount": 1000000}, "accounts": {"authority": "..."}}'
```

## CLI

> The CLI is a separate companion tool: [orquestra-cli](https://github.com/berkayoztunc/orquestra-cli)

Install and use it to interact with your orquestra projects from the terminal:

```bash
# Install
orquestra                              # interactive top-level menu
orquestra list
orquestra run [INSTRUCTION]
orquestra pda [ACCOUNT]
orquestra config set [--project-id] [--api-key] [--rpc] [--keypair] [--api-base] [--idl]
orquestra config show
orquestra config reset                  # interactively update config values
orquestra --version
orquestra --help
```

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
