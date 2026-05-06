import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

async function generateScopeKey(): Promise<string> {
  const keyBytes = new Uint8Array(32)
  crypto.getRandomValues(keyBytes)
  return `sk_${Array.from(keyBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`
}

function getCurrentTimestamp(): string {
  return new Date().toISOString()
}

type Env = {
  Variables: Record<string, unknown>
  Bindings: {
    DB: any
    JWT_SECRET: string
  }
}

const app = new Hono<Env>()

// All list routes require authentication
app.use('*', authMiddleware)

// ── GET /api/lists ──────────────────────────────────────────────────────────
// Returns all lists for the authenticated user with item counts.

app.get('/', async (c) => {
  const userId = c.get('userId') as string
  const db = c.env.DB

  try {
    const { results } = await db
      .prepare(
        `SELECT pl.id, pl.name, pl.description, pl.is_default, pl.scope_key,
                pl.created_at, pl.updated_at,
                COUNT(pli.id) as item_count
         FROM program_lists pl
         LEFT JOIN program_list_items pli ON pli.list_id = pl.id
         WHERE pl.user_id = ?
         GROUP BY pl.id
         ORDER BY pl.is_default DESC, pl.created_at ASC`,
      )
      .bind(userId)
      .all()

    return c.json({ lists: results ?? [] })
  } catch {
    return c.json({ error: 'Failed to fetch lists' }, 500)
  }
})

// ── POST /api/lists ─────────────────────────────────────────────────────────
// Create a new list. Generates a scope key automatically.

