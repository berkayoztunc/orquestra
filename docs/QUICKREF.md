# Quick Reference

Common commands and quick tips for developing orquestra.

## Development

```bash
# Start all dev servers
npm run dev

# Or start individually
npm run dev:frontend     # React dev server (5173)
npm run dev:worker       # Worker dev server (8787)

# Type checking
npm run type-check

# Linting
npm run lint
npm run lint:fix        # Auto-fix linting issues

# Formatting
npm run format
```

## Building

```bash
# Build all packages
npm run build

# Build specific packages
npm run build:frontend
npm run build:worker

# Check for TypeScript errors
npm run type-check
```

## Database

```bash
# Development database
npm run db:migrate:dev      # Run migrations
npm run db:seed             # Add sample data
npm run db:reset            # Clear all tables

# Production database
npm run db:migrate          # Run migrations (requires wrangler auth)
```

## Testing

```bash
# Run all tests
npm test

# Run tests for specific package
npm test -w packages/frontend
npm test -w packages/worker
```

## Deployment

```bash
# Deploy everything
npm run deploy

# Deploy specific services
npm run deploy:worker       # Backend to Cloudflare Workers
npm run deploy:pages        # Frontend to Cloudflare Pages
```

## Environment

```bash
# Copy template
cp .env.example .env.local

# Required variables
CLOUDFLARE_API_TOKEN        # Your Cloudflare token
CLOUDFLARE_ACCOUNT_ID       # Your Cloudflare account ID
GITHUB_OAUTH_ID             # GitHub's Client ID
GITHUB_OAUTH_SECRET         # GitHub's Client Secret
JWT_SECRET                  # Generate: openssl rand -hex 32
```

## Useful URLs

| Service | Local | Production |
|---------|-------|------------|
| Frontend | http://localhost:5173 | https://orquestra.dev |
| Backend | http://localhost:8787 | https://api.orquestra.dev |
| Health | http://localhost:8787/health | https://api.orquestra.dev/health |
| DB | Wrangler | Cloudflare Dashboard |

## File Organization

```
packages/
  frontend/src/
    components/          # React components
    pages/              # Page components
    store/              # State management
    types/              # Type definitions
    utils/              # Helper functions
    
  worker/src/
    routes/             # API routes/endpoints
    middleware/         # Custom middleware
    services/           # Business logic
    utils/              # Helper functions
    
  shared/src/
    types.ts            # Shared types
    utils.ts            # Shared utilities
```

## Common Tasks

### Add a New Frontend Component

1. Create file: `packages/frontend/src/components/MyComponent.tsx`
2. Define component:
   ```typescript
   export default function MyComponent(): JSX.Element {
     return <div>Component</div>
   }
   ```
3. Import and use in page/layout

### Add a New API Endpoint

1. Create route file: `packages/worker/src/routes/myroute.ts`
2. Define Hono routes:
   ```typescript
   app.get('/path', (c) => c.json({ data: 'response' }))
   ```
3. Import in `src/index.ts` and mount

### Add Shared Types

1. Add to `packages/shared/src/types.ts`
2. Export from `packages/shared/src/index.ts`
3. Import in frontend or worker:
   ```typescript
   import { MyType } from '@orquestra/shared'
   ```

### Query Database

```typescript
// D1 query in worker
const result = await env.DB.prepare(
  'SELECT * FROM users WHERE id = ?'
).bind(userId).first()
```

### Store in KV

```typescript
// Save to KV
await env.IDLS.put(`idl:${projectId}:${version}`, JSON.stringify(idl))

// Retrieve from KV
const cached = await env.IDLS.get(`idl:${projectId}:${version}`)
```

## Debugging

### Browser DevTools
- Open DevTools (F12)
- Check Network tab for API calls
- Check Console for errors
- React DevTools extension helpful

### Worker Logs
```bash
wrangler tail --env development
```

### Database Queries
```bash
wrangler d1 execute orquestra-dev --interactive
```

### Environment Check
- Frontend: Can access http://localhost:8787 without CORS errors?
- Backend: Can query database? `curl http://localhost:8787/health`
- Auth: GitHub secrets configured correctly?

## Performance Tips

- Use React DevTools Profiler to find slow renders
- Check Network tab for large bundles (>1MB)
- Use `npm run build` and check bundle size
- Monitor D1 query performance

## Code Quality

```bash
# Run all checks
npm run type-check && npm run lint && npm test

# Before committing
npm run format && npm run lint:fix
```

## Common Errors

| Error | Solution |
|-------|----------|
| CORS error | Check `.env.local` CORS_ORIGIN |
| Database connection fails | Run `npm run db:migrate:dev` |
| GitHub OAuth error | Verify Client ID/Secret in `.env.local` |
| Type errors | Run `npm run type-check` and fix |
| Build fails | Check Node version (need 18+), delete node_modules and reinstall |

## Resources

- [SETUP_GUIDE.md](./SETUP_GUIDE.md) - Complete setup instructions
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Deployment guide
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contribution guidelines

## Getting Help

1. Check documentation
2. Search GitHub issues
3. Ask in Discord community
4. Open a GitHub issue with details

## Useful Commands

```bash
# Clean install
npm run clean && npm run install:all

# Fresh database
npm run db:reset && npm run db:seed

# Full type check across workspace
npm run type-check

# Build and preview locally
npm run build && npm run preview
```
