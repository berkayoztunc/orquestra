# IDL Sync System

Orquestra automatically syncs on-chain IDL files for every indexed Solana program.
The sync engine uses [`@solana/idl`](https://github.com/solana-foundation/idl) to
support both the new **Program Metadata Program (PMP)** format and the legacy
**Anchor** format — trying PMP first, falling back to Anchor.

---

## How it works

```
Every 6 hours (cron: 0 */6 * * *)
    │
    ├─ Read all public projects from D1, ordered by updated_at ASC
    │   (least-recently-synced programs processed first)
    │
    ├─ For each program (concurrency: 20):
    │   ├─ fetchIdlWithSource(programId, rpcUrl)   ← @solana/idl, 8 s timeout
    │   ├─ Hash IDL (SHA-256)
    │   ├─ Compare with latest stored idl_versions.idl_hash
    │   ├─ If changed → INSERT new idl_versions row + INSERT update_logs row
    │   └─ If first-ever IDL → trigger AI categorization (capped at 100/run)
    │
    ├─ Wall-clock guard at 12 min → save KV checkpoint, stop
    │   Next cron run resumes from checkpoint index
    └─ On full completion → clear checkpoint, mark run 'complete'
```

A `sync_runs` row is written at the start of every invocation and updated on
finish with final counts and `status` (`running` → `complete` | `partial`).

---

## Cloudflare Workers limits

| Plan | Cron CPU limit | Practical program capacity per run |
|---|---|---|
| Free | ~30 ms | **Not viable** for this use case |
| Paid (Workers Paid) | **15 minutes** | ~5 000–10 000 programs in one run |
| Any (with checkpoint) | 15 min × N runs | Unlimited — cycles through all programs |

If a run hits the 12-minute wall-clock guard, it saves a cursor in the `CACHE` KV
namespace under the key `sync:progress:cursor`. The next cron invocation reads this
key and continues from the saved index. The checkpoint expires after 24 hours.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SOLANA_MAINNET_RPC_URL` | Recommended | Paid RPC (Helius, QuickNode, etc.). Falls back to `SOLANA_RPC_URL`. |
| `SOLANA_RPC_URL` | Yes | Fallback RPC URL |
| `INGEST_API_KEY` | Yes | Secret for all `/api/admin/*` write routes (`X-Ingest-Key` header) |
| `AI` | Yes (binding) | Cloudflare Workers AI binding — used for auto-categorization |

> **RPC note:** At concurrency 20, a paid RPC is strongly recommended for production.
> Public RPC endpoints will rate-limit aggressively above ~5 req/s. Lower `CONCURRENCY`
> in `idl-sync.ts` to `5` if you must use a public endpoint.

---

## Admin API endpoints

All sync endpoints live under `/api/admin/sync/`. Base URL:

```
Production: https://api.orquestra.dev
Local:      http://localhost:8787
```

### GET /api/admin/sync/status

Returns the most recent sync run record. **No auth required.**

```bash
curl https://api.orquestra.dev/api/admin/sync/status
```

```bash
# Local
curl http://localhost:8787/api/admin/sync/status
```

**Response**

```json
{
  "run": {
    "id": "abc123",
    "started_at": "2026-07-07T00:00:00Z",
    "completed_at": "2026-07-07T00:08:42Z",
    "status": "complete",
    "total_checked": 3200,
    "total_programs": 3200,
    "updated_count": 12,
    "unchanged_count": 3181,
    "skipped_count": 7,
    "error_count": 0,
    "trigger": "cron"
  }
}
```

`status` values:
- `running` — sync in progress
- `complete` — all programs processed this run
- `partial` — hit the 12-min wall-clock guard; checkpoint saved for next run

`total_checked` vs `total_programs`: on a `partial` run `total_checked` will be less
than `total_programs`, showing how far through the list this run got.

---

### GET /api/admin/sync/history

Paginated log of IDL version changes detected by the sync engine. **No auth required.**

```bash
curl "https://api.orquestra.dev/api/admin/sync/history?page=1&limit=20"
```

```bash
# Local
curl "http://localhost:8787/api/admin/sync/history?page=1&limit=20"
```

| Query param | Default | Description |
|---|---|---|
| `page` | `1` | Page number (1-based) |
| `limit` | `20` | Records per page (max 100) |

**Response**

```json
{
  "updates": [
    {
      "id": "upd_xyz",
      "project_id": "proj_abc",
      "program_id": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "program_name": "Token Program",
      "project_name": "Token Program",
      "old_version": 2,
      "new_version": 3,
      "old_hash": "a1b2c3...",
      "new_hash": "d4e5f6...",
      "detected_at": "2026-07-07T00:04:11Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 847,
    "totalPages": 43
  }
}
```

---

### GET /api/admin/sync/discovery

Programs added to the registry in the last N days. Useful for auditing what the
CLI ingest or sync engine has indexed recently. **No auth required.**

```bash
curl "https://api.orquestra.dev/api/admin/sync/discovery?days=7&limit=50"
```

```bash
# Local — last 3 days, up to 20 results
curl "http://localhost:8787/api/admin/sync/discovery?days=3&limit=20"
```

| Query param | Default | Max | Description |
|---|---|---|---|
| `days` | `7` | `90` | Look-back window |
| `limit` | `50` | `200` | Max programs returned |

**Response**

```json
{
  "programs": [
    {
      "id": "proj_abc",
      "name": "Marinade Finance",
      "program_id": "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD",
      "created_at": "2026-07-06T14:22:00Z",
      "category": "staking",
      "tags": "staking,liquid-staking,sol"
    }
  ],
  "days": 7
}
```

---

### POST /api/admin/sync/trigger

Manually fire a sync run in the background. Requires `X-Ingest-Key` auth.
The endpoint returns immediately — the sync runs via `ctx.waitUntil`.

```bash
curl -X POST https://api.orquestra.dev/api/admin/sync/trigger \
  -H "X-Ingest-Key: YOUR_INGEST_API_KEY"
```

```bash
# Local
curl -X POST http://localhost:8787/api/admin/sync/trigger \
  -H "X-Ingest-Key: YOUR_INGEST_API_KEY"
```

**Response**

```json
{
  "triggered": true,
  "message": "IDL sync started in background"
}
```

**Then poll status:**

```bash
# Watch status until completed_at is set
watch -n 5 'curl -s http://localhost:8787/api/admin/sync/status | python3 -m json.tool'
```

---

### Trigger cron locally (wrangler dev)

Wrangler exposes a special endpoint to simulate a cron tick without waiting for
the actual schedule:

```bash
curl "http://localhost:8787/__scheduled?cron=0+*/6+*+*+*"
```

This calls the `scheduled()` handler directly, which runs `runDailyIdlSync(env)`.
Check the wrangler dev console for the `[idl-sync]` log output.

---

## CLI bulk ingest

The sync cron only updates **already-indexed** programs. To discover and ingest
**new** programs from the chain, use the CLI:

```bash
# 1. Scan all Solana programs (writes output/programs.csv)
bun run cli:scan

# 2. Check each program for an on-chain IDL and ingest into Orquestra
#    Requires ORQUESTRA_API_URL and ORQUESTRA_INGEST_KEY env vars
ORQUESTRA_API_URL=https://api.orquestra.dev \
ORQUESTRA_INGEST_KEY=YOUR_INGEST_API_KEY \
bun run cli:check-idl -- --enable-ingest

# 2a. Fast mode — skip IDL decode, only check PDA existence (2× faster)
bun run cli:check-idl -- --fast

# 2b. Resume an interrupted run
bun run cli:check-idl -- --enable-ingest --resume

# 2c. Skip AI description generation (saves API quota)
bun run cli:check-idl -- --enable-ingest --skip-ai

# 2d. Point at a specific program list JSON file
bun run cli:check-idl -- --enable-ingest --input-file ./my-programs.json
```

All CLI commands read from `output/` by default. Set `--out-dir` to override.

---

## Database tables

### `sync_runs`

One row per sync invocation.

| Column | Type | Description |
|---|---|---|
| `id` | TEXT | Primary key |
| `started_at` | DATETIME | When the run began |
| `completed_at` | DATETIME | When it finished (null if still running) |
| `status` | TEXT | `running` \| `complete` \| `partial` |
| `total_checked` | INTEGER | Programs processed this invocation |
| `total_programs` | INTEGER | Total public programs at run start |
| `updated_count` | INTEGER | New IDL versions written |
| `unchanged_count` | INTEGER | Programs with no IDL change |
| `skipped_count` | INTEGER | Programs with no on-chain IDL or timeout |
| `error_count` | INTEGER | RPC or DB errors |
| `trigger` | TEXT | `cron` \| `manual` |

### `update_logs`

One row per detected IDL version change.

| Column | Type | Description |
|---|---|---|
| `id` | TEXT | Primary key |
| `project_id` | TEXT | FK → `projects.id` |
| `program_id` | TEXT | Solana program address |
| `program_name` | TEXT | Program display name |
| `old_version` | INTEGER | Previous version number (null = first ever) |
| `new_version` | INTEGER | New version number |
| `old_hash` | TEXT | SHA-256 of previous IDL JSON |
| `new_hash` | TEXT | SHA-256 of new IDL JSON |
| `detected_at` | DATETIME | When the sync detected the change |

### `idl_versions`

Each row is one immutable IDL snapshot.

| Column | Type | Notes |
|---|---|---|
| `idl_source` | TEXT | `pmp` \| `anchor` — which on-chain account sourced the IDL |
| `idl_standard` | TEXT | `anchor` \| `codama` — the IDL JSON schema format |
| `idl_hash` | TEXT | SHA-256 for deduplication |
| `version` | INTEGER | Auto-incrementing per project |

---

## Migrations

Apply all pending migrations before deploying:

```bash
# Dev D1
bun run db:migrate:dev

# Production D1
bun run db:migrate
```

Relevant migrations added by this feature:

| File | What it does |
|---|---|
| `015_idl_pmp_support.sql` | Adds `idl_source` column to `idl_versions` |
| `016_sync_runs.sql` | Creates the `sync_runs` table |
| `017_sync_runs_status.sql` | Adds `status` and `total_programs` to `sync_runs` |

---

## Sync Dashboard UI

The dashboard is available at `/sync` in the frontend. It shows:

- **Latest Sync Run** — stats card with `X of Y programs checked`, updated/unchanged/skipped/error counts, duration, and trigger type
- **Recent IDL Updates** — paginated feed from `update_logs` with program name, old → new version, and timestamp
- **Programs Discovered (Last 7 Days)** — grid of recently indexed programs with category badge
- Auto-refreshes every 30 seconds

The page fetches from the three public read endpoints above (`/status`, `/history`, `/discovery`).
