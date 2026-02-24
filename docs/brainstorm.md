# orquestra — Brainstorm

> **One-liner:** Upload a Solana IDL → get a ready-to-use API that builds, serializes, and documents every instruction for humans and AI agents alike.

---

## 1. What is orquestra?

An open-source platform where **any Solana developer** (program authors & frontend integrators) can:

1. Upload an Anchor IDL (`.json`) for their on-chain program.
2. Instantly get a live REST API that builds transactions for every instruction in that IDL.
3. Receive base58-serialized transactions ready for frontend wallet signing.
4. Get auto-generated **plain Markdown documentation** optimized for LLMs / AI agents.
5. Optionally attach a `CPI.md` file for cross-program-invocation context and richer docs.
6. Manage everything from a dashboard authenticated via **GitHub OAuth**.

**Free & open-source.** No paywalls. The entire Solana ecosystem benefits.

---

## 2. Core Features

### 2.1 IDL Upload & Parsing
- Accept Anchor IDL JSON (v0.29+ and legacy formats).
- Parse: program ID, instructions, accounts (with `isMut`, `isSigner`, `pda` seeds), types, events, errors.
- Validate IDL structure on upload; return clear errors if malformed.
- Support versioned IDL updates (keep history per program).
- **Stretch:** Accept raw `.so` + IDL from on-chain fetch via `anchor idl fetch <program-id>`.

### 2.2 Auto-Generated REST API
For each instruction in the IDL, generate endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /api/{project}/instructions` | List all instructions with their accounts & args |
| `GET /api/{project}/instructions/{name}` | Detail for one instruction |
| `POST /api/{project}/instructions/{name}/build` | Build & return base58 serialized tx |
| `GET /api/{project}/accounts` | List all account types |
| `GET /api/{project}/errors` | List all custom program errors |
| `GET /api/{project}/events` | List all events |
| `GET /api/{project}/docs` | Full markdown documentation |
| `GET /api/{project}/idl` | Raw IDL JSON |

#### Transaction Builder (`/build`)
- **Input:** JSON body with `accounts` map, `args` map, `feePayer`, optional `recentBlockhash`.
- **Processing:**
  - Resolve PDAs from seeds defined in IDL automatically (user only provides seed values).
  - Construct the instruction with proper account metas.
  - Build a `VersionedTransaction` (v0) or legacy tx.
  - If no `recentBlockhash` provided, fetch latest from configured RPC.
  - Serialize to **base58** string.
- **Output:** `{ transaction: "<base58>", message: "<human-readable summary>" }`
- Frontend just signs with wallet adapter and sends.

### 2.3 LLM-Ready Markdown Generation
Auto-generate plain Markdown docs from IDL:
- Program overview (name, address, description from CPI.md if available).
- For each instruction:
  - What it does (inferred from name + CPI.md context).
  - Required accounts table (name, type, writable?, signer?, PDA derivation).
  - Arguments table (name, type, description).
  - Example JSON body for the `/build` endpoint.
- Error code reference table.
- Event reference table.
- CPI context (from uploaded CPI.md) merged inline.

This Markdown can be fed directly into ChatGPT, Claude, or any LLM to understand the program.

### 2.4 CPI.md Upload
- Optional file that provides human-written context:
  - What the program does (high-level).
  - Instruction descriptions and usage notes.
  - Cross-program invocation details.
  - Security considerations.
- Parsed and merged into auto-generated docs to enrich them.
- Supports standard Markdown format.

### 2.5 User Dashboard (GitHub Auth)
- **Auth:** GitHub OAuth (fits developer audience perfectly).
- **Dashboard features:**
  - Upload / update / delete IDL files.
  - Upload / edit CPI.md.
  - Set project visibility: **public** or **private** (API key required for private).
  - Add project metadata: name, description, logo, website, socials (X/Twitter, Discord, Telegram, GitHub repo).
  - View API usage stats (requests, unique users).
  - Copy API endpoint URLs / curl examples.
  - Manage API keys for private projects.
  - View version history of IDL uploads.

### 2.6 Public Discovery
- Public project listing / directory page.
- Search by program name or program ID.
- Each public project gets a clean landing page with:
  - Program info + socials.
  - Interactive API explorer (try instructions in-browser).
  - Markdown docs viewer.
  - Copy-paste code snippets (JS/TS, Python, curl).

---

## 3. Architecture

```
┌─────────────────────────────────────────────────┐
│                Cloudflare Pages                  │
│            React SPA (Frontend)                  │
│   Dashboard · Explorer · Docs Viewer · Landing   │
└──────────────────┬──────────────────────────────┘
                   │ HTTPS
