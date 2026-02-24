# orquestra 🎉

> **Upload a Solana IDL → get a ready-to-use REST API instantly**

A free, open-source platform for converting Anchor IDLs into production-ready REST APIs. Perfect for Solana program developers and integrators.

## 🌟 Features

- **IDL Upload & Parsing** - Support for Anchor IDL v0.29+ and legacy formats
- **Auto-Generated REST APIs** - Endpoints for every instruction, account type, and error
- **Base58 Transaction Building** - Serialize transactions ready for wallet signing
- **AI-Ready Markdown Docs** - Auto-generated documentation optimized for LLMs
- **GitHub Auth** - Secure authentication for developers
- **Public API Explorer** - Browse and test public projects
- **Dashboard** - Manage projects, API keys, and metadata
- **Private API Keys** - Control access to private projects

## 📊 Project Structure

```
orquestra/
├── packages/
│   ├── frontend/          React SPA (Cloudflare Pages)
│   ├── worker/            Hono API (Cloudflare Workers)
│   └── shared/            Shared types & utilities
├── migrations/            D1 database schema
├── scripts/               Build & deployment utilities
├── .github/workflows/     CI/CD pipelines
├── wrangler.toml          Cloudflare configuration
├── package.json           Monorepo dependencies
├── tsconfig.json          TypeScript configuration
└── README.md              This file
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Cloudflare account
- GitHub account (for OAuth setup)

### Setup (Turkish: Kurulum)

**English:**
```bash
# 1. Clone the repository
git clone https://github.com/yourusername/orquestra.git
cd orquestra

# 2. Run quick start script
./scripts/quick-start.sh

# 3. Start development servers
npm run dev
```

**Turkish (Türkçe):**
```bash
# 1. Projeyi klonlayın
git clone https://github.com/yourusername/base58fun.git
cd base58fun

# 2. Hızlı başlama script'ini çalıştırın
./scripts/quick-start.sh

# 3. Dev sunucularını başlatın
npm run dev
```

### Full Setup Guide

For detailed setup instructions, see [SETUP_INSTRUCTIONS.md](./SETUP_INSTRUCTIONS.md)

**Quick reference:**
```bash
# Install dependencies
npm run install:all

# Setup database
npm run db:migrate:dev

# Development
npm run dev                 # Both frontend & backend
npm run dev:frontend        # React only
npm run dev:worker          # Hono backend only

# Building
npm run build              # Build all
npm run build:frontend     # React only
npm run build:worker       # Worker only

# Testing
npm run type-check         # TypeScript check
npm run lint              # Linting
npm run lint:fix          # Auto-fix
npm run format            # Code formatting

# Deployment
npm run deploy            # Deploy to production

# 2. Run setup script
node scripts/setup.js

# 3. Install dependencies
npm run install:all

# 4. Configure environment
# Edit .env.local with your credentials:
# - Cloudflare API token
# - GitHub OAuth credentials
# - Database IDs
cp .env.example .env.local
nano .env.local

# 5. Create database
npm run db:migrate:dev

# 6. Start development servers
npm run dev
```

**Access:**
- Frontend: http://localhost:5173
- Backend: http://localhost:8787

## 📖 API Endpoints

### Health & Status
- `GET /health` - Health check
- `GET /health/ping` - Ping

### Authentication
- `GET /auth/github` - Start GitHub OAuth
- `POST /auth/github/callback` - OAuth callback
- `POST /auth/logout` - Logout

### IDL Management
- `POST /api/idl/upload` - Upload IDL
- `GET /api/idl/:projectId` - Get IDL
- `PUT /api/idl/:projectId` - Update IDL
- `DELETE /api/idl/:projectId` - Delete IDL

### API Access
- `GET /api/:projectId/instructions` - List instructions
- `GET /api/:projectId/instructions/:name` - Get instruction details
- `POST /api/:projectId/instructions/:name/build` - Build transaction
- `GET /api/:projectId/accounts` - List account types
- `GET /api/:projectId/errors` - List error codes
- `GET /api/:projectId/events` - List events
- `GET /api/:projectId/docs` - Markdown documentation
- `GET /api/:projectId/idl` - Raw IDL JSON

## 🗄️ Database Schema

### Users
```sql
id, github_id, username, email, avatar_url, created_at, updated_at
```

### Projects
```sql
id, user_id, name, description, program_id, is_public, created_at, updated_at
```

### IDL Versions
```sql
id, project_id, idl_json, cpi_md, version, created_at
```

### API Keys
```sql
id, project_id, key, last_used, created_at, expires_at
```

### Project Socials
```sql
id, project_id, twitter, discord, telegram, github, website, created_at, updated_at
```

## 🔧 Development

### Commands

```bash
# Development
npm run dev                 # Start all dev servers
npm run dev:frontend        # Start frontend only
npm run dev:worker          # Start backend only

