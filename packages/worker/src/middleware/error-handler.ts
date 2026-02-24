import { Context, Next } from 'hono'

/**
 * Structured API error class for consistent error responses
 */
export class APIError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'APIError'
  }
}

/**
 * Global error handler middleware.
 * Catches unhandled errors and returns consistent JSON error responses.
 */
export async function errorHandler(c: Context, next: Next) {
  try {
    await next()
  } catch (err) {
    if (err instanceof APIError) {
      return c.json(
        {
          error: err.message,
          code: err.code,
          details: err.details,
        },
        err.statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500,
      )
    }

    // Log unexpected errors
    console.error('Unhandled error:', err)

    const message = err instanceof Error ? err.message : 'Internal Server Error'
    return c.json(
      {
        error: 'Internal Server Error',
        message: undefined, // Never leak internal error messages
      },
      500,
    )
  }
}

// ----- Error factory helpers -----

export function badRequest(message: string, details?: unknown): APIError {
  return new APIError(400, message, 'BAD_REQUEST', details)
}

export function unauthorized(message = 'Unauthorized'): APIError {
  return new APIError(401, message, 'UNAUTHORIZED')
}

export function forbidden(message = 'Forbidden'): APIError {
  return new APIError(403, message, 'FORBIDDEN')
}

export function notFound(resource = 'Resource'): APIError {
  return new APIError(404, `${resource} not found`, 'NOT_FOUND')
}

export function conflict(message: string): APIError {
  return new APIError(409, message, 'CONFLICT')
}

export function validationError(errors: Array<{ field: string; message: string }>): APIError {
  return new APIError(422, 'Validation failed', 'VALIDATION_ERROR', { errors })
}

export function tooManyRequests(retryAfter: number): APIError {
  return new APIError(429, `Rate limit exceeded. Try again in ${retryAfter} seconds.`, 'RATE_LIMIT_EXCEEDED', { retryAfter })
}

export function internalError(message = 'Internal Server Error'): APIError {
  return new APIError(500, message, 'INTERNAL_ERROR')
}
