/**
 * @module node
 * Node.js entry point for `@open-tomato/service-logger`. Provides structured pino
 * logging and pino-http middleware suited for server-side services and MCPs.
 * Do not import this module from browser bundles — use the `browser` entry
 * instead (resolved automatically via the `browser` export condition).
 */
import type { Logger, LoggerOptions, LogLevel, HttpLoggerOptions } from './types.js';

import { randomUUID } from 'node:crypto';
import process from 'node:process';

import pino from 'pino';
import { pinoHttp } from 'pino-http';

/**
 * Create a named pino logger bound to the given service name.
 *
 * @param name - Service identifier attached to every log entry as `service`.
 * @param options - Optional configuration overrides (level, context, pretty).
 * @returns A {@link Logger} instance configured for Node.js output.
 *
 * @example
 * ```ts
 * const logger = createLogger('my-service', { level: 'debug' });
 * logger.info({ requestId: '123' }, 'handling request');
 * ```
 */
export function createLogger(name: string, options?: LoggerOptions): Logger {
  const level: LogLevel = options?.level ?? (process.env['LOG_LEVEL'] as LogLevel) ?? 'info';
  const pretty = options?.pretty ?? process.env['NODE_ENV'] === 'development';

  return pino({
    level,
    transport: pretty
      ? { target: 'pino-pretty' }
      : undefined,
    base: { service: name, ...options?.context },
  }) as unknown as Logger;
}

/** Header paths redacted from HTTP log entries by default. */
const DEFAULT_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
];

/** URL prefixes for which HTTP request/response logging is skipped by default. */
const DEFAULT_IGNORE_ROUTES = ['/_health', '/_control'];

/**
 * Create a pino-http Express/Connect middleware that logs incoming requests and
 * outgoing responses.
 *
 * **Request-id propagation:** The middleware reads the `x-request-id` header and
 * uses it as the request id; if absent, a `crypto.randomUUID()` value is
 * generated. The id is exposed as `req.id` and merged into the child logger
 * attached at `req.log`.
 *
 * **Redaction:** Sensitive headers (`authorization`, `cookie`, `x-api-key`) are
 * redacted by default. Additional paths can be passed via `options.redact` or
 * the `LOG_REDACT` environment variable (comma-separated list).
 *
 * **Route ignoring:** Requests to `/_health` and `/_control` are silently
 * skipped. Supply `options.ignoreRoutes` to extend this list.
 *
 * @param options - Optional configuration overrides.
 * @returns A pino-http middleware function compatible with Express.
 *
 * @example
 * ```ts
 * app.use(createHttpLogger({ ignoreRoutes: ['/metrics'] }));
 * ```
 */
export function createHttpLogger(options?: HttpLoggerOptions) {
  const envRedact = process.env['LOG_REDACT']
    ? process.env['LOG_REDACT'].split(',')
    : [];
  const optionsRedact = options?.redact ?? [];
  const ignoreRoutes = options?.ignoreRoutes
    ? [...DEFAULT_IGNORE_ROUTES, ...options.ignoreRoutes]
    : DEFAULT_IGNORE_ROUTES;

  return pinoHttp({
    logger: options?.logger as pino.Logger | undefined,
    redact: [...DEFAULT_REDACT_PATHS, ...optionsRedact, ...envRedact],
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    customProps: (req) => ({ requestId: (req as { id?: string }).id }),
    autoLogging: { ignore: (req) => ignoreRoutes.some((r) => (req.url ?? '').startsWith(r)) },
  });
}

export type { Logger, LogLevel, LogContext, LoggerOptions, HttpLoggerOptions } from './types.js';