# Building
npm run build              # Build all packages
npm run build:frontend     # Build frontend
npm run build:worker       # Build backend

# Linting & Testing
npm run lint               # Lint all packages
npm run lint:fix           # Fix lint errors
npm run type-check         # TypeScript type check
npm run test               # Run tests

# Database
npm run db:migrate         # Run migrations (production)
npm run db:migrate:dev     # Run migrations (development)
npm run db:seed            # Seed sample data
npm run db:reset           # Reset database (dev only)

# Deployment
npm run deploy             # Deploy to production
npm run deploy:worker      # Deploy worker only
npm run deploy:pages       # Deploy pages only
```

### Environment Variables

See `.env.example` for all available options. Required variables:

```bash
CLOUDFLARE_API_TOKEN        # Cloudflare API token
CLOUDFLARE_ACCOUNT_ID       # Your Cloudflare account ID
GITHUB_OAUTH_ID             # GitHub OAuth app ID
GITHUB_OAUTH_SECRET         # GitHub OAuth secret
JWT_SECRET                  # JWT signing secret
SOLANA_RPC_URL              # Solana RPC endpoint
```

## 🚢 Deployment

### Cloudflare Workers (Backend)

```bash
# Deploy to production
npm run deploy:worker

# Set secrets
wrangler secret put GITHUB_OAUTH_SECRET
wrangler secret put JWT_SECRET
```

### Cloudflare Pages (Frontend)

```bash
# Deploy to production
npm run deploy:pages

# Or deploy all
npm run deploy
```

### Database Migrations

```bash
# Apply migrations
wrangler d1 execute base58fun-prod \
  --file ./migrations/001_initial_schema.sql --remote
```

## 🔄 CI/CD

GitHub Actions workflows handle:
- **Linting** - ESLint on every PR
- **Type Checking** - TypeScript compilation
- **Testing** - Unit and integration tests
- **Build** - Production builds
- **Deploy** - Auto-deploy to Cloudflare on push to main

Workflows: `.github/workflows/ci-cd.yml` and `.github/workflows/database.yml`

### 🤖 Copilot Agent Integration

**NEW:** GitHub Actions now includes a Copilot Agent workflow (`copilot-agent.yml`)

#### How to Use Copilot Agent

1. **Create or open an issue**
2. **Add the `copilot-task` label**
3. **Copilot Agent automatically:**
   - Analyzes the issue
   - Generates code solution
   - Creates a pull request
   - Adds tests and documentation

#### Example Issue

```markdown
# Title: Implement IDL validation

## Description
Create a POST /api/idl/validate endpoint that:
- Accepts IDL JSON
- Validates structure
- Returns validation errors
- Stores in R2 if valid

## Labels: `copilot-task`
```

#### Workflow Triggers

- `copilot-task` label on issues → Assigns Copilot Agent
- `needs-review` label on PRs → Requests Copilot code review

#### GitHub Labels Setup

Setup recommended labels:
```bash
# Use GitHub CLI to create labels
gh label create copilot-task --color FF6B6B \
  --description "Assign to Copilot Agent for implementation"

gh label create needs-review --color 0096FF \
  --description "Copilot to provide code review"

# Or manually: .github/LABELS.md has full setup instructions
```

See [.github/LABELS.md](.github/LABELS.md) for all recommended labels and setup guide.

## 📦 Tech Stack

### Frontend
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **React Router** - Client routing
- **Zustand** - State management
- **Axios** - HTTP client
- **Solana Web3.js** - Blockchain interaction

### Backend
- **Hono** - Web framework
- **TypeScript** - Type safety
- **Cloudflare Workers** - Serverless runtime
- **D1** - SQL database
- **KV** - Key-value storage
- **Zod** - Data validation

### Shared
- **TypeScript** - Type definitions
- **Utility functions** - Common helpers

## 🔒 Security

- GitHub OAuth for authentication
- JWT tokens for API access
- API keys for private projects
- CORS protection
- Input validation with Zod
- SQL injection protection via parameterized queries

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- [Solana](https://solana.com) - Blockchain platform
- [Anchor](https://anchor-lang.com) - Framework for Solana programs
- [Cloudflare](https://cloudflare.com) - Infrastructure & deployment
- [Hono](https://honojs.dev) - Web framework

## 📬 Support

- 📖 [Documentation](./SETUP_GUIDE.md)
- 💬 [GitHub Issues](https://github.com/yourusername/base58fun/issues)
- 🤖 [Discord Community](https://discord.gg/base58fun)

---

Made with ❤️ for the Solana ecosystem
