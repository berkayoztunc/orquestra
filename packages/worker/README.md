# Worker

Hono REST API backend running on Cloudflare Workers.

## API Endpoints

### Health
- `GET /health` - Health check
- `GET /health/ping` - Ping endpoint

### Authentication
- `GET /auth/github` - Start GitHub OAuth flow
- `POST /auth/github/callback` - Handle GitHub OAuth callback
- `POST /auth/logout` - Logout

### IDL Management
- `POST /api/idl/upload` - Upload new IDL
- `GET /api/idl/:projectId` - Get IDL by project
- `PUT /api/idl/:projectId` - Update IDL
- `DELETE /api/idl/:projectId` - Delete IDL

### API Access
- `GET /api/:projectId/instructions` - List all instructions
- `GET /api/:projectId/instructions/:name` - Get instruction details
- `POST /api/:projectId/instructions/:name/build` - Build transaction
- `GET /api/:projectId/accounts` - List account types
- `GET /api/:projectId/errors` - List error codes
- `GET /api/:projectId/events` - List events
- `GET /api/:projectId/docs` - Get Markdown documentation
- `GET /api/:projectId/idl` - Get raw IDL

## Development

```bash
npm run dev
```

Server runs on http://localhost:8787

## Deployment

```bash
npm run deploy
```

Deploys to Cloudflare Workers production environment.
