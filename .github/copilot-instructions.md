# Copilot Instructions — orquestra

## Project Overview

orquestra converts Solana Anchor IDLs into production-ready REST APIs. Users upload an IDL, and the platform auto-generates endpoints for every instruction, account type, and error — plus base58 transaction building and AI-ready Markdown docs.

## Architecture

**Monorepo** (`bun` workspaces) with three packages:

| Package | Stack | Runs on | Purpose |
|---------|-------|---------|---------|
| `packages/worker/` | Hono + TypeScript | Cloudflare Workers | REST API backend — auth, IDL parsing, tx building, doc generation |
| `packages/frontend/` | React 18 + Tailwind + Vite | Cloudflare Pages | SPA dashboard — project management, explorer, API key mgmt |
| `packages/shared/` | TypeScript | Shared | Canonical types (`AnchorIDL`, `User`, `Project`, etc.) and utilities |

**Infrastructure:** Cloudflare D1 (SQLite) for persistence, KV namespaces (`IDLS`, `CACHE`) for fast IDL retrieval and caching. Config in `wrangler.toml`.

## Key Patterns & Conventions

### Worker route structure
Each route file in `packages/worker/src/routes/` creates its own `new Hono<Env>()` app and is mounted in `packages/worker/src/index.ts` via `app.route()`. The `Env` type defines `Bindings` (D1, KV, secrets) and `Variables` (auth context set by middleware).

### Env/Bindings type — re-declared per file
The `Env` type with `Bindings` and `Variables` is re-declared locally in each route file rather than imported from a central location. Follow this pattern when adding new routes.

### Auth flow
- JWT (Web Crypto API, no Node.js `crypto`) via `services/jwt.ts`
- Three middleware levels in `middleware/auth.ts`: `authMiddleware` (required), `optionalAuthMiddleware` (silent pass-through), `apiKeyMiddleware` (X-API-Key header)
- Auth context is set on Hono's `c.set('userId', ...)` / `c.get('userId')`

### Shared package imports
Use `@shared/*` path alias (configured in root `tsconfig.json` paths and Vite `resolve.alias`):
```typescript
import { generateId, getCurrentTimestamp } from '@shared/utils'
import type { AnchorIDL } from '@shared/types'
```
Frontend also uses `@/` alias for its own `src/` directory.

### Services layer (`packages/worker/src/services/`)
Business logic is in pure service functions, not in route handlers:
- `idl-parser.ts` — `validateIDL()`, `parseIDL()`, `getInstruction()`, `resolveType()`
- `tx-builder.ts` — Borsh-like arg serialization, Anchor discriminator (`SHA-256("global:<name>")`), base58 transaction output
- `doc-generator.ts` — IDL → sectioned Markdown (`GeneratedDocs` with `full`, `instructions`, `accounts`, etc.)
- `jwt.ts` — JWT sign/verify using Web Crypto (Workers-compatible, no Node.js deps)

### Database
- Schema in `migrations/001_initial_schema.sql`, indexes in `migrations/002_indexes.sql`
- Tables: `users`, `projects`, `idl_versions`, `api_keys`, `project_socials`
- IDs are random strings via `generateId()` (not UUIDs)
- D1 accessed via `c.env.DB` with raw prepared statements (no ORM)

### Frontend
- React Router v6 with `<Layout />` wrapper (Outlet pattern)
- State management: Zustand
- Styling: Tailwind CSS with dark theme (`bg-dark-800`, `text-primary`, etc.)
- Dev proxy: Vite proxies `/api` → `http://localhost:8787` (worker dev server)

## Development Commands

```bash
# Install all workspace deps
bun install

# Run both frontend (5173) and worker (8787) simultaneously
bun run dev

# Run individually
bun run dev:worker    # wrangler dev on :8787
bun run dev:frontend  # vite on :5173

# Build (shared must build first)
bun run build         # shared → frontend → worker

# DB operations (uses wrangler d1)
bun run db:migrate:dev   # apply migrations to local D1
bun run db:reset         # drop all tables (dev)
bun run db:seed          # seed with test data

# Type check / lint
bun run type-check
bun run lint
```

## When Adding New Features

- **New API endpoint:** Create or extend a route file in `packages/worker/src/routes/`, declare local `Env` type, mount in `index.ts`. Put business logic in `services/`.
- **New shared type:** Add to `packages/shared/src/types.ts`, re-export via `index.ts`.
- **New frontend page:** Add component in `packages/frontend/src/pages/`, add route in `App.tsx`.
- **New DB table:** Add migration file in `migrations/`, run `bun run db:migrate:dev`.
- **Solana/crypto operations:** Must use Web Crypto API (no Node.js builtins) — Workers runtime constraint. See `jwt.ts` and `tx-builder.ts` for examples.
