import { Context, Hono } from 'hono'

type Env = {
  Variables: Record<string, unknown>
  Bindings: {
    DB: any
    FRONTEND_URL: string
    API_BASE_URL: string
  }
}

const app = new Hono<Env>()

function issuerOrigin(requestUrl: string, apiBaseUrl?: string): string {
  return apiBaseUrl || new URL(requestUrl).origin
}

function frontendOrigin(requestUrl: string, frontendUrl?: string): string {
  return frontendUrl || new URL(requestUrl).origin
}

function authServerMetadata(c: Context<Env>) {
  const issuer = issuerOrigin(c.req.url, c.env.API_BASE_URL)
  return {
    issuer,
    authorization_endpoint: `${issuer}/auth/github`,
    token_endpoint: `${issuer}/auth/github/callback`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    grant_types_supported: ['authorization_code'],
    response_types_supported: ['code'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['read:user', 'user:email'],
    code_challenge_methods_supported: [],
    service_documentation: `${frontendOrigin(c.req.url, c.env.FRONTEND_URL)}/docs/api`,
  }
}

app.get('/.well-known/openid-configuration', (c) => {
  return c.json(authServerMetadata(c), 200, {
    'Cache-Control': 'public, max-age=3600',
  })
})

app.get('/.well-known/oauth-authorization-server', (c) => {
  return c.json(authServerMetadata(c), 200, {
    'Cache-Control': 'public, max-age=3600',
  })
})

app.get('/.well-known/jwks.json', (c) => {
  return c.json({ keys: [] }, 200, {
    'Cache-Control': 'public, max-age=3600',
  })
})

app.get('/.well-known/oauth-protected-resource', (c) => {
  const issuer = issuerOrigin(c.req.url, c.env.API_BASE_URL)
  const frontend = frontendOrigin(c.req.url, c.env.FRONTEND_URL)

  return c.json(
    {
      resource: `${issuer}/api`,
      authorization_servers: [issuer],
      scopes_supported: ['read:user', 'user:email'],
      bearer_methods_supported: ['header'],
      resource_name: 'Orquestra API',
      resource_documentation: `${frontend}/docs/api`,
    },
    200,
    {
      'Cache-Control': 'public, max-age=3600',
    },
  )
})

app.get('/openapi.json', (c) => {
  const serverUrl = issuerOrigin(c.req.url, c.env.API_BASE_URL)
  const docsUrl = `${frontendOrigin(c.req.url, c.env.FRONTEND_URL)}/docs/api`

  return c.json(
    {
      openapi: '3.1.0',
      info: {
        title: 'Orquestra API',
        version: '1.0.0',
        description:
          'Public API for Orquestra program discovery, IDL-backed instruction introspection, PDA derivation, and transaction building.',
      },
      servers: [{ url: serverUrl }],
      externalDocs: {
        description: 'Human-readable API docs',
        url: docsUrl,
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
          apiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
          },
        },
      },
      paths: {
        '/health': {
          get: {
            summary: 'Health check',
            responses: {
              '200': {
                description: 'Service health payload',
              },
            },
          },
        },
        '/api/projects': {
          get: {
            summary: 'List public projects',
            parameters: [
              {
                name: 'page',
                in: 'query',
                schema: { type: 'integer', minimum: 1, default: 1 },
              },
              {
                name: 'limit',
                in: 'query',
                schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
              },
              {
                name: 'search',
                in: 'query',
                schema: { type: 'string', maxLength: 100 },
              },
            ],
            responses: {
              '200': {
                description: 'Paged project list',
              },
            },
          },
        },
        '/api/projects/by-program/{programId}': {
          get: {
            summary: 'Get a project by Solana program id',
            parameters: [
              {
                name: 'programId',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description: 'Project details',
              },
              '404': {
                description: 'Project not found',
              },
            },
          },
        },
        '/api/{projectId}/instructions': {
          get: {
            summary: 'List instructions for a project',
            parameters: [
              {
                name: 'projectId',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description: 'Instruction list',
              },
            },
          },
        },
        '/api/{projectId}/instructions/{instructionName}/build': {
          post: {
            summary: 'Build an unsigned Solana transaction',
            parameters: [
              {
                name: 'projectId',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
              {
                name: 'instructionName',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['accounts', 'args', 'feePayer'],
                    properties: {
                      accounts: {
                        type: 'object',
                        additionalProperties: { type: 'string' },
                      },
                      args: {
                        type: 'object',
                        additionalProperties: true,
                      },
                      feePayer: { type: 'string' },
                      recentBlockhash: { type: 'string' },
                      network: {
                        type: 'string',
                        enum: ['mainnet-beta', 'devnet', 'testnet'],
                      },
                      rpcUrl: { type: 'string', format: 'uri' },
                      simulate: { type: 'boolean' },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Unsigned transaction payload',
              },
            },
            security: [{ apiKeyAuth: [] }],
          },
        },
        '/api/{projectId}/pda': {
          get: {
            summary: 'List PDA-derivable accounts for a project',
            parameters: [
              {
                name: 'projectId',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description: 'PDA account definitions',
              },
            },
          },
        },
        '/mcp': {
          post: {
            summary: 'Streamable HTTP MCP endpoint',
            responses: {
              '200': {
                description: 'MCP response stream',
              },
            },
          },
        },
      },
    },
    200,
    {
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'application/openapi+json; charset=utf-8',
    },
  )
})

app.get('/api/discovery/sitemap', async (c) => {
  const db = c.env.DB

  const results = await db
    .prepare('SELECT program_id, updated_at FROM projects WHERE is_public = 1 ORDER BY updated_at DESC')
    .all()

  return c.json(
    {
      entries: (results?.results || []).map((row: any) => ({
        programId: row.program_id,
        lastmod: row.updated_at,
      })),
      generatedAt: new Date().toISOString(),
    },
    200,
    {
      'Cache-Control': 'public, max-age=300',
    },
  )
})

export default app