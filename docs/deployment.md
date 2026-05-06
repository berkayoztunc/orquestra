# Deployment

Orquestra deploys the backend to Cloudflare Workers and the frontend to Cloudflare Pages.

## Build

```bash
bun run build
```

This builds:

- `packages/shared`
- `packages/frontend`
- `packages/worker`

## Deploy Everything

```bash
bun run deploy
```

This runs the build, deploys the worker with Wrangler, and deploys the frontend output to Cloudflare Pages.

## Deploy Worker Only

```bash
bun run deploy:worker
```

## Deploy Frontend Only

```bash
bun run deploy:pages
```

## Database

Local migrations:

```bash
bun run db:migrate:dev
```

Remote migrations:

```bash
bun run db:migrate
```

Local seed:

```bash
bun run db:seed
```

## Required Bindings

The worker expects:

- `DB` - Cloudflare D1 database
- `IDLS` - KV namespace for IDL cache
- `CACHE` - KV namespace for docs and response cache

## Required Environment Variables

- `GITHUB_OAUTH_ID`
- `GITHUB_OAUTH_SECRET`
- `JWT_SECRET`
- `SOLANA_RPC_URL`
- `FRONTEND_URL`
- `API_BASE_URL`
- `CORS_ORIGIN`
- `INGEST_API_KEY`

Optional Solana RPC variables:

- `SOLANA_MAINNET_RPC_URL`
- `SOLANA_DEVNET_RPC_URL`
- `SOLANA_TESTNET_RPC_URL`

## Runtime Notes

- `/mcp` bypasses Hono CORS middleware and is handled directly by the Streamable HTTP transport.
- `/api/*` routes use request logging and API rate limiting.
- Upload and build routes have route-specific rate limits.
- Public docs and IDLs are cached in KV.
