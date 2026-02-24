# orquestra Setup Guide

Complete step-by-step guide to bootstrap the orquestra project.

## 📋 Prerequisites

- Node.js 18+ and npm/yarn
- Git
- Cloudflare account (with Pages & Workers enabled)
- GitHub account (for OAuth)
- Wrangler CLI: `npm install -g wrangler`

## 🚀 Quick Start

### 1. Initialize Project Structure

```bash
# Create the main directory structure
mkdir -p packages/{frontend,worker,shared} migrations scripts .github/workflows

# Create root package.json (monorepo)
touch package.json wrangler.toml .env.example tsconfig.json

# Create workspace packages
cd packages/frontend && npm init -y
cd ../worker && npm init -y
cd ../shared && npm init -y
cd ../..
```

### 2. Install Root Dependencies

```bash
# Install dev dependencies that will be shared across workspace
npm install -D typescript @types/node tsx esbuild prettier eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser

# Optional: Git hooks
npm install -D husky lint-staged
```

### 3. Set Up Git

```bash
git init
git add .
git commit -m "Initial commit: Project structure"
git branch -M main
# git remote add origin https://github.com/yourusername/orquestra.git
# git push -u origin main
```

### 4. Create Environment Configuration

```bash
cp .env.example .env.local
# Edit .env.local with your Cloudflare credentials and GitHub OAuth
```

### 5. Generate Cloudflare Workers

```bash
wrangler init --name orquestra-worker
wrangler pages project create orquestra-frontend
```

### 6. Set Up Databases

```bash
# Create D1 database
wrangler d1 create orquestra-prod
wrangler d1 create orquestra-dev

# Run migrations
npm run db:migrate
```

### 7. Build & Deploy

```bash
# Development
npm run dev

# Production
npm run build
npm run deploy
```

---

## 📁 Project Structure Breakdown

### Root Level Files

| File | Purpose |
|------|---------|
| `package.json` | Monorepo root dependencies and scripts |
| `wrangler.toml` | Cloudflare Workers configuration |
| `tsconfig.json` | TypeScript configuration |
| `.env.example` | Environment variables template |
| `README.md` | Project overview |
| `LICENSE` | Open source license (MIT) |

### Packages

#### `/packages/frontend`
React + TypeScript + Vite + Tailwind CSS SPA for Cloudflare Pages

#### `/packages/worker`
Hono + TypeScript API server for Cloudflare Workers

#### `/packages/shared`
Shared TypeScript types, utilities, and constants

### Supporting Directories

- `/migrations` - D1 SQL migration files
- `/scripts` - Utility scripts (backups, database seeding, etc.)
- `/.github/workflows` - GitHub Actions CI/CD pipelines

---

## 🔧 Configuration Files Detail

### Root package.json
```json
{
  "name": "orquestra",
  "version": "1.0.0",
  "private": true,
  "description": "Solana IDL to REST API converter",
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "dev": "npm run dev -w packages/frontend & npm run dev -w packages/worker",
    "build": "npm run build -w packages/shared && npm run build -w packages/frontend && npm run build -w packages/worker",
    "deploy": "npm run build && wrangler deploy && wrangler pages deploy",
    "test": "npm test -w packages/frontend && npm test -w packages/worker",
    "lint": "eslint packages/*/src --ext .ts,.tsx",
    "db:migrate": "wrangler d1 execute orquestra-prod --file ./migrations/schema.sql",
    "db:seed": "node scripts/seed-db.js",
    "type-check": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "@types/node": "^20.10.5",
    "tsx": "^4.7.0",
    "prettier": "^3.1.1",
    "eslint": "^8.56.0",
    "@typescript-eslint/eslint-plugin": "^6.16.0",
    "@typescript-eslint/parser": "^6.16.0"
  }
}
```

### wrangler.toml
```toml
name = "orquestra"
type = "service"
account_id = "YOUR_ACCOUNT_ID"
workers_dev = true

# Routes
[[routes.default]]
pattern = "api.orquestra.dev/*"
zone_name = "orquestra.dev"

[env.production]
name = "orquestra-worker-prod"
route = "api.orquestra.dev/*"
zone_id = "YOUR_ZONE_ID"

[env.development]
name = "orquestra-worker-dev"
workers_dev = true

# D1 Database Binding
[[d1_databases]]
binding = "DB"
database_name = "orquestra-prod"
database_id = "YOUR_DATABASE_ID"

[env.development.d1_databases]
binding = "DB"
database_name = "orquestra-dev"
database_id = "YOUR_DEV_DATABASE_ID"

# KV Bindings
[[kv_namespaces]]
binding = "IDLS"
id = "YOUR_KV_ID"
preview_id = "YOUR_KV_PREVIEW_ID"

[[kv_namespaces]]
binding = "CACHE"
id = "YOUR_CACHE_KV_ID"
preview_id = "YOUR_CACHE_PREVIEW_ID"

# Environment Variables
[env.production.vars]
GITHUB_OAUTH_ID = "YOUR_GITHUB_OAUTH_ID"
GITHUB_OAUTH_SECRET = "YOUR_GITHUB_OAUTH_SECRET"
SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com"
JWT_SECRET = "YOUR_JWT_SECRET"
FRONTEND_URL = "https://orquestra.dev"

[env.development.vars]
GITHUB_OAUTH_ID = "YOUR_GITHUB_DEV_OAUTH_ID"
GITHUB_OAUTH_SECRET = "YOUR_GITHUB_DEV_OAUTH_SECRET"
SOLANA_RPC_URL = "https://api.devnet.solana.com"
JWT_SECRET = "YOUR_DEV_JWT_SECRET"
FRONTEND_URL = "http://localhost:5173"
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["packages/shared/src/*"],
      "@/*": ["packages/*/src/*"]
    }
  },
  "include": ["packages/*/src"],
  "references": [
    { "path": "./packages/frontend" },
    { "path": "./packages/worker" },
    { "path": "./packages/shared" }
  ]
}
```