app.post('/', async (c) => {
  const userId = c.get('userId') as string
  const db = c.env.DB

  let body: { name?: string; description?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const name = (body.name ?? '').trim()
  if (!name) {
    return c.json({ error: 'name is required' }, 400)
  }
  if (name.length > 100) {
    return c.json({ error: 'name must be 100 characters or less' }, 400)
  }

  const description = (body.description ?? '').trim() || null

  // Check if this will be the first list (auto-set as default)
  const existingCount = await db
    .prepare('SELECT COUNT(*) as count FROM program_lists WHERE user_id = ?')
    .bind(userId)
    .first()

  const isDefault = (existingCount?.count as number) === 0 ? 1 : 0

  const id = generateId()
  const scopeKey = await generateScopeKey()
  const now = getCurrentTimestamp()

  try {
    await db
      .prepare(
        `INSERT INTO program_lists (id, user_id, name, description, is_default, scope_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, userId, name, description, isDefault, scopeKey, now, now)
      .run()

    return c.json(
      {
        list: {
          id,
          user_id: userId,
          name,
          description,
          is_default: isDefault === 1,
          scope_key: scopeKey,
          item_count: 0,
          created_at: now,
          updated_at: now,
        },
      },
      201,
    )
  } catch {
    return c.json({ error: 'Failed to create list' }, 500)
  }
})

// ── PUT /api/lists/:listId ──────────────────────────────────────────────────
// Rename / update description. Ownership verified.

app.put('/:listId', async (c) => {
  const userId = c.get('userId') as string
  const { listId } = c.req.param()
  const db = c.env.DB

  let body: { name?: string; description?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const existing = await db
    .prepare('SELECT id, name, description FROM program_lists WHERE id = ? AND user_id = ?')
    .bind(listId, userId)
    .first()

  if (!existing) {
    return c.json({ error: 'List not found' }, 404)
  }

  const name = (body.name ?? (existing.name as string)).trim()
  if (!name) {
    return c.json({ error: 'name cannot be empty' }, 400)
  }
  if (name.length > 100) {
    return c.json({ error: 'name must be 100 characters or less' }, 400)
  }

  const description =
    body.description !== undefined
      ? (body.description ?? '').trim() || null
      : (existing.description as string | null)

  const now = getCurrentTimestamp()

  await db
    .prepare(
      'UPDATE program_lists SET name = ?, description = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    )
    .bind(name, description, now, listId, userId)
    .run()

  return c.json({ success: true, name, description })
})

// ── DELETE /api/lists/:listId ───────────────────────────────────────────────
// Delete a list (cascades to items). Ownership verified.

app.delete('/:listId', async (c) => {
  const userId = c.get('userId') as string
  const { listId } = c.req.param()
  const db = c.env.DB

  const existing = await db
    .prepare('SELECT id FROM program_lists WHERE id = ? AND user_id = ?')
    .bind(listId, userId)
    .first()

  if (!existing) {
    return c.json({ error: 'List not found' }, 404)
  }

  await db.prepare('DELETE FROM program_lists WHERE id = ? AND user_id = ?').bind(listId, userId).run()

  return c.json({ success: true })
})

// ── GET /api/lists/:listId/items ────────────────────────────────────────────
// List programs in a list with project details.

app.get('/:listId/items', async (c) => {
  const userId = c.get('userId') as string
  const { listId } = c.req.param()
  const db = c.env.DB

  const list = await db
    .prepare('SELECT id FROM program_lists WHERE id = ? AND user_id = ?')
    .bind(listId, userId)
    .first()

  if (!list) {
    return c.json({ error: 'List not found' }, 404)
  }

  const { results } = await db
    .prepare(
      `SELECT pli.id as item_id, pli.added_at,
              p.id as project_id, p.name, p.description, p.program_id,
              p.is_public, p.updated_at, u.username, u.avatar_url
       FROM program_list_items pli
       JOIN projects p ON p.id = pli.project_id
       LEFT JOIN users u ON u.id = p.user_id
       WHERE pli.list_id = ?
       ORDER BY pli.added_at DESC`,
    )
    .bind(listId)
    .all()

  return c.json({ items: results ?? [] })
})

// ── POST /api/lists/default/items ───────────────────────────────────────────
// Add a program to the user's default list. Auto-creates "Default" list if needed.
// NOTE: This route must come before /:listId/items to avoid param collision.

app.post('/default/items', async (c) => {
  const userId = c.get('userId') as string
  const db = c.env.DB

  let body: { projectId?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { projectId } = body
  if (!projectId) {
    return c.json({ error: 'projectId is required' }, 400)
  }

  // Verify project exists and is accessible
  const project = await db
    .prepare('SELECT id FROM projects WHERE id = ? AND is_public = 1')
    .bind(projectId)
    .first()

  if (!project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  // Find or create the default list
  let defaultList = await db
    .prepare('SELECT id FROM program_lists WHERE user_id = ? AND is_default = 1')
    .bind(userId)
    .first()

  if (!defaultList) {
    const newId = generateId()
    const scopeKey = await generateScopeKey()
    const now = getCurrentTimestamp()
    await db
      .prepare(
        `INSERT INTO program_lists (id, user_id, name, description, is_default, scope_key, created_at, updated_at)
         VALUES (?, ?, 'Default', NULL, 1, ?, ?, ?)`,
      )
      .bind(newId, userId, scopeKey, now, now)
      .run()
    defaultList = { id: newId }
  }

  return addItemToList(c, db, defaultList.id as string, userId, projectId)
})

// ── POST /api/lists/:listId/items ───────────────────────────────────────────
// Add a program to a specific list. Ownership verified.

app.post('/:listId/items', async (c) => {
  const userId = c.get('userId') as string
  const { listId } = c.req.param()
  const db = c.env.DB

  let body: { projectId?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { projectId } = body
  if (!projectId) {
    return c.json({ error: 'projectId is required' }, 400)
  }

  const list = await db
    .prepare('SELECT id FROM program_lists WHERE id = ? AND user_id = ?')
    .bind(listId, userId)
    .first()

  if (!list) {
    return c.json({ error: 'List not found' }, 404)
  }

  // Verify project exists
  const project = await db.prepare('SELECT id FROM projects WHERE id = ?').bind(projectId).first()
  if (!project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  return addItemToList(c, db, listId, userId, projectId)
})

// ── DELETE /api/lists/:listId/items/:projectId ──────────────────────────────
// Remove a program from a list. Ownership verified.

app.delete('/:listId/items/:projectId', async (c) => {
  const userId = c.get('userId') as string
  const { listId, projectId } = c.req.param()
  const db = c.env.DB

  const list = await db
    .prepare('SELECT id FROM program_lists WHERE id = ? AND user_id = ?')
    .bind(listId, userId)
    .first()

  if (!list) {
    return c.json({ error: 'List not found' }, 404)
  }

  const result = await db
    .prepare('DELETE FROM program_list_items WHERE list_id = ? AND project_id = ?')
    .bind(listId, projectId)
    .run()

  if ((result.meta?.changes ?? 0) === 0) {
    return c.json({ error: 'Item not found in list' }, 404)
  }

  return c.json({ success: true })
})

// ── POST /api/lists/:listId/scope-key ───────────────────────────────────────
// Regenerate the scope key for a list. Invalidates the old key. Ownership verified.

app.post('/:listId/scope-key', async (c) => {
  const userId = c.get('userId') as string
  const { listId } = c.req.param()
  const db = c.env.DB

  const existing = await db
    .prepare('SELECT id FROM program_lists WHERE id = ? AND user_id = ?')
    .bind(listId, userId)
    .first()

  if (!existing) {
    return c.json({ error: 'List not found' }, 404)
  }

  const newScopeKey = await generateScopeKey()
  const now = getCurrentTimestamp()

  await db
    .prepare('UPDATE program_lists SET scope_key = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .bind(newScopeKey, now, listId, userId)
    .run()

  return c.json({ scope_key: newScopeKey })
})

// ── Shared helper ───────────────────────────────────────────────────────────

async function addItemToList(
  c: any,
  db: any,
  listId: string,
  _userId: string,
  projectId: string,
): Promise<Response> {
  // Check for duplicate
  const existing = await db
    .prepare('SELECT id FROM program_list_items WHERE list_id = ? AND project_id = ?')
    .bind(listId, projectId)
    .first()

  if (existing) {
    return c.json({ error: 'Program is already in this list' }, 409)
  }

  const id = generateId()
  const now = getCurrentTimestamp()

  await db
    .prepare(
      'INSERT INTO program_list_items (id, list_id, project_id, added_at) VALUES (?, ?, ?, ?)',
    )
    .bind(id, listId, projectId, now)
    .run()

  return c.json({ success: true, item_id: id, added_at: now }, 201)
}

export default app