┌──────────────────▼──────────────────────────────┐
│           Cloudflare Workers                     │
│              Hono API                            │
│                                                  │
│  /auth/*       → GitHub OAuth flow               │
│  /api/:proj/*  → IDL-driven endpoints            │
│  /dashboard/*  → User management                 │
└──┬──────────┬───────────┬───────────────────────┘
   │          │           │
   ▼          ▼           ▼
 D1 DB    KV Store    R2 Bucket
 (users,   (cache,     (IDL files,
 projects, sessions)   CPI.md,
 metadata)             assets)
```

### Tech Stack
| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Tailwind CSS |
| Backend | Hono (on Cloudflare Workers) |
| Database | Cloudflare D1 (SQLite) |
| Cache/Sessions | Cloudflare KV |
| File Storage | Cloudflare R2 |
| Auth | GitHub OAuth 2.0 |
| Solana SDK | `@solana/web3.js` v2 or `@solana/kit` |
| IDL Parsing | Custom parser (Anchor IDL spec) |
| Hosting | Cloudflare Pages + Workers |
| CI/CD | GitHub Actions |

### Data Model (D1)

**users**
- id, github_id, github_username, avatar_url, created_at, updated_at

**projects**
- id, user_id, slug, name, description, program_id, is_public, logo_url, website, created_at, updated_at

**project_socials**
- id, project_id, platform (twitter/discord/telegram/github), url

**idl_versions**
- id, project_id, version, r2_key, uploaded_at

**api_keys**
- id, project_id, key_hash, name, created_at, last_used_at

---

## 4. User Flows

### Flow 1: Program Developer Publishes IDL
1. Sign in with GitHub.
2. Create new project → enter program name, program ID.
3. Upload IDL JSON file.
4. (Optional) Upload CPI.md.
5. (Optional) Add socials, logo, description.
6. Set visibility (public/private).
7. Get API base URL: `https://orquestra.dev/api/{slug}/`.
8. Share URL with frontend devs / community.

### Flow 2: Frontend Dev Uses the API
1. Browse public projects or get URL from program dev.
2. Read auto-generated docs (Markdown or in-browser explorer).
3. Call `POST /api/{slug}/instructions/{name}/build` with accounts + args.
4. Receive base58 serialized transaction.
5. Sign with wallet adapter → send to Solana RPC.

### Flow 3: AI Agent Consumes Program
1. Fetch `GET /api/{slug}/docs` → full Markdown.
2. LLM reads and understands instructions, accounts, args.
3. LLM constructs proper JSON body.
4. Calls `/build` endpoint → gets serialized tx → presents to user for signing.

---

## 5. Ideas to Explore



### 5.7 Analytics Dashboard
- Track API usage per instruction.
- Show which instructions are most called.


### 5.9 On-Chain IDL Fetch
- Instead of uploading, just provide program ID.
- Fetch IDL from on-chain IDL account (if Anchor program with published IDL).

### 5.10 Rate Limiting & Fair Use
- Even though free, implement rate limiting per IP / API key.
- Cloudflare Workers has built-in rate limiting support.

---

## 6. Name & Branding

- **orquestra** — symbolic name meaning orchestration of complex interactions.
- Domain: `orquestra.dev` (production domain).
- Tagline ideas:
  - "Upload IDL. Get API. Ship faster."
  - "Solana programs, instantly accessible."
  - "From IDL to API in seconds."
  - "The API layer for Solana programs."

---

## 7. Open Questions

## 8. MVP Scope (v0.1)

**Must have:**
1. GitHub OAuth login.
2. Upload IDL JSON → parse and store.
3. Auto-generate REST endpoints for instructions.
4. Transaction builder → base58 serialized output.
5. Auto-generated Markdown docs.
6. Public / private visibility toggle.
7. Basic project profile (name, description, program ID).

**Nice to have (v0.2):**
8. CPI.md upload and merge.
9. Socials and branding.
10. Interactive API playground.
11. API key management for private projects.
12. CLI upload tool.

**Future (v0.3+):**
13. Code generation (TS/Python snippets).
14. On-chain IDL fetch.
15. Transaction simulation.
16. Analytics dashboard.
17. Multi-program composition.

---

## 9. Competitive Landscape

| Tool | What it does | orquestra differentiator |
|---|---|---|
| Anchor TS Client | Generated client from IDL | orquestra is language-agnostic REST API, no SDK needed |
| Solana FM / Explorer | View program info | orquestra is an API-first tool, not just a viewer |
| Shyft API | Solana API service | Paid, not IDL-focused, not community-driven |
| Helius DAS API | Solana data API | Focused on data, not instruction building |
| Poseidon | TS to Solana programs | Different direction (writing programs, not consuming) |

**orquestra's edge:** Upload an IDL → get a full API + docs + LLM-ready output. No other tool does this end-to-end, for free, self-serve.

---

*Generated: Feb 19, 2026*