### .env.example
```bash
# Cloudflare
CLOUDFLARE_API_TOKEN=your_token_here
CLOUDFLARE_ACCOUNT_ID=your_account_id_here
CLOUDFLARE_DATABASE_ID=your_d1_database_id_here

# GitHub OAuth
GITHUB_OAUTH_ID=your_github_oauth_id_here
GITHUB_OAUTH_SECRET=your_github_oauth_secret_here

# JWT
JWT_SECRET=your_jwt_secret_key_here

# Solana
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_DEVNET_RPC_URL=https://api.devnet.solana.com

# URLs
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:8787
API_DOMAIN=api.orquestra.dev

# Database
DATABASE_NAME=orquestra-prod

# Redis/Cache (optional)
REDIS_URL=redis://localhost:6379
```

---

## 📦 Frontend Setup

### packages/frontend/package.json
```json
{
  "name": "@orquestra/frontend",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "type-check": "tsc --noEmit",
    "lint": "eslint src --ext .ts,.tsx"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.20.1",
    "zustand": "^4.4.6",
    "axios": "^1.6.2",
    "@solana/web3.js": "^1.87.6",
    "@solana/wallet-adapter-react": "^0.15.35",
    "@solana/wallet-adapter-react-ui": "^0.9.35"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.1",
    "vite": "^5.0.8",
    "typescript": "^5.3.3",
    "@types/react": "^18.2.43",
    "@types/react-dom": "^18.2.17",
    "tailwindcss": "^3.4.1",
    "postcss": "^8.4.32",
    "autoprefixer": "^10.4.16"
  }
}
```

### packages/frontend/vite.config.ts
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared/src'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  }
})
```

### packages/frontend/tsconfig.json
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "paths": {
      "@shared/*": ["../shared/src/*"],
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "../shared" }]
}
```

### packages/frontend/tailwind.config.js
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#14F195',
        dark: '#0a0a0a',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
      }
    },
  },
  plugins: [],
}
```

### packages/frontend/postcss.config.js
```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

---

## 🔌 Worker (Backend) Setup

### packages/worker/package.json
```json
{
  "name": "@orquestra/worker",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "build": "esbuild src/index.ts --bundle --platform=browser --outfile=dist/index.js",
    "type-check": "tsc --noEmit",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "hono": "^3.12.0",
    "@solana/web3.js": "^1.87.6",
    "@solana/spl-token": "^0.4.3",
    "zod": "^3.22.4",
    "@hono/zod-validator": "^0.2.1",
    "jsonwebtoken": "^9.1.0",
    "js-base64": "^3.7.5"
  },
  "devDependencies": {
    "esbuild": "^0.19.11",
    "typescript": "^5.3.3",
    "@types/node": "^20.10.5",
    "wrangler": "^3.17.1"
  }
}
```

### packages/worker/wrangler.toml
```toml
name = "orquestra-worker"
type = "service"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[services]]
binding = "AUTH_SERVICE"
service = "orquestra-auth"
environment = "production"
```

### packages/worker/tsconfig.json
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "paths": {
      "@shared/*": ["../shared/src/*"],
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "../shared" }]
}
```

---

## 📚 Shared Types Setup

### packages/shared/package.json
```json
{
  "name": "@orquestra/shared",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "type-check": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.3.3"
  }
}
```

### packages/shared/tsconfig.json
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "outDir": "./dist"
  },
  "include": ["src"]
}
```

---

## 🗄️ Database Schema (D1)

See `migrations/001_initial_schema.sql` for complete D1 setup.

---

## ⚙️ Environment Setup

### Local Development

```bash
# Create .env.local from template
cp .env.example .env.local

# Fill in with your credentials:
# - Cloudflare API token
# - GitHub OAuth credentials
# - JWT secret
# - Solana RPC endpoints

# Start development servers
npm run dev
# Frontend: http://localhost:5173
# Worker: http://localhost:8787
```

---

## 🚢 Deployment

### Cloudflare Workers (Backend)

```bash
# Set secrets
wrangler secret put GITHUB_OAUTH_SECRET
wrangler secret put JWT_SECRET

# Deploy
wrangler deploy --env production
```

### Cloudflare Pages (Frontend)

```bash
# Build
npm run build -w packages/frontend

# Deploy
wrangler pages deploy packages/frontend/dist --project-name orquestra-frontend
```

### Database Migrations

```bash
# Apply migrations
wrangler d1 execute orquestra-prod --file ./migrations/001_initial_schema.sql
wrangler d1 execute orquestra-prod --file ./migrations/002_indexes.sql
```

---

## 🔍 Verification Checklist

- [ ] All packages install without errors
- [ ] TypeScript compiles without errors (`npm run type-check`)
- [ ] Dev servers start successfully
- [ ] Frontend loads at `http://localhost:5173`
- [ ] Worker responds at `http://localhost:8787`
- [ ] Database migrations apply successfully
- [ ] Environment variables are configured
- [ ] GitHub OAuth callback is registered

---

## 📖 Next Steps

1. **Frontend Development** → See `packages/frontend/README.md`
2. **Worker Development** → See `packages/worker/README.md`
3. **Database Schema** → Review `migrations/001_initial_schema.sql`
4. **CI/CD Setup** → Configure `.github/workflows/`
5. **Deployment** → Follow deployment instructions above

