# orquestra - Visual Architecture Guide

## System Overview Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         END USERS                                    │
│                  (Web Browser, Mobile, CLI)                          │
└────────────────────────┬────────────────────────────────────────────┘
                         │
        ┌────────────────┴────────────────┐
        │                                 │
   ┌────▼──────────────┐      ┌──────────▼─────────┐
   │  FRONTEND LAYER   │      │   API LAYER        │
   │  (React SPA)      │      │   (Hono Workers)   │
   │                   │      │                    │
   │  - Dashboard      │      │  - Endpoints       │
   │  - Explorer       │      │  - IDL Parsing     │
   │  - Auth UI        │      │  - TX Building     │
   └────┬──────────────┘      └──────────┬─────────┘
        │                                 │
        │ HTTPS                           │ HTTPS
        │                                 │
┌───────▼─────────────────────────────────▼───────────────────────────┐
│                    CLOUDFLARE EDGE NETWORK                           │
│  ┌──────────────────┐              ┌───────────────────────┐        │
│  │  Pages           │              │  Workers              │        │
│  │  (Static + SSR)  │              │  (API Runtime)        │        │
│  └──────────────────┘              └──────────┬────────────┘        │
│                                               │                    │
│  ┌──────────────────────────────────────────▼────────────────┐     │
│  │  Cloudflare Infrastructure                                │     │
│  │  ┌───────┐  ┌────┐  ┌───────┐  ┌──────┐  ┌──────────┐   │     │
│  │  │  KV   │  │ D1 │  │Cache  │  │Durable │  │Queues  │   │     │
│  │  │Store  │  │SQL │  │Layer  │  │Objects│  │(future)│   │     │
│  │  └───────┘  └────┘  └───────┘  └──────┘  └──────────┘   │     │
│  └────────────────────────────────────────────────────────────┘     │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
                 ┌──────────┴──────────┐
                 │                     │
            ┌────▼────────┐      ┌─────▼─────┐
            │   Solana    │      │  GitHub   │
            │   Networks  │      │   OAuth   │
            │  (RPC)      │      │  (Auth)   │
            └─────────────┘      └───────────┘
```

## Data Flow Diagrams

### 1. Authentication Flow

```
User                    Frontend              Backend              GitHub
  │                        │                    │                    │
  │──Click "Login"────────→│                    │                    │
  │                        │──Redirect──────────│                    │
  │                        │                    │──OAuth URL─────────→│
  │←─────Redirect URL──────│←────────────────────────GitHub Auth────│
  │                        │                    │                    │
  │──OAuth Code───────────→│                    │                    │
  │                        │──POST callback────→│                    │
  │                        │                    │──Exchange token────→│
  │                        │                    │←───User Data───────│
  │                        │←───JWT Token───────│                    │
  │←───JWT Token──────────│                    │                    │
  │                        │                    │                    │
  └─Store JWT in localStorage──────────────────────────────────────│
```

### 2. IDL Upload Flow

```
User              Frontend              Worker              D1          KV
  │                  │                   │                  │          │
  │──Select File────→│                   │                  │          │
  │                  │──Validate Size───→│                  │          │
  │                  │←──OK──────────────│                  │          │
  │                  │                   │                  │          │
  │──Upload File────→│──POST /idl────────│                  │          │
  │                  │                   │──Validate IDL───→│          │
  │                  │                   │←──OK──────────────│          │
  │                  │                   │                  │          │
  │                  │                   │──INSERT────────→│          │
  │                  │                   │←──ID────────────│          │
  │                  │                   │──CACHE IT─────→│          │
  │                  │                   │←──OK───────────→│          │
  │                  │←─Project ID────────│                  │          │
  │←─Redirect────────│                   │                  │          │
```

### 3. Transaction Building Flow

```
User              Frontend              Worker              Solana       Database
  │                  │                   │                   │           │
  │──Input Data─────→│                   │                   │           │
  │                  │──POST /build──────→│                   │           │
  │                  │                   │──GET IDL──────────────────────→│
  │                  │                   │←──IDL────────────────────────│
  │                  │                   │                   │           │
  │                  │                   │──Validate Input──→│           │
  │                  │                   │←──OK──────────────│           │
  │                  │                   │                   │           │
  │                  │                   │──Derive PDAs──────│           │
  │                  │                   │──Build Instruction│           │
  │                  │                   │──Get BlockHash────→│           │
  │                  │                   │←──Hash─────────────│           │
  │                  │                   │                   │           │
  │                  │                   │──Serialize to Base58           │
  │                  │←──TX Base58────────│                   │           │
  │←──TX + Metadata─│                   │                   │           │
  │                  │                   │                   │           │
  └──Sign with Wallet──→Send to Network──→Process on Chain──→│           │
```

## Component Hierarchy

```
App
├── Layout
│   ├── Header
│   │   ├── Logo
│   │   └── Navigation
│   ├── <Outlet> (Pages)
│   │   ├── Home
│   │   │   ├── Hero
│   │   │   └── Features
│   │   ├── Dashboard
│   │   │   ├── ProjectList
│   │   │   ├── UploadForm
│   │   │   └── ApiSettings
│   │   └── Explorer
│   │       ├── ProjectList
│   │       ├── InstructionList
│   │       └── CodeSnippets
│   └── Footer
│       ├── Links
│       └── Copyright
```

## API Endpoint Structure

```
/health
├── GET / ───────────── Health check
└── GET /ping ─────────── Ping

/auth
├── GET /github ─────────── Start OAuth
├── POST /github/callback ─ OAuth callback
└── POST /logout ──────────- Logout

/api/idl
├── POST /upload ──────────── Upload IDL
├── GET /:projectId ────────── Get IDL
├── PUT /:projectId ────────── Update IDL
└── DELETE /:projectId ─────── Delete IDL

