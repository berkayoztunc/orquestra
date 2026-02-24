# Getting Started with base58fun

This guide walks you through getting the base58fun project up and running on your machine.

## Prerequisites

- **Node.js 18+** - [Download](https://nodejs.org/)
- **npm or yarn** - Comes with Node.js
- **Git** - [Download](https://git-scm.com/)
- **Text editor** - VS Code recommended
- **Cloudflare account** - [Sign up](https://dash.cloudflare.com/)
- **GitHub account** - [Sign up](https://github.com/)

## Step 1: Clone & Setup Project

```bash
# Clone the repository (if you haven't already)
git clone https://github.com/yourusername/base58fun.git
cd base58fun

# Create environment file
cp .env.example .env.local

# Run setup script
node scripts/setup.js
```

The setup script will print instructions and create your `.env.local` file.

## Step 2: Configure Environment Variables

Edit `.env.local` with your actual values:

```bash
nano .env.local  # or open in your editor
```

**Required variables to fill in:**

```bash
# Cloudflare (from https://dash.cloudflare.com/)
CLOUDFLARE_API_TOKEN=your_token_here
CLOUDFLARE_ACCOUNT_ID=your_account_id_here

# GitHub OAuth (from https://github.com/settings/apps)
GITHUB_OAUTH_ID=your_github_oauth_id
GITHUB_OAUTH_SECRET=your_github_oauth_secret

# JWT (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
JWT_SECRET=generated_secret_here
```

### Getting Your Credentials

#### Cloudflare Account ID & API Token
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Click your profile → Settings
3. In "Tokens & Keys", click "Create Token"
4. Use template "Edit Cloudflare Workers" or create custom
5. Copy token and account ID

#### GitHub OAuth Credentials
1. Go to [GitHub Settings](https://github.com/settings/developers)
2. Click "OAuth Apps" → "New OAuth App"
3. Fill in:
   - **Application name:** base58fun
   - **Homepage URL:** http://localhost:5173
   - **Authorization callback URL:** http://localhost:8787/auth/github/callback
4. Copy Client ID and Client Secret

## Step 3: Install Dependencies

```bash
# Install root dependencies and workspace packages
npm run install:all

# Or manually:
npm install
npm install -w packages/frontend
npm install -w packages/worker
npm install -w packages/shared
```

This installs all dependencies for each workspace while using the monorepo structure.

## Step 4: Create Database

### For Development (Local)

```bash
# Run database migrations
npm run db:migrate:dev

# Optional: Seed with sample data
npm run db:seed
```

### For Production (Cloudflare D1)

First, create the D1 database:

```bash
# Create production database
wrangler d1 create base58fun-prod

# Copy the database_id from output and add to wrangler.toml
```

Then add to [wrangler.toml](./wrangler.toml):

```toml
[[d1_databases]]
binding = "DB"
database_name = "base58fun-prod"
database_id = "YOUR_ID_HERE"
```

## Step 5: Start Development Servers

```bash
# Start both frontend and backend
npm run dev
```

Or start them separately in different terminals:

```bash
# Terminal 1: Frontend dev server
npm run dev:frontend
# Runs on http://localhost:5173

# Terminal 2: Backend dev server
npm run dev:worker
# Runs on http://localhost:8787
```

## Step 6: Verify Setup

Open your browser and check:

### Frontend
```
http://localhost:5173
```
Should show the base58fun home page with "Get Started" button

### Backend Health
```
http://localhost:8787/health
```
Should return:
```json
{
  "status": "ok",
  "service": "base58fun-api"
}
```

### Backend Ping
```
http://localhost:8787/health/ping
```
Should return: `pong`

## Common Development Commands

```bash
# Development
npm run dev                 # Start all dev servers
npm run dev:frontend        # Start React dev server only
npm run dev:worker          # Start Hono dev server only

# Building
npm run build              # Build all packages
npm run build:frontend     # Build React app
npm run build:worker       # Build Worker app

# Code Quality
npm run type-check         # TypeScript type checking
npm run lint               # Run ESLint
npm run lint:fix           # Auto-fix linting issues
npm run format             # Format with Prettier

# Database
npm run db:migrate:dev     # Run migrations (development)
npm run db:seed            # Seed sample data
npm run db:reset           # Clear all data (dev only)

# Testing
npm test                   # Run all tests

# Deployment
npm run deploy             # Deploy all (requires Cloudflare auth)
npm run deploy:worker      # Deploy only Worker
npm run deploy:pages       # Deploy only Pages
```

## Project Structure

```
base58fun/
├── README.md                   # Project overview
├── SETUP_GUIDE.md             # Detailed setup instructions
├── DEPLOYMENT.md              # How to deploy to production
├── ARCHITECTURE.md            # System design documentation
├── CONTRIBUTING.md            # Contribution guidelines
├── QUICKREF.md                # Quick command reference
│
├── package.json               # Monorepo root configuration
├── wrangler.toml              # Cloudflare Workers config
├── tsconfig.json              # TypeScript configuration
├── .env.example               # Example environment variables
│
├── packages/
│   ├── frontend/              # React SPA for dashboard
│   │   ├── src/
│   │   │   ├── components/    # React components
│   │   │   ├── pages/         # Page components
│   │   │   ├── App.tsx        # Root component
│   │   │   └── main.tsx       # Entry point
│   │   ├── index.html         # HTML template
│   │   ├── vite.config.ts     # Vite build config
│   │   └── tailwind.config.js # Tailwind CSS config
│   │
│   ├── worker/                # Hono API backend
│   │   ├── src/
│   │   │   ├── routes/        # API endpoints
│   │   │   ├── middleware/    # Custom middleware
│   │   │   └── index.ts       # Hono app
│   │   └── wrangler.toml      # Worker config
│   │
│   └── shared/                # Shared types & utilities
│       ├── src/
│       │   ├── types.ts       # TypeScript interfaces
│       │   ├── utils.ts       # Helper functions
│       │   └── index.ts       # Exports
│       └── tsconfig.json
│
├── migrations/                # Database schemas
│   ├── 001_initial_schema.sql # Tables: users, projects, etc.
│   └── 002_indexes.sql        # Performance indexes
│
├── scripts/                   # Build & utility scripts
│   ├── setup.js               # Initial setup guide
│   ├── seed-db.js             # Database seeding
│   └── configure-cf.js        # Cloudflare configuration
│
└── .github/
    └── workflows/             # GitHub Actions CI/CD
        ├── ci-cd.yml          # Build & deploy pipeline
        └── database.yml       # Database migration pipeline
```

## Troubleshooting

### Node version mismatch
```bash
# Check your Node version
node --version
# Should be 18.x or higher

# If not, install from nodejs.org or use nvm
nvm use 18
```

### Port already in use
```bash
# If port 5173 (frontend) is in use:
npm run dev:frontend -- --port 5174

# If port 8787 (worker) is in use:
PORT=8788 npm run dev:worker
```

### Environment variables not loading
```bash
# Make sure .env.local exists in project root
ls -la .env.local

# Check it has required variables
cat .env.local | grep CLOUDFLARE_API_TOKEN
```

### Database connection error
```bash
# Run migrations again
npm run db:migrate:dev

# Check database exists
wrangler d1 info base58fun-dev
```

### GitHub OAuth not working
1. Check Client ID matches `.env.local`
2. Verify callback URL is `http://localhost:8787/auth/github/callback`
3. Check GitHub OAuth app isn't restricted

### TypeScript errors
```bash
# Run type checking
npm run type-check

# Check for any compilation errors
npm run build
```

## Next Steps

Once everything is running:

1. **Explore the Code**
   - Check out `packages/frontend/src/` for React components
   - Review `packages/worker/src/routes/` for API endpoints
   - Look at `packages/shared/src/` for shared types

2. **Read the Documentation**
   - [ARCHITECTURE.md](./ARCHITECTURE.md) - System design
   - [SETUP_GUIDE.md](./SETUP_GUIDE.md) - Detailed setup
   - [QUICKREF.md](./QUICKREF.md) - Command reference

3. **Start Developing**
   - Create a new feature branch
   - Make changes to code
   - Run tests and linting
   - Commit with conventional messages

4. **Deploy to Staging**
   - Push to `develop` branch
   - GitHub Actions runs tests and deploys automatically
   - Check deployment at staging URL

5. **Deploy to Production**
   - Create a pull request
   - Get review from maintainers
   - Merge to `main` branch
   - GitHub Actions deploys to production

## IDE Recommendations

### VS Code Extensions
- **ESLint** - Detect code issues
- **Prettier** - Code formatting
- **TypeScript Vue Plugin** - TypeScript support
- **Tailwind CSS IntelliSense** - Tailwind autocomplete
- **Thunder Client** - API testing
- **REST Client** - HTTP requests in editor
- **Git Graph** - Git visualization

### VS Code Settings
```json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  }
}
```

## Testing Your Setup

Create a simple test to verify everything works:

```bash
# Test health endpoint
curl http://localhost:8787/health

# Test frontend loads
curl -I http://localhost:5173

# Test type checking
npm run type-check

# Test building
npm run build
```

## Getting Help

If you run into issues:

1. **Check Documentation**
   - Read [SETUP_GUIDE.md](./SETUP_GUIDE.md)
   - Review [QUICKREF.md](./QUICKREF.md)
   - Check [TROUBLESHOOTING](./DEPLOYMENT.md#troubleshooting)

2. **Search GitHub Issues**
   - Similar issue may be documented
   - Check closed issues for solutions

3. **Ask for Help**
   - Create GitHub issue with details
   - Join our Discord community
   - Check GitHub Discussions

## Ready to Code! 🚀

You now have:
- ✅ Development environment set up
- ✅ Frontend running on http://localhost:5173
- ✅ Backend running on http://localhost:8787
- ✅ Database configured and ready
- ✅ All dependencies installed

Start by exploring the codebase, then pick a feature from [ROADMAP.md](./ROADMAP.md) to implement!

Happy coding! 🎉

---

**Still need help?**
- 📖 [Full Setup Guide](./SETUP_GUIDE.md)
- 🏗️ [Architecture Documentation](./ARCHITECTURE.md)
- 📚 [Quick Reference](./QUICKREF.md)
- ⚙️ [Deployment Guide](./DEPLOYMENT.md)
