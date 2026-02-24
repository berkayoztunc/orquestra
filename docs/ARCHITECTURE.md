# ARCHITECTURE.md

## System Architecture

base58fun is built on a modern, scalable architecture leveraging Cloudflare's edge network.

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     End Users                               │
└─────────────────┬───────────────────────────────────────────┘
                  │
        ┌─────────┴──────────┐
        │                    │
   ┌────▼─────────┐   ┌──────▼──────────┐
   │   Frontend   │   │   API Explorer  │
   │ (React SPA)  │   │   & Dashboard   │
   └──────┬────┬──┘   └────────┬────────┘
          │    │               │
          │    └────┬──────────┘
          │         │
    ┌─────▼─────────▼────────────────────┐
    │  Cloudflare Pages & Workers        │
    │  ───────────────────────────────── │
    │  ┌──────────────────────────────┐  │
    │  │  Frontend Distribution       │  │
    │  │  (Static assets + SSR)       │  │
    │  └──────────────────────────────┘  │
    │  ┌──────────────────────────────┐  │
    │  │  Hono API Backend            │  │
    │  │  - Auth (GitHub OAuth)       │  │
    │  │  - IDL Management            │  │
    │  │  - Transaction Building      │  │
    │  │  - Documentation Generation  │  │
    │  └──────────────────────────────┘  │
    └──────┬──────────┬──────────────────┘
           │          │
    ┌──────▼──────────▼──────────────┐
    │   Cloudflare Infrastructure    │
    │   ──────────────────────────── │
    │  D1 │ KV │ Cache │ HTTP2 Push  │
    └──────┬──────────┬──────────────┘
           │          │
    ┌──────▼──────────▼───────────────┐
    │  Solana Blockchain              │
    │  - RPC Endpoints                │
    │  - Network Interactions         │
    └─────────────────────────────────┘
