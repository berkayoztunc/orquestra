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

### Caller-supplied RPC URL allowlist

`/mcp`, `/flow/mcp`, and several REST routes accept an `rpcUrl` (or a URL-valued
`network`) from the caller without authentication. Those values are checked
against the allowlist in `packages/worker/src/utils/solana-rpc.ts`; the RPC URLs
configured above are trusted and never checked.

- `RPC_ALLOWLIST_ENFORCE` — plaintext var in `wrangler.toml`, set to `'1'` in all
  environments, so a non-allowlisted caller URL is rejected with 400. It lives in
  `[vars]` rather than in a secret so the current enforcement posture is visible
  in code review. Any other value downgrades to log-only: the rejected hostname is
  logged and the request is allowed through, which is the mode to use if you ever
  need to audit real traffic before tightening the list.
- `SOLANA_RPC_ALLOWLIST_EXTRA` — optional secret, comma-separated extra
  allowlisted RPC hostnames. Unset by default. Lets an operator add a provider
  without a redeploy if a legitimate caller turns out to be blocked.

If a legitimate integration breaks after deploy, the symptom is a 400 with code
`RPC_URL_NOT_ALLOWED` naming the rejected host. Fix by adding that host to
`SOLANA_RPC_ALLOWLIST` in `packages/worker/src/utils/solana-rpc.ts`, or as an
immediate unblock, `wrangler secret put SOLANA_RPC_ALLOWLIST_EXTRA`.

## Runtime Notes

- `/mcp` bypasses Hono CORS middleware and is handled directly by the Streamable HTTP transport.
- `/api/*` routes use request logging and API rate limiting.
- Upload and build routes have route-specific rate limits.
- Public docs and IDLs are cached in KV.
