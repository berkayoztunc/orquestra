import { Context, Next } from 'hono'
import { verifyJWT, type JWTPayload } from '../services/jwt'

/**
 * Authentication middleware - validates JWT token from Authorization header
 * Sets user info on context variables if valid
 */
export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' }, 401)
  }

  const token = authHeader.slice(7)

  try {
    const jwtSecret = c.env?.JWT_SECRET
    if (!jwtSecret) {
      return c.json({ error: 'Server configuration error' }, 500)
    }

    const payload = await verifyJWT(token, jwtSecret)
    c.set('userId', payload.sub)
    c.set('username', payload.username)
    c.set('jwtPayload', payload)

    await next()
  } catch (err) {
    return c.json({ error: 'Unauthorized', message: 'Invalid or expired token' }, 401)
  }
}

/**
 * Optional auth middleware - doesn't fail if no token,
 * but sets user info if token is present and valid
 */
export async function optionalAuthMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    try {
      const jwtSecret = c.env?.JWT_SECRET
      if (jwtSecret) {
        const payload = await verifyJWT(token, jwtSecret)
        c.set('userId', payload.sub)
        c.set('username', payload.username)
        c.set('jwtPayload', payload)
      }
    } catch {
      // Silently ignore invalid tokens for optional auth
    }
  }

  await next()
}

/**
 * Ingest key middleware — service-to-service auth for the CLI ingest endpoint.
 * Validates the X-Ingest-Key header against the INGEST_API_KEY Worker secret.
 * Does NOT require a user session or project-scoped API key.
 */
export async function ingestKeyMiddleware(c: Context, next: Next) {
  const ingestKey = c.req.header('X-Ingest-Key')

  if (!ingestKey) {
    return c.json({ error: 'Unauthorized', message: 'Missing X-Ingest-Key header' }, 401)
  }

  const expectedKey = c.env?.INGEST_API_KEY
  if (!expectedKey) {
    return c.json({ error: 'Server configuration error', message: 'INGEST_API_KEY not configured' }, 500)
  }

  // Constant-time comparison to prevent timing attacks
  if (ingestKey.length !== expectedKey.length || ingestKey !== expectedKey) {
    return c.json({ error: 'Unauthorized', message: 'Invalid ingest key' }, 401)
  }

  await next()
}

/**
 * API key authentication middleware
 * Checks X-API-Key header against database
 */
export async function apiKeyMiddleware(c: Context, next: Next) {
  const apiKey = c.req.header('X-API-Key')

  if (!apiKey) {
    return c.json({ error: 'Unauthorized', message: 'Missing X-API-Key header' }, 401)
  }

  try {
    const db = c.env?.DB
    if (!db) {
      return c.json({ error: 'Server configuration error' }, 500)
    }

    const result = await db
      .prepare(
        `SELECT ak.*, p.user_id, p.name as project_name 
         FROM api_keys ak 
         JOIN projects p ON ak.project_id = p.id 
         WHERE ak.key = ? AND (ak.expires_at IS NULL OR ak.expires_at > datetime('now'))`
      )
      .bind(apiKey)
      .first()

    if (!result) {
      return c.json({ error: 'Unauthorized', message: 'Invalid or expired API key' }, 401)
    }

    // Update last_used timestamp
    await db
      .prepare('UPDATE api_keys SET last_used = datetime(\'now\') WHERE key = ?')
      .bind(apiKey)
      .run()

    c.set('apiKeyProjectId', result.project_id)
    c.set('apiKeyUserId', result.user_id)

    await next()
  } catch (err) {
    return c.json({ error: 'Authentication failed' }, 500)
  }
}
