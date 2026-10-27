/**
 * @module types
 * Shared type definitions for `@open-tomato/service-logger`. This module contains
 * only type exports and zero runtime code, making it safe to import from
 * both the node and browser entries without side effects or bundle bloat.
 */

/**
 * Supported log severity levels, matching pino's level names.
 * Use `'silent'` to suppress all output.
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

/**
 * Arbitrary structured key-value pairs that can be attached to log entries
 * as contextual metadata (e.g. `requestId`, `userId`, `tenantId`).
 */
export type LogContext = Record<string, unknown>;

/**
 * Minimal structured logger interface implemented by both the node and browser
 * entries. Mirrors the pino logger API surface used across the monorepo so
 * consumers can reference this type without depending on pino directly.
 */
export interface Logger {
  /** Log a message at `trace` level with an optional structured object. */
  trace(obj: object, msg?: string): void
  /** Log a plain message at `trace` level. */
  trace(msg: string): void
  /** Log a message at `debug` level with an optional structured object. */
  debug(obj: object, msg?: string): void
  /** Log a plain message at `debug` level. */
  debug(msg: string): void
  /** Log a message at `info` level with an optional structured object. */
  info(obj: object, msg?: string): void
  /** Log a plain message at `info` level. */
  info(msg: string): void
  /** Log a message at `warn` level with an optional structured object. */
  warn(obj: object, msg?: string): void
  /** Log a plain message at `warn` level. */
  warn(msg: string): void
  /** Log a message at `error` level with an optional structured object. */
  error(obj: object, msg?: string): void
  /** Log a plain message at `error` level. */
  error(msg: string): void
  /** Log a message at `fatal` level with an optional structured object. */
  fatal(obj: object, msg?: string): void
  /** Log a plain message at `fatal` level. */
  fatal(msg: string): void
  /**
   * Create a child logger that inherits the current logger's settings and
   * merges the provided `bindings` into every log entry it produces.
   */
  child(bindings: Record<string, unknown>): Logger
  /** The active minimum log level; entries below this level are suppressed. */
  level: LogLevel
}

/**
 * Options accepted by {@link createLogger} to customise the logger instance.
 */
export interface LoggerOptions {
  /**
   * Minimum log level. Defaults to the `LOG_LEVEL` environment variable when
   * present, otherwise falls back to `'info'`.
   */
  level?: LogLevel
  /**
   * Static key-value pairs merged into the `base` bindings of every log entry
   * produced by this logger (e.g. `{ env: 'production', region: 'eu-west-1' }`).
   */
  context?: LogContext
  /**
   * Enable human-readable `pino-pretty` output. Defaults to `true` when
   * `NODE_ENV === 'development'`. Has no effect in the browser entry.
   */
  pretty?: boolean
}

/**
 * Options accepted by {@link createHttpLogger} to customise the pino-http
 * middleware instance.
 */
export interface HttpLoggerOptions {
  /**
   * An existing {@link Logger} instance to use as the underlying pino logger.
   * When omitted, pino-http creates its own logger using default settings.
   */
  logger?: Logger
  /**
   * Additional field paths to redact from request/response log entries (merged
   * with the default set: `authorization`, `cookie`, and `x-api-key` headers).
   * Supports the same path syntax as pino's `redact` option.
   */
  redact?: string[]
  /**
   * URL path prefixes for which HTTP logging is skipped entirely. Merged with
   * the default ignore list: `['/_health', '/_control']`.
   */
  ignoreRoutes?: string[]
}
