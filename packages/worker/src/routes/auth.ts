import { Hono } from 'hono'
import { generateJWT, verifyJWT } from '../services/jwt'
import { authMiddleware } from '../middleware/auth'
import { authRateLimit } from '../middleware/rate-limit'

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

function getCurrentTimestamp(): string {
  return new Date().toISOString()
}

type Env = {
  Variables: Record<string, unknown>
  Bindings: {
    DB: any
    GITHUB_OAUTH_ID: string
    GITHUB_OAUTH_SECRET: string
    JWT_SECRET: string
    FRONTEND_URL: string
    API_BASE_URL: string
  }
}

const app = new Hono<Env>()

// GitHub OAuth - Start login
app.get('/github', authRateLimit, (c) => {
  const clientId = c.env?.GITHUB_OAUTH_ID || ''
  const redirectUri = `${c.env?.API_BASE_URL || 'http://localhost:8787'}/auth/github/callback`
  const scope = 'user:email read:user'

  const authUrl = new URL('https://github.com/login/oauth/authorize')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', scope)
  authUrl.searchParams.set('allow_signup', 'true')

  return c.redirect(authUrl.toString())
})

// GitHub OAuth - Callback handler (GET from GitHub redirect)
app.get('/github/callback', async (c) => {
  const code = c.req.query('code')

  if (!code) {
    return c.redirect(`${c.env?.FRONTEND_URL || 'http://localhost:5173'}/auth/error?message=No+code+provided`)
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: c.env?.GITHUB_OAUTH_ID,
        client_secret: c.env?.GITHUB_OAUTH_SECRET,
        code,
      }),
    })

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string
      error?: string
      error_description?: string
    }

    if (tokenData.error || !tokenData.access_token) {
      return c.redirect(
        `${c.env?.FRONTEND_URL || 'http://localhost:5173'}/auth/error?message=${encodeURIComponent(tokenData.error_description || 'Failed to get access token')}`
      )
    }

    // Fetch user info from GitHub
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/json',
        'User-Agent': 'orquestra',
      },
    })

    const githubUser = (await userResponse.json()) as {
      id: number
      login: string
      email: string | null
      avatar_url: string
      name: string | null
    }

    // Fetch primary email if not available
    let email = githubUser.email
    if (!email) {
      const emailResponse = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/json',
          'User-Agent': 'orquestra',
        },
      })
      const emails = (await emailResponse.json()) as Array<{
        email: string
        primary: boolean
        verified: boolean
      }>
      const primary = emails.find((e) => e.primary && e.verified)
      email = primary?.email || emails[0]?.email || `${githubUser.login}@users.noreply.github.com`
    }

    // Upsert user in database
    const db = c.env?.DB
    let user = await db
      ?.prepare('SELECT * FROM users WHERE github_id = ?')
      .bind(githubUser.id)
      .first()

    if (!user) {
      const userId = generateId()
      await db
        ?.prepare(
          'INSERT INTO users (id, github_id, username, email, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(userId, githubUser.id, githubUser.login, email, githubUser.avatar_url, getCurrentTimestamp(), getCurrentTimestamp())
        .run()

      user = {
        id: userId,
        github_id: githubUser.id,
        username: githubUser.login,
        email,
        avatar_url: githubUser.avatar_url,
      }
    } else {
      // Update existing user info
      await db
        ?.prepare('UPDATE users SET username = ?, email = ?, avatar_url = ?, updated_at = ? WHERE github_id = ?')
        .bind(githubUser.login, email, githubUser.avatar_url, getCurrentTimestamp(), githubUser.id)
        .run()
    }

    // Generate JWT
    const jwt = await generateJWT(
      { sub: user.id as string, username: user.username as string },
      c.env?.JWT_SECRET || 'dev-secret',
      7 * 24 * 60 * 60 // 7 days
    )

    // Redirect to frontend with token
    const frontendUrl = c.env?.FRONTEND_URL || 'http://localhost:5173'
    return c.redirect(`${frontendUrl}/auth/callback?token=${jwt}`)
  } catch (err) {
    console.error('GitHub OAuth error:', err)
    return c.redirect(
      `${c.env?.FRONTEND_URL || 'http://localhost:5173'}/auth/error?message=${encodeURIComponent('Authentication failed')}`
    )
  }
})

// POST callback for API clients
app.post('/github/callback', async (c) => {
  const body = await c.req.json<{ code: string }>()

  if (!body.code) {
    return c.json({ error: 'Missing code parameter' }, 400)
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: c.env?.GITHUB_OAUTH_ID,
        client_secret: c.env?.GITHUB_OAUTH_SECRET,
        code: body.code,
      }),
    })

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string
      error?: string
      error_description?: string
    }

    if (tokenData.error || !tokenData.access_token) {
      return c.json({ error: tokenData.error_description || 'Failed to get access token' }, 400)
    }

    // Fetch user info
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/json',
        'User-Agent': 'orquestra',
      },
    })

    const githubUser = (await userResponse.json()) as {
      id: number
      login: string
      email: string | null
      avatar_url: string
    }

    // Upsert user
    const db = c.env?.DB
    let user = await db?.prepare('SELECT * FROM users WHERE github_id = ?').bind(githubUser.id).first()

    if (!user) {
      const userId = generateId()
      await db
        ?.prepare(
          'INSERT INTO users (id, github_id, username, email, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(userId, githubUser.id, githubUser.login, githubUser.email || '', githubUser.avatar_url, getCurrentTimestamp(), getCurrentTimestamp())
        .run()

      user = { id: userId, github_id: githubUser.id, username: githubUser.login, email: githubUser.email, avatar_url: githubUser.avatar_url }
    }

    const jwt = await generateJWT(
      { sub: user.id as string, username: user.username as string },
      c.env?.JWT_SECRET || 'dev-secret',
      7 * 24 * 60 * 60
    )

    return c.json({
      token: jwt,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar_url: user.avatar_url,
      },
    })
  } catch (err) {
    console.error('GitHub OAuth error:', err)
    return c.json({ error: 'Authentication failed' }, 500)
  }
})

// Get current user profile
app.get('/me', authMiddleware, async (c) => {
  const userId = c.get('userId') as string
  const db = c.env?.DB

  const user = await db?.prepare('SELECT id, username, email, avatar_url, created_at FROM users WHERE id = ?').bind(userId).first()

  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }

  // Get user's project count
  const projectCount = await db
    ?.prepare('SELECT COUNT(*) as count FROM projects WHERE user_id = ?')
    .bind(userId)
    .first()

  return c.json({
    user: {
      ...user,
      projectCount: (projectCount as any)?.count || 0,
    },
  })
})

// Logout (client-side token removal, server just acknowledges)
app.post('/logout', (c) => {
  return c.json({ message: 'Logged out successfully' })
})

export default app
