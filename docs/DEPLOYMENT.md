# Deployment Guide

Complete guide for deploying base58fun to production.

## 📋 Prerequisites

- Cloudflare account with Workers and Pages enabled
- GitHub account with OAuth app configured
- Node.js 18+
- Wrangler CLI installed

## 🔧 Configuration Steps

### 1. Cloudflare Setup

#### Create D1 Databases

```bash
# Production database
wrangler d1 create base58fun-prod

# Development database (optional)
wrangler d1 create base58fun-dev
```

Copy the `database_id` values and add them to `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "base58fun-prod"
database_id = "YOUR_ID_HERE"
```

#### Create KV Namespaces

```bash
# For IDL storage
wrangler kv:namespace create IDLS
wrangler kv:namespace create IDLS --preview

# For caching
wrangler kv:namespace create CACHE
wrangler kv:namespace create CACHE --preview
```

Update `wrangler.toml` with KV IDs:

```toml
[[kv_namespaces]]
binding = "IDLS"
id = "YOUR_IDLS_ID"
preview_id = "YOUR_IDLS_PREVIEW_ID"

[[kv_namespaces]]
binding = "CACHE"
id = "YOUR_CACHE_ID"
preview_id = "YOUR_CACHE_PREVIEW_ID"
```

### 2. GitHub OAuth Setup

1. Go to GitHub Settings → Developer settings → OAuth Apps
2. Create a new OAuth App:
   - **Application name:** base58fun
   - **Homepage URL:** https://base58fun.dev
   - **Authorization callback URL:** https://api.base58fun.dev/auth/github/callback
3. Copy Client ID and Client Secret
4. Add to Cloudflare as secrets:

```bash
wrangler secret put GITHUB_OAUTH_ID --env production
# Paste your Client ID

wrangler secret put GITHUB_OAUTH_SECRET --env production
# Paste your Client Secret

wrangler secret put JWT_SECRET --env production
# Generate a secure random string
```

### 3. Environment Variables

Set production environment variables in Cloudflare:

```bash
wrangler secret put GITHUB_OAUTH_ID --env production
wrangler secret put GITHUB_OAUTH_SECRET --env production
wrangler secret put JWT_SECRET --env production
```

Variables in `wrangler.toml` for `[env.production.vars]`:

```toml
[env.production.vars]
SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com"
FRONTEND_URL = "https://base58fun.dev"
API_BASE_URL = "https://api.base58fun.dev"
CORS_ORIGIN = "https://base58fun.dev"
```

### 4. Database Migrations

```bash
# Run initial schema
wrangler d1 execute base58fun-prod \
  --file ./migrations/001_initial_schema.sql --remote

# Add indexes
wrangler d1 execute base58fun-prod \
  --file ./migrations/002_indexes.sql --remote
```

### 5. Domain Configuration

1. Add your domain to Cloudflare (if not already)
2. Configure DNS records:
   - Add CNAME for API: `api` → Workers route
   - Add CNAME for WWW: `www` → Pages project
3. Set SSL/TLS to Full (Strict)

## 🚀 Deployment Process

### Automated Deployment (Recommended)

Push to `main` branch triggers automatic:
1. Linting & type checking
2. Build
3. Tests
4. Production deployment

### Manual Deployment

```bash
# Build everything
npm run build

# Deploy Worker (API)
npm run deploy:worker

# Deploy Pages (Frontend)
npm run deploy:pages

# Or deploy all at once
npm run deploy
```

## ✅ Verification

After deployment, verify everything works:

```bash
# Health check
curl https://api.base58fun.dev/health
# Should return { "status": "ok", "service": "base58fun-api", ... }

# Ping
curl https://api.base58fun.dev/health/ping
# Should return: pong

# Frontend
Visit https://base58fun.dev in browser
```

## 🔄 Continuous Deployment

GitHub Actions automatically:
- Runs tests on every PR
- Deploys to staging on `develop` branch
- Deploys to production on `main` branch
- Creates releases with tags

Configure secrets in GitHub repository settings:
- `CLOUDFLARE_API_TOKEN` - API token
- `CLOUDFLARE_ACCOUNT_ID` - Account ID

## 🛠️ Maintenance

### Scaling

Monitor usage in Cloudflare dashboard:
- Workers analytics
- D1 database performance
- KV namespace usage

### Backups

D1 databases auto-backup. For manual backup:

```bash
wrangler d1 backup create base58fun-prod
```

### Updates

To push updates to production:

```bash
# Master branch auto-deploys
# Or manually:
git push origin main
```

## 🚨 Troubleshooting

### Database Connection Fails

```bash
# Check database exists
wrangler d1 info base58fun-prod

# Run migrations again
wrangler d1 execute base58fun-prod \
  --file ./migrations/001_initial_schema.sql --remote
```

### Worker Deployment Fails

```bash
# Check authentication
wrangler whoami

# Re-authenticate
wrangler login

# Check account ID in wrangler.toml
wrangler publish --env production --dry-run
```

### GitHub OAuth Not Working

1. Check Client ID and Secret are set correctly
2. Verify callback URL matches exactly
3. Check redirect URI in auth flow

### CORS Issues

Verify `CORS_ORIGIN` in `wrangler.toml` matches frontend URL.

## 📊 Monitoring

### Cloudflare Analytics

Monitor in Cloudflare Dashboard:
- **Workers** → Analytics & Logs
- **Database** → D1 performance metrics
- **KV** → Namespace usage
- **Pages** → Build & deployment logs

### Error Tracking

Workers logs:
```bash
wrangler tail --env production
```

## 🔐 Security Checklist

- [ ] JWT_SECRET is strong (32+ chars)
- [ ] GitHub OAuth secrets are set
- [ ] CORS origins are restricted
- [ ] D1 database encryption enabled
- [ ] KV namespaces are private
- [ ] No sensitive data in logs
- [ ] API rate limiting enabled
- [ ] Input validation on all endpoints

## 🎯 Post-Deployment

1. Update DNS records if new domain
2. Update GitHub OAuth callback URLs
3. Test all authentication flows
4. Verify transaction building works
5. Monitor error logs for 24 hours
6. Announce updates to community

## 📞 Support

For deployment issues:
- Check Cloudflare status page
- Review Worker logs
- Check D1 query errors
- Open GitHub issue

