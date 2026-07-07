# Automated Daily Scan Pipeline

This document explains how to trigger the daily Solana program scan, what each step does, and how AI generates names and descriptions for auto-imported programs.

## How Triggering Works

The pipeline has **two trigger methods**:

### 1. Automatic — every day at 1am UTC

The workflow runs on a cron schedule defined in [.github/workflows/daily-scan.yml](.github/workflows/daily-scan.yml):

```yaml
on:
  schedule:
    - cron: '0 1 * * *'   # 1am UTC daily
```

No action required — GitHub runs it automatically once secrets are set.

### 2. Manual — from GitHub UI

Go to: **GitHub repo → Actions → Daily Solana Program Scan → Run workflow**

You can optionally limit the number of programs scanned (useful for testing):

| Input | Default | Description |
|---|---|---|
| `max_programs` | *(empty = all)* | Cap how many programs the RPC scan fetches |

---

## Required GitHub Secrets

Set these in: **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Where to get it | What it does |
|---|---|---|
| `SOLANA_RPC_URL` | Helius / QuickNode / any paid RPC | Used by `cli:scan` to call `getProgramAccounts` on-chain |
| `ORQUESTRA_API_URL` | `https://api.orquestra.dev` | Base URL for the ingest API |
| `ORQUESTRA_INGEST_KEY` | Orquestra Worker `INGEST_API_KEY` secret | Authenticates the queue and metadata write requests |

> **Important:** Public RPC endpoints (e.g. `api.mainnet-beta.solana.com`) will rate-limit or reject `getProgramAccounts` because it returns 500K+ accounts. A paid RPC (Helius, QuickNode, Triton) is required for reliable daily scans.

---

## Full Pipeline Flow

```
1am UTC — GitHub Actions starts
│
├── cli:scan  (runs on GitHub runner, 7GB RAM)
│     └── RPC getProgramAccounts on BPFLoaderUpgradeable
│     └── Writes output/programs.csv  (~500K rows)
│     └── Saves .program-list.json for next step
│
├── cli:queue  (reads programs.csv)
│     └── Validates each program ID (32–44 base58 chars)
│     └── Batches 500 IDs per HTTP request
│     └── POST /api/ingest/candidates → D1 program_candidates table
│           status = 'pending'
│
├── Report metadata
│     └── POST /api/ingest/scan-metadata
│           { programs_found, queued, skipped, scanned_at }
│           Stored in KV — shown on Sync dashboard
│
└── Upload programs.csv as GitHub artifact (7-day retention)

───────────────────────────────────────────────────────────────
2am UTC — Cloudflare Workers cron fires (runCandidatesBurst)
│
├── Reads up to 2000 'pending' rows from program_candidates
│
├── For each program:
│     ├── fetchIdlWithSource(programId, rpcUrl)
│     │     ├── Try PMP (@solana/idl) first
│     │     └── Fallback: Anchor IDL account derivation
│     │
│     ├── IDL found? → Auto-import (see AI section below)
│     └── No IDL?    → status = 'no_idl', recheck_after = +30 days
│
└── Log to sync_runs table

Every 6h — Cloudflare Workers cron (runDailyIdlSync)
│
├── Phase 1: Sync existing registered projects (update changed IDLs)
└── Phase 2: Process up to 500 more pending candidates
```

---

## How AI Generates Names and Descriptions

When a new program is discovered with a valid on-chain IDL, the auto-import process calls Cloudflare Workers AI **once** to generate three things simultaneously:

### What is sent to AI

```
Program name: my_lending_protocol
Instructions: deposit, withdraw, liquidate, initialize, setBorrowRate
Account types: MarketState, UserPosition, CollateralVault
```

### What AI returns (single JSON call)

```json
{
  "category": "lending",
  "display_name": "My Lending Protocol",
  "short_description": "A lending protocol that allows users to deposit collateral and borrow assets with configurable rates.",
  "tags": ["lending", "borrow", "liquidation", "collateral"],
  "aliases": ["mlp"]
}
```

### Fields explained

| Field | Used for | Fallback if AI fails |
|---|---|---|
| `display_name` | `projects.name` — what users see in the dashboard | Title-cased IDL name (`my_prog` → `My Prog`) |
| `short_description` | `projects.description` — shown on project cards | Empty string |
| `category` | `program_categories` table — enables filtered search | `"other"` |
| `tags` | Search keywords | `[]` |
| `aliases` | Alternative names (e.g. `"ray"` for Raydium) | `[]` |

### AI model used

`@cf/meta/llama-3.1-8b-instruct` via Cloudflare Workers AI — fast, cheap, runs in the same Worker process with no external HTTP call.

### AI quota

- Max **300 AI calls per cron run** (controlled by `MAX_AI_PER_RUN` constant)
- If a program is imported beyond that cap, it gets a title-cased name and no description — AI enrichment can be run later via the `/api/admin/recategorize` endpoint

---

## No-IDL Recheck (30-day window)

Programs found without an on-chain IDL are **not** permanently ignored. They are marked `no_idl` with a `recheck_after` timestamp set to a random day within the next 30 days.

When `recheck_after` passes, the program is automatically reset to `pending` and rechecked on the next cron run. This handles programs that add IDLs after initial deployment (common for protocols that ship IDLs as part of their public launch).

```
Day 0:  scan discovers program A → no IDL → no_idl, recheck_after = Day 23
Day 23: cron picks up program A → IDL now exists → auto-imports with AI name/desc
```

---

## Monitoring

| Where | What you see |
|---|---|
| **Sync dashboard** (`/sync`) | "Last Full Scan" card — programs found, queued, timestamp |
| **Sync dashboard** (`/sync`) | "Discovery Queue" card — total / pending / has_idl / no_idl counts |
| **GitHub Actions** | Run logs with per-step output and `programs.csv` artifact |
| **Cloudflare dashboard** | Cron trigger invocation history and Worker logs |

---

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Workflow not running | Secrets not set | Add `SOLANA_RPC_URL`, `ORQUESTRA_API_URL`, `ORQUESTRA_INGEST_KEY` in repo settings |
| `cli:scan` fails | RPC rate limiting | Use a paid RPC endpoint (Helius recommended) |
| Queued count is 0 | `programs.csv` not found | Check that `cli:scan` completed successfully first |
| AI names look wrong | AI hallucination or timeout | Run `/api/admin/recategorize` to retroactively fix uncategorized projects |
| Dashboard shows no scan data | No run has completed yet | Trigger manually from GitHub Actions UI |
