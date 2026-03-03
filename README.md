<div align="center">
  <img src="packages/frontend/assets/logo.png" alt="orquestra logo" width="200"/>
  
  # orquestra
  
  **Transform Solana Anchor IDLs into Production-Ready REST APIs**
  
  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
  [![Solana](https://img.shields.io/badge/Solana-Anchor-9945FF)](https://anchor-lang.com)
  [![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020)](https://workers.cloudflare.com/)
  
  [Features](#-features) • [Quick Start](#-quick-start) • [Documentation](#-documentation) • [API](#-api-reference) • [Contributing](#-contributing)
  
</div>

---

## 📖 Overview

**orquestra** is a free, open-source platform that instantly converts Solana Anchor IDLs into production-ready REST APIs. Upload your IDL and get auto-generated endpoints for every instruction, account type, and error — complete with transaction building and AI-optimized documentation.

Perfect for:
- 🛠️ **Solana developers** building dApps who need quick API integration
- 🤖 **AI agents** that need structured, documented APIs to interact with Solana programs  
- 🔗 **Backend integrators** who want to abstract away Web3 complexity
- 📱 **Mobile/Web apps** that need RESTful interfaces to blockchain programs

### Why orquestra?

| Problem | Solution |
|---------|----------|
| Complex Solana program integration | Auto-generated REST endpoints from IDL |
| Manual transaction serialization | Built-in base58 transaction builder |
| Poor documentation for AI agents | AI-optimized Markdown docs with full type info |
| Scattered program metadata | Centralized project management & explorer |
| Access control complexity | Simple API key authentication |

## ✨ Features

<table>
<tr>
<td width="50%">

### 🚀 Core Features
- **Smart IDL Parsing** - Anchor v0.29+ & legacy format support
- **Auto-Generated APIs** - REST endpoints for all instructions/accounts
- **Transaction Building** - Base58-encoded transactions ready for signing
- **AI-Ready Docs** - Structured Markdown optimized for LLMs
- **Type Resolution** - Full support for nested types, generics, and CPIs

</td>
<td width="50%">

### 🔐 Developer Experience  
- **GitHub OAuth** - Secure authentication for developers
- **Dashboard** - Manage projects, versions, and API keys
- **Public Explorer** - Browse and test any public project
- **API Keys** - Fine-grained access control for private projects
- **Real-time Updates** - Instant API regeneration on IDL updates

</td>
</tr>
</table>

## 🏗️ Architecture

orquestra is built as a modern monorepo using **Bun workspaces** and **Cloudflare's edge infrastructure**:

```
orquestra/
├── packages/
│   ├── frontend/          # React 18 + Tailwind CSS (Cloudflare Pages)
│   ├── worker/            # Hono REST API (Cloudflare Workers)
│   ├── cli/               # CLI tools for on-chain program discovery
│   └── shared/            # Shared TypeScript types & utilities
├── migrations/            # D1 (SQLite) database schema
├── scripts/               # Setup, seeding, and deployment scripts
└── .github/workflows/     # CI/CD with GitHub Actions
```

**Tech Stack:**
- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Zustand
- **Backend:** Hono, TypeScript, Cloudflare Workers, D1, KV
- **Infrastructure:** Cloudflare Pages, Workers, D1, KV Namespaces
- **Database:** SQLite (D1) with KV caching layer

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ or **Bun** 1.0+
- **Cloudflare account** (free tier works)
- **GitHub account** (for OAuth)

### Installation

```bash
# Clone the repository
git clone https://github.com/berkayozrunc/orquestra.git
cd orquestra

# Quick start with setup script
./scripts/quick-start.sh

# Or manual setup
bun install
bun run db:migrate:dev
bun run dev
```

**Access the app:**
- 🎨 Frontend: http://localhost:5173
- ⚡ API: http://localhost:8787
- 📊 API Docs: http://localhost:8787/health

### Development Workflow

```bash
# Start development servers (frontend + backend)
bun run dev

# Start individually
bun run dev:frontend    # React app on :5173
bun run dev:worker      # Hono API on :8787

# Database operations
bun run db:migrate:dev  # Apply migrations
bun run db:seed         # Seed test data
bun run db:reset        # Reset database

# Code quality
bun run type-check      # TypeScript validation
bun run lint            # ESLint check
bun run lint:fix        # Auto-fix issues
bun run format          # Prettier formatting

# Production build & deploy
bun run build           # Build all packages
bun run deploy          # Deploy to Cloudflare
```

> 📚 **Detailed Setup:** See [SETUP_INSTRUCTIONS.md](./docs/SETUP_INSTRUCTIONS.md) for complete setup guide including environment variables and Cloudflare configuration.

## � CLI Tools

orquestra includes a powerful CLI for discovering and analyzing Solana programs on-chain:

```bash
# Scan all programs on mainnet
bun run cli:scan -- --rpc-url 'https://api.mainnet-beta.solana.com' --out-dir ./output

# Check which programs have on-chain Anchor IDL
bun run cli:check-idl -- --rpc-url 'https://api.mainnet-beta.solana.com' --out-dir ./output

# Run both commands in sequence
bun run cli:full -- --rpc-url 'https://api.mainnet-beta.solana.com' --out-dir ./output
```

**Outputs:**
- `programs.csv` - List of all executable programs (program_id, loader)
- `program_idl_status.csv` - IDL availability status (program_id, has_onchain_idl, idl_account, error)

**Key Features:**
- 🔍 Discovers all programs using BPFLoaderUpgradeable, legacy v2, and v1 loaders
- 📊 Detects Anchor IDL using both old (<0.30) and new (≥0.30) derivation methods  
- 💾 Resume support with automatic checkpointing
- ⚡ Rate-limiting and retry logic for public/premium RPCs
- 📈 Real-time progress tracking and batch processing

> 📚 **Full CLI Documentation:** See [CLI_TOOL.md](./docs/CLI_TOOL.md) for complete usage, examples, and troubleshooting.

## �📡 API Reference

### Core Endpoints

#### Health & Status
```
GET  /health              # System health check
GET  /health/ping         # Simple ping endpoint
```

#### Authentication
```
GET  /auth/github                    # Initiate GitHub OAuth flow
POST /auth/github/callback           # Handle OAuth callback
POST /auth/logout                    # User logout
```

#### Project & IDL Management  
```
POST   /api/idl/upload               # Upload new IDL
GET    /api/idl/:projectId           # Retrieve IDL
PUT    /api/idl/:projectId           # Update IDL version
DELETE /api/idl/:projectId           # Delete project
```

#### Generated API Endpoints (per project)
```
GET  /api/:projectId/instructions              # List all instructions
GET  /api/:projectId/instructions/:name        # Get instruction details
POST /api/:projectId/instructions/:name/build  # Build transaction
GET  /api/:projectId/accounts                  # List account types
GET  /api/:projectId/accounts/:name            # Get account schema
GET  /api/:projectId/errors                    # List error codes
GET  /api/:projectId/events                    # List program events
GET  /api/:projectId/types                     # List custom types
GET  /api/:projectId/docs                      # AI-ready Markdown docs
GET  /api/:projectId/docs/:section             # Get specific doc section
GET  /api/:projectId/idl                       # Raw IDL JSON
```

### Authentication Methods

**JWT (User Sessions):**
```bash
curl -H "Authorization: Bearer <jwt_token>" \
  https://api.orquestra.dev/api/my-project/instructions
```

**API Keys (Programmatic Access):**
```bash
curl -H "X-API-Key: <api_key>" \
  https://api.orquestra.dev/api/my-project/instructions/initialize/build \
  -d '{"args": {...}, "accounts": {...}}'
```

> 📖 **Full API Documentation:** Interactive API docs available at `/api/:projectId/docs`

## 🎯 Usage Example

### 1. Upload an IDL

```bash
curl -X POST https://api.orquestra.dev/api/idl/upload \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-program",
    "programId": "11111111111111111111111111111111",
    "idl": { ... }
  }'
```

### 2. Build a Transaction

```bash
curl -X POST https://api.orquestra.dev/api/my-program/instructions/initialize/build \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "args": {
      "amount": 1000000
    },
    "accounts": {
      "authority": "YourWalletPublicKey...",
      "systemProgram": "11111111111111111111111111111111"
    }
  }'
```

**Response:**
```json
{
  "transaction": "base58_encoded_transaction_string",
  "accounts": [...],
  "instructionData": "base58_encoded_instruction_data"
}
```

### 3. Get AI-Ready Documentation

```bash
curl https://api.orquestra.dev/api/my-program/docs
```

Returns structured Markdown with:
- 📝 All instructions with arguments and accounts
- 🗂️ Account schemas with field descriptions  
- ⚠️ Error codes and meanings
- 📊 Custom types and enums
- 🔗 Cross-Program Invocation (CPI) docs

## 🗄️ Database Schema

orquestra uses **Cloudflare D1** (SQLite) with the following core tables:

| Table | Purpose |
|-------|---------|
| `users` | GitHub-authenticated user accounts |
| `projects` | IDL projects with metadata |
| `idl_versions` | IDL version history with CPI docs |
| `api_keys` | Authentication keys for API access |
| `project_socials` | Social links (Twitter, Discord, etc.) |

**Key relationships:**
- Users → Projects (1:many)
- Projects → IDL Versions (1:many)  
- Projects → API Keys (1:many)
- Projects → Socials (1:1)

Database migrations are in [`/migrations`](./migrations/) directory.

## 🛠️ Development

### Project Structure

```
packages/worker/src/
├── index.ts              # Hono app entry point
├── middleware/           # Auth, caching, rate limiting
├── routes/               # API route handlers
└── services/             # Business logic
    ├── idl-parser.ts     # IDL validation & parsing
    ├── tx-builder.ts     # Transaction serialization
    ├── doc-generator.ts  # Markdown documentation
    ├── pda.ts            # Program Derived Address utils
    └── jwt.ts            # JWT signing/verification

packages/frontend/src/
├── App.tsx               # React root with routing
├── pages/                # Page components
├── components/           # Reusable UI components
├── store/                # Zustand state management
└── api/                  # API client (Axios)

packages/shared/src/
├── types.ts              # TypeScript interfaces
└── utils.ts              # Shared utilities
```

### Environment Variables

Create `.env.local` in the root directory:

```bash
# Cloudflare
CLOUDFLARE_API_TOKEN=your_cloudflare_token
CLOUDFLARE_ACCOUNT_ID=your_account_id

# GitHub OAuth
GITHUB_OAUTH_ID=your_github_oauth_id
GITHUB_OAUTH_SECRET=your_github_oauth_secret

# Security
JWT_SECRET=random_secret_key_here

# Solana
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

See [`.env.example`](.env.example) for all available options.

## 🚢 Deployment

### Automated Deployment (Recommended)

The project includes GitHub Actions workflows for automated deployment:

1. **Push to `main` branch** → auto-deploy to production
2. **Database migrations** → run automatically before deployment
3. **Build validation** → TypeScript + ESLint checks

### Manual Deployment

#### Deploy Everything
```bash
bun run deploy
```

#### Deploy Worker (API)
```bash
bun run deploy:worker

# Set secrets
wrangler secret put GITHUB_OAUTH_SECRET
wrangler secret put JWT_SECRET
```

#### Deploy Frontend (Pages)
```bash
bun run deploy:pages
```

#### Database Migrations (Production)
```bash
wrangler d1 execute orquestra-prod \
  --file ./migrations/001_initial_schema.sql --remote
  
wrangler d1 execute orquestra-prod \
  --file ./migrations/002_indexes.sql --remote
```

> 📖 **Full Deployment Guide:** See [DEPLOYMENT.md](./docs/DEPLOYMENT.md) for detailed production deployment instructions.

## 🔄 CI/CD Pipeline

Automated workflows with **GitHub Actions**:

| Workflow | Trigger | Actions |
|----------|---------|---------|
| **CI** | Pull Request | Lint, type-check, test, build |
| **Deploy** | Push to `main` | Build & deploy to CF Workers + Pages |
| **Database** | Manual trigger | Run migrations on production D1 |
| **Copilot Agent** | `copilot-task` label | AI-powered code generation |

### CI/CD Features

- ✅ **Automated Testing** - Unit & integration tests
- ✅ **Type Safety** - TypeScript strict mode compilation
- ✅ **Code Quality** - ESLint + Prettier enforcement
- ✅ **Security Scanning** - Dependency vulnerability checks
- ✅ **Preview Deployments** - PR preview environments
- 🤖 **Copilot Agent** - Auto-generate code from issues

### Using Copilot Agent

Add the `copilot-task` label to any issue to trigger automated implementation:

```markdown
## Issue: Add rate limiting to API endpoints

### Requirements
- Implement rate limiting middleware
- 100 requests per minute per IP
- Return 429 status when exceeded

### Labels: copilot-task
```

Copilot Agent will:
1. Analyze the requirements
2. Generate implementation code
3. Create tests and documentation
4. Submit a pull request for review

## 📦 Tech Stack

<details>
<summary><b>Frontend Stack</b></summary>

- **React 18** - Modern UI library with concurrent features
- **TypeScript** - Type-safe JavaScript
- **Vite** - Lightning-fast build tool
- **Tailwind CSS** - Utility-first CSS framework
- **React Router v6** - Client-side routing
- **Zustand** - Lightweight state management
- **Axios** - HTTP client with interceptors
- **Solana Web3.js** - Blockchain interaction

</details>

<details>
<summary><b>Backend Stack</b></summary>

- **Hono** - Ultra-fast web framework for edge
- **TypeScript** - Type-safe development
- **Cloudflare Workers** - Serverless edge runtime
- **Cloudflare D1** - SQLite at the edge
- **Cloudflare KV** - Low-latency key-value storage
- **Zod** - Runtime type validation
- **Web Crypto API** - JWT signing (no Node.js deps)

</details>

<details>
<summary><b>DevOps & Tools</b></summary>

- **Bun** - Fast package manager & runtime
- **Wrangler** - Cloudflare deployment CLI
- **GitHub Actions** - CI/CD automation
- **ESLint** - Code linting
- **Prettier** - Code formatting
- **Docker** - Containerization (optional)

</details>

## 🔒 Security

orquestra implements multiple security layers:

- **🔐 Authentication**
  - GitHub OAuth 2.0 for user authentication
  - JWT tokens with secure signing (Web Crypto API)
  - API keys with scoped permissions
  
- **🛡️ API Protection**
  - Rate limiting per IP/user
  - CORS with allowlist configuration
  - Input validation using Zod schemas
  - SQL injection prevention (parameterized queries)
  
- **🔑 Secret Management**
  - Environment-based configuration
  - Cloudflare Workers secrets for sensitive data
  - No secrets in code or version control

- **📊 Monitoring**
  - Request logging and analytics
  - Error tracking and alerting
  - Performance monitoring

> 🚨 **Security Issues:** Please report security vulnerabilities via GitHub Security Advisories or email security@orquestra.dev (do not create public issues).

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [SETUP_INSTRUCTIONS.md](./docs/SETUP_INSTRUCTIONS.md) | Complete setup guide with troubleshooting |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | System design and technical decisions |
| [DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Production deployment guide |
| [CONTRIBUTING.md](./docs/CONTRIBUTING.md) | Contribution guidelines |
| [ROADMAP.md](./docs/ROADMAP.md) | Feature roadmap and future plans |
| [API Reference](./docs/API.md) | Full API documentation |

## 🤝 Contributing

We welcome contributions! Here's how to get started:

### Quick Contribution Guide

1. **Fork & Clone**
   ```bash
   git clone https://github.com/berkayozrunc/orquestra.git
   cd orquestra
   ```

2. **Create Feature Branch**
   ```bash
   git checkout -b feature/amazing-feature
   ```

3. **Make Changes**
   - Write code following our style guide
   - Add tests for new features
   - Update documentation as needed
   - Ensure all tests pass: `bun run test`
   - Check types: `bun run type-check`
   - Lint code: `bun run lint:fix`

4. **Commit & Push**
   ```bash
   git add .
   git commit -m "feat: add amazing feature"
   git push origin feature/amazing-feature
   ```

5. **Open Pull Request**
   - Use the PR template
   - Link related issues
   - Wait for review

### Contribution Areas

We're especially interested in:
- 🐛 **Bug fixes** - Help us squash bugs
- ✨ **New features** - Enhance the platform
- 📖 **Documentation** - Improve docs and examples
- 🧪 **Tests** - Increase test coverage
- 🎨 **UI/UX** - Better user experience
- 🌍 **Translations** - Internationalization support

### Development Guidelines

- Follow TypeScript best practices
- Write meaningful commit messages (Conventional Commits)
- Keep PRs focused and atomic
- Add tests for new functionality
- Update documentation for API changes
- Ensure CI checks pass before requesting review

> 📖 **Full Guide:** See [CONTRIBUTING.md](./docs/CONTRIBUTING.md) for detailed contribution guidelines.

## 🌟 Community & Support

<div align="center">

[![GitHub Stars](https://img.shields.io/github/stars/berkayozrunc/orquestra?style=social)](https://github.com/berkayozrunc/orquestra)

</div>

### Get Help

- 🐛 **Issues**: Report bugs on [GitHub Issues](https://github.com/berkayozrunc/orquestra/issues)
- 💡 **Discussions**: Share ideas in [GitHub Discussions](https://github.com/berkayozrunc/orquestra/discussions)

### Contributors

Thanks to all contributors! 🎉

<a href="https://github.com/berkayozrunc/orquestra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=berkayozrunc/orquestra" />
</a>

## 📜 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

```
MIT License

Copyright (c) 2026 orquestra contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction...
```

## 🙏 Acknowledgments

Built with ❤️ for the Solana ecosystem. Special thanks to:

- **[Solana Foundation](https://solana.com)** - For building an incredible blockchain platform
- **[Anchor](https://anchor-lang.com)** - Framework that makes Solana development accessible
- **[Cloudflare](https://cloudflare.com)** - Edge infrastructure powering the platform
- **[Hono](https://honojs.dev)** - Fast, lightweight web framework
- **All Contributors** - Your contributions make this project better



<div align="center">

**[Website](https://orquestra.dev)** • **[Documentation](./docs/)** • **[API Reference](./docs/API.md)** • **[Discord](https://discord.gg/orquestra)** • **[Twitter](https://twitter.com/orquestra)**

Made with ❤️ for the Solana ecosystem

⭐ **Star us on GitHub** — it motivates us to build better tools!

</div>
