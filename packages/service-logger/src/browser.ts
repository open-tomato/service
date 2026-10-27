/**
 * @module browser
 * Browser entry point for `@open-tomato/service-logger`. Provides structured logging
 * via `pino/browser` without pulling in any Node.js-only dependencies.
 * This module is resolved automatically when bundlers honour the `browser`
 * export condition defined in `package.json`.
 */
import type { Logger, LoggerOptions, LogLevel } from './types.js';

import pino from 'pino/browser';

/**
 * Create a named browser-safe pino logger bound to the given service name.
 *
 * The logger uses `pino/browser` with `asObject: true` so that log entries are
 * emitted as plain objects to `console.*` methods, making them easy to inspect
 * in browser DevTools.
 *
 * **Note:** `base` bindings are not supported by `pino/browser`; instead a
 * child logger is created immediately with `{ service: name, ...context }` so
 * that every log entry carries the service identifier.
 *
 * @param name - Service identifier attached to every log entry as `service`.
 * @param options - Optional configuration overrides (level, context).
 *   The `pretty` option is not applicable in the browser entry.
 * @returns A {@link Logger} instance configured for browser output.
 *
 * @example
 * ```ts
 * const logger = createLogger('my-app', { level: 'debug' });
 * logger.info({ page: '/home' }, 'page viewed');
 * ```
 */
export function createLogger(name: string, options?: LoggerOptions): Logger {
  const envLevel = typeof process !== 'undefined'
    ? (process.env['LOG_LEVEL'] as LogLevel | undefined)
    : undefined;
  const level: LogLevel = options?.level ?? envLevel ?? 'info';

  return pino({
    level,
    browser: { asObject: true },
  }).child({ service: name, ...options?.context }) as unknown as Logger;
}

export type { Logger, LogLevel, LogContext, LoggerOptions } from './types.js';