```

## Component Architecture

### 1. Frontend (React)

**Location:** `packages/frontend/`

- **Technology Stack:** React 18 + TypeScript + Tailwind CSS + Vite
- **Build Target:** Cloudflare Pages (static + dynamic assets)
- **Key Features:**
  - User authentication via GitHub OAuth
  - IDL upload & project management
  - API key management
  - Usage analytics dashboard
  - Interactive API explorer

**Directory Structure:**
```
frontend/
├── src/
│   ├── components/     # React components (Header, Layout, etc.)
│   ├── pages/         # Page components (Home, Dashboard, Explorer)
│   ├── hooks/         # Custom React hooks
│   ├── store/         # Zustand state management
│   ├── api/           # API client utilities
│   ├── types/         # TypeScript type definitions
│   ├── utils/         # Helper functions
│   ├── App.tsx        # Root component
│   └── main.tsx       # Entry point
├── index.html         # HTML template
├── vite.config.ts     # Vite configuration
└── tailwind.config.js # Tailwind CSS config
```

### 2. Worker Backend (Hono)

**Location:** `packages/worker/`

- **Technology Stack:** Hono + TypeScript + Cloudflare Workers
- **Runtime:** Cloudflare Workers (Edge Runtime)
- **Key Features:**
  - RESTful API endpoints
  - IDL parsing and validation
  - Transaction building engine
  - Markdown documentation generation
  - GitHub OAuth integration

**Directory Structure:**
```
worker/
├── src/
│   ├── routes/        # API routes (idl, auth, api, health)
│   ├── middleware/    # Custom middleware (auth, validation)
│   ├── services/      # Business logic (IDL parser, tx builder)
│   ├── utils/         # Utility functions (validation, crypto)
│   ├── types/         # TypeScript type definitions
│   └── index.ts       # Hono app setup
├── wrangler.toml      # Worker configuration
└── tsconfig.json      # TypeScript config
```

### 3. Shared Package

**Location:** `packages/shared/`

- **Purpose:** Centralized type definitions and utilities across frontend and backend
- **Contents:**
  - TypeScript interfaces for entities (User, Project, IDL, etc.)
  - Validation utilities
  - String manipulation helpers
  - Constants and magic numbers

## Data Flow

### 1. Authentication Flow

```
User → GitHub OAuth → Worker Auth Handler → JWT Token → Frontend Storage
```

**Steps:**
1. User clicks "Sign in with GitHub"
2. Redirects to GitHub OAuth authorization page
3. GitHub redirects to `/auth/github/callback` with code
4. Worker exchanges code for access token
5. Worker fetches user data from GitHub API
6. Creates/updates user in D1 database
7. Returns JWT token
8. Frontend stores token in localStorage
9. Frontend includes token in Authorization header

### 2. IDL Upload Flow

```
User → Select File → Frontend Upload → Worker Validate → D1 Store → KV Cache
```

**Steps:**
1. User uploads IDL JSON file via dashboard
2. Frontend validates file format and size
3. Sends to `/api/idl/upload` endpoint
4. Worker validates IDL structure
5. Stores in D1 `idl_versions` table
6. Caches in KV for fast retrieval
7. Generates Markdown documentation
8. Returns project ID and API endpoints

### 3. Transaction Building Flow

```
User → Input Data → POST /build → Parse Inputs → Build Instruction → Serialize
```

**Steps:**
1. User provides instruction name, accounts, and arguments
2. Sends POST request to `/api/{projectId}/instructions/{name}/build`
3. Worker:
   - Validates request data against IDL schema
   - Merges default values
   - Derives PDAs if needed
   - Constructs Solana instruction
   - Builds transaction
   - Fetches recent blockhash (if needed)
   - Serializes to base58 format
4. Returns serialized transaction + metadata

## Database Schema

### D1 Tables

**users**
- Stores authenticated users
- Linked by: projects, api_keys, project_socials

**projects**
- Stores user projects and programs
- Linked by: idl_versions, api_keys, project_socials

**idl_versions**
- Tracks IDL versions for each project
- Enables version history and rollback

**api_keys**
- Stores API credentials for private projects
- Rate limiting and usage tracking

**project_socials**
- Stores project metadata and social links
- One-to-one relationship with projects

### KV Namespaces

**IDLS** - IDL Cache
- Key: `idl:{projectId}:{version}`
- Value: Parsed and validated IDL JSON
- TTL: 1 week (auto-expire)

**CACHE** - General Cache
- Key: `cache:{type}:{id}`
- Value: Cached responses or computed data
- TTL: Variable per use case

## Security Model

### Authentication & Authorization

```
Request → CORS Check → Auth Middleware → JWT Verify → Routes → Response
```

**Layers:**
1. **CORS** - Restrict browser requests to allowed origins
2. **JWT** - Verify request has valid token
3. **Database Check** - Verify user exists and is active
4. **Entity Ownership** - Verify user owns requested resource
5. **Rate Limiting** - Limit requests per IP/user

### Data Protection

- **In Transit:** HTTPS/TLS (automatic with Cloudflare)
- **At Rest:** D1 encryption (Cloudflare managed)
- **Sensitive Data:** Never return secrets or API keys in responses
- **KV Access:** Restricted to worker environment

## API Endpoint Organization

### Health & Status
- `/health` - Health check endpoint

### Authentication
- `/auth/github` - GitHub OAuth initiation
- `/auth/github/callback` - OAuth callback handler
- `/auth/logout` - Session termination

### IDL Management
- `POST /api/idl/upload` - Upload new IDL
- `GET /api/idl/{projectId}` - Retrieve IDL
- `PUT /api/idl/{projectId}` - Update IDL
- `DELETE /api/idl/{projectId}` - Delete IDL

### Public API
- `GET /api/{projectId}/instructions` - List instructions
- `GET /api/{projectId}/instructions/{name}` - Instruction details
- `POST /api/{projectId}/instructions/{name}/build` - Build transaction
- `GET /api/{projectId}/accounts` - Account types
- `GET /api/{projectId}/errors` - Error codes
- `GET /api/{projectId}/events` - Events
- `GET /api/{projectId}/docs` - Markdown docs
- `GET /api/{projectId}/idl` - Raw IDL

## Performance Optimizations

### Caching Strategy

1. **KV Cache** - IDL and documentation cached in KV
2. **HTTP Cache** - Static assets cached for 1 year (immutable)
3. **Browser Cache** - Common resources (JS, CSS) cached
4. **Database Query Cache** - Frequently accessed data cached

### Edge Optimization

- **Cloudflare Workers** - Code runs at edge
- **Distributed Cache** - D1 database replicated globally
- **Image Optimization** - Cloudflare Image Resize for avatars

### Load Reduction

- **Code Splitting** - Vite splits JS bundles
- **Asset Compression** - gzip/brotli automatic
- **Lazy Loading** - Pages and components loaded on demand

## Scalability Considerations

### Horizontal Scaling

- **Workers** - Automatically scales across Cloudflare
- **D1** - Distributed database scales with usage
- **KV** - Global key-value store, distributed

### Rate Limiting

- Per IP per endpoint
- Per API key (for private projects)
- Per user account

### Database Constraints

- D1 row size limits (1MB per row)
- Query complexity limits
- Storage limits per account

## Development Workflow

### Local Development

1. Start frontend dev server (Vite): `npm run dev:frontend`
2. Start worker dev server (Wrangler): `npm run dev:worker`
3. Frontend proxies API calls to worker via configured proxy

### Building & Deployment

1. Run type checking and linting
2. Build all packages
3. Deploy worker to Cloudflare
4. Deploy frontend to Cloudflare Pages

### CI/CD Pipeline

- GitHub Actions runs on every push
- Automated tests and linting
- Auto-deploy to dev environment on `develop` branch
- Auto-deploy to production on `main` branch
