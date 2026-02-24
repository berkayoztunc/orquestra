/**
 * JWT Service - Token generation and validation using Web Crypto API
 * Compatible with Cloudflare Workers (no Node.js crypto needed)
 */

export interface JWTPayload {
  sub: string        // user ID
  username: string
  iat: number        // issued at
  exp: number        // expiration
}

const encoder = new TextEncoder()

/**
 * Create HMAC key from secret string
 */
async function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

/**
 * Base64URL encode
 */
function base64UrlEncode(data: Uint8Array | string): string {
  const str = typeof data === 'string' ? data : String.fromCharCode(...data)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/**
 * Base64URL decode
 */
function base64UrlDecode(str: string): string {
  str = str.replace(/-/g, '+').replace(/_/g, '/')
  while (str.length % 4) str += '='
  return atob(str)
}

/**
 * Generate a JWT token
 */
export async function generateJWT(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  secret: string,
  expiresInSeconds: number = 7 * 24 * 60 * 60 // 7 days default
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)

  const fullPayload: JWTPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  }

  const header = { alg: 'HS256', typ: 'JWT' }

  const headerEncoded = base64UrlEncode(JSON.stringify(header))
  const payloadEncoded = base64UrlEncode(JSON.stringify(fullPayload))

  const signingInput = `${headerEncoded}.${payloadEncoded}`

  const key = await getKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput))

  const signatureEncoded = base64UrlEncode(new Uint8Array(signature))

  return `${signingInput}.${signatureEncoded}`
}

/**
 * Verify and decode a JWT token
 */
export async function verifyJWT(token: string, secret: string): Promise<JWTPayload> {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid token format')
  }

  const [headerEncoded, payloadEncoded, signatureEncoded] = parts
  const signingInput = `${headerEncoded}.${payloadEncoded}`

  // Verify signature
  const key = await getKey(secret)
  const signatureStr = base64UrlDecode(signatureEncoded)
  const signatureBytes = new Uint8Array(signatureStr.length)
  for (let i = 0; i < signatureStr.length; i++) {
    signatureBytes[i] = signatureStr.charCodeAt(i)
  }

  const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(signingInput))
  if (!valid) {
    throw new Error('Invalid token signature')
  }

  // Decode payload
  const payload: JWTPayload = JSON.parse(base64UrlDecode(payloadEncoded))

  // Check expiration
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp && payload.exp < now) {
    throw new Error('Token expired')
  }

  return payload
}