/api/:projectId
├── GET /instructions ─────── List all
├── GET /instructions/:name ─ Get one
├── POST /instructions/:name/build Build TX
├── GET /accounts ────────── Account types
├── GET /errors ──────────── Error codes
├── GET /events ──────────── Events
├── GET /docs ──────────── Markdown docs
└── GET /idl ──────────── Raw IDL JSON
```

## Database Schema Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         USERS                               │
├─────────────────────────────────────────────────────────────┤
│ id (PK) │ github_id │ username │ email │ avatar_url │ ...  │
└────────────┬────────────────────────────────────────────────┘
             │
             │ 1:N
             │
┌────────────▼────────────────────────────────────────────────┐
│                       PROJECTS                              │
├─────────────────────────────────────────────────────────────┤
│ id (PK) │ user_id (FK) │ name │ program_id │ is_public │ ...│
└────────────┬────────────────────────────────────────────────┘
             │
             ├─ 1:N ─→ IDL_VERSIONS
             │         └─ idl_json, cpi_md, version
             │
             ├─ 1:N ─→ API_KEYS
             │         └─ key, last_used, expires_at
             │
             └─ 1:1 ─→ PROJECT_SOCIALS
                       └─ twitter, discord, github, website
```

## Deployment Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    GitHub Repository                      │
│  ┌────────────────────────────────────────────────────┐  │
│  │  - Source Code (Frontend, Worker, Shared)          │  │
│  │  - Database Migrations                             │  │
│  │  - CI/CD Pipelines (.github/workflows/)            │  │
│  └────────────────────────────────────────────────────┘  │
└──────┬───────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│                 GitHub Actions CI/CD                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Lint & Type  │  │ Build & Test │  │  Deploy      │   │
│  │    Check     │  │              │  │              │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
└──────┬───────────────────────────────────────────────────┘
       │
       ├─────────────────────┬─────────────────────┐
       │                     │                     │
       ▼                     ▼                     ▼
┌────────────────┐  ┌─────────────────┐  ┌─────────────┐
│ Cloudflare     │  │ Cloudflare      │  │ Cloudflare  │
│ Pages          │  │ Workers         │  │ D1 Database │
│ (Frontend)     │  │ (Backend API)   │  │ + KV Cache  │
└────────────────┘  └─────────────────┘  └─────────────┘
```

## Development Environment Setup

```
Your Computer
│
├── Node.js v18+
│   ├── npm (Package Manager)
│   └── typescript
│
├── Vite Dev Server (Frontend)
│   └── http://localhost:5173
│       └── Hot Module Reloading
│
├── Wrangler Dev Server (Backend)
│   └── http://localhost:8787
│       └── Workers Emulation
│
├── D1 (Database)
│   └── Wrangler SQLite
│
└── Environment Variables (.env.local)
    ├── CLOUDFLARE_API_TOKEN
    ├── GITHUB_OAUTH_ID/SECRET
    └── JWT_SECRET
```

## Monorepo Structure

```
orquestra/
│
├── Root Configuration
│   ├── package.json (npm workspaces)
│   ├── tsconfig.json (project references)
│   └── wrangler.toml (cloudflare config)
│
├── packages/
│   ├── frontend/ ─────── React SPA
│   │   └── Distributes to Cloudflare Pages
│   │
│   ├── worker/ ────────── Hono API
│   │   └── Runs on Cloudflare Workers
│   │
│   └── shared/ ────────── Types & Utils
│       └── Imported by both frontend & worker
│
├── migrations/ ────────── D1 SQL Scripts
│
├── scripts/ ──────────── Build Utilities
│
└── .github/workflows/ ── CI/CD Pipelines
    ├── ci-cd.yml
    └── database.yml
```

## Request Lifecycle

```
User Request
    │
    ▼
Cloudflare Edge Network
    │
    ├─→ Static Assets? → Pages (Cached)
    │
    ├─→ API Request? → Workers Handler
    │   │
    │   ├→ CORS Check ✓
    │   │
    │   ├→ Auth Middleware
    │   │   └─ JWT Validation
    │   │
    │   ├→ Route Handler
    │   │   ├─ Validate Input (Zod)
    │   │   ├─ Query Database (D1)
    │   │   ├─ Check Cache (KV)
    │   │   └─ Process Business Logic
    │   │
    │   └→ Format Response (JSON)
    │
    ▼
Return Response to User
```

## Technology Stack Summary

```
Presentation Layer (Frontend)
├── React 18
├── TypeScript
├── Tailwind CSS
├── React Router
└── Zustand (State)
         │
         │ HTTPS
         ▼
Business Logic Layer (Backend)
├── Hono Framework
├── TypeScript
├── Zod (Validation)
└── Solana Web3.js
         │
         │ SQL
         ▼
Data Layer
├── Cloudflare D1 (SQL Database)
├── Cloudflare KV (Cache)
└── Solana RPC (Blockchain)
```

## Error Handling Flow

```
Request
    │
    ▼
Validation Layer
    │
    ├─ Invalid? → 400 Bad Request
    │
    ▼
Authentication Layer
    │
    ├─ Unauthorized? → 401 Unauthorized
    │
    ▼
Authorization Layer
    │
    ├─ Forbidden? → 403 Forbidden
    │
    ▼
Business Logic
    │
    ├─ Server Error? → 500 Internal Server Error
    │
    ▼
Response (Success 200-299)
```

---

## Key Takeaways

1. **Monorepo** - Shared types between frontend and backend
2. **Edge First** - Code runs at Cloudflare edge globally
3. **Serverless** - No servers to manage, auto-scaling
4. **Database** - D1 provides SQL at the edge
5. **Caching** - KV provides global caching
6. **Type Safe** - TypeScript throughout the entire stack

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed documentation.
