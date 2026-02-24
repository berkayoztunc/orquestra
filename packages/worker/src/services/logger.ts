/**
 * Structured logging service for Cloudflare Workers.
 *
 * Outputs JSON-formatted log entries via console so they integrate
 * with Cloudflare's built-in log pipeline.
 *
 * Usage:
 *   import { createLogger } from '../services/logger'
 *   const log = createLogger('idl-parser')
 *   log.info('IDL parsed successfully', { projectId: '123', instructionCount: 5 })
 *   log.error('Failed to parse IDL', { projectId: '123' }, error)
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

export interface LogEntry {
  timestamp: string
  level: LogLevel
  service: string
  message: string
  context?: Record<string, unknown>
  error?: {
    message: string
    name: string
    stack?: string
  }
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>, error?: unknown): void
  error(message: string, context?: Record<string, unknown>, error?: unknown): void
}

/** Minimum level that will be emitted. Defaults to 'debug'. */
let globalMinLevel: LogLevel = 'debug'

/**
 * Set the minimum log level globally. Entries below this level are silently
 * dropped. Useful for suppressing debug output in production.
 */
export function setLogLevel(level: LogLevel): void {
  globalMinLevel = level
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[globalMinLevel]
}

function serializeError(err: unknown): LogEntry['error'] | undefined {
  if (err === undefined || err === null) return undefined

  if (err instanceof Error) {
    return {
      message: err.message,
      name: err.name,
      stack: err.stack,
    }
  }

  // Handle non-Error objects thrown as exceptions
  return {
    message: String(err),
    name: 'UnknownError',
  }
}

function emit(entry: LogEntry): void {
  const json = JSON.stringify(entry)

  switch (entry.level) {
    case 'error':
      console.error(json)
      break
    case 'warn':
      console.warn(json)
      break
    default:
      console.log(json)
      break
  }
}

function buildEntry(
  service: string,
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
  error?: unknown,
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    service,
    message,
  }

  if (context && Object.keys(context).length > 0) {
    entry.context = context
  }

  const serialized = serializeError(error)
  if (serialized) {
    entry.error = serialized
  }

  return entry
}

/**
 * Create a structured logger scoped to a specific service name.
 *
 * @param service - Logical service / module name (e.g. 'idl-parser', 'auth')
 */
export function createLogger(service: string): Logger {
  return {
    debug(message: string, context?: Record<string, unknown>): void {
      if (!shouldLog('debug')) return
      emit(buildEntry(service, 'debug', message, context))
    },

    info(message: string, context?: Record<string, unknown>): void {
      if (!shouldLog('info')) return
      emit(buildEntry(service, 'info', message, context))
    },

    warn(message: string, context?: Record<string, unknown>, error?: unknown): void {
      if (!shouldLog('warn')) return
      emit(buildEntry(service, 'warn', message, context, error))
    },

    error(message: string, context?: Record<string, unknown>, error?: unknown): void {
      if (!shouldLog('error')) return
      emit(buildEntry(service, 'error', message, context, error))
    },
  }
}

/** Pre-built logger for general / top-level use. */
export const logger = createLogger('worker')
