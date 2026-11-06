/**
 * @module node
 * Node.js entry point for `@open-tomato/service-logger`. Provides structured pino
 * logging and pino-http middleware suited for server-side services and MCPs.
 * Do not import this module from browser bundles — use the `browser` entry
 * instead (resolved automatically via the `browser` export condition).
 */
import type { Decorator } from './decorators.js';
import type { Logger, LoggerOptions, LogDestination, LogFormat, LogLevel, HttpLoggerOptions } from './types.js';

import { randomUUID } from 'node:crypto';
import process from 'node:process';

import { isTraceId, TRACE_ID_FIELD } from '@open-tomato/service';
import pino from 'pino';
import { pinoHttp } from 'pino-http';

import { terminal } from './decorators.js';

/** The values `LOG_FORMAT` may hold; any other value is ignored. */
const LOG_FORMATS: ReadonlySet<string> = new Set<LogFormat>(['terminal', 'json']);

function isLogFormat(value: string | undefined): value is LogFormat {
  return value !== undefined && LOG_FORMATS.has(value);
}

/** The process stream a destination names, looked up when called. */
function streamFor(destination: LogDestination): typeof process.stdout | typeof process.stderr {
  return destination === 'stderr'
    ? process.stderr
    : process.stdout;
}

/**
 * Pick the format: the `format` option, then `LOG_FORMAT`, then the legacy
 * `pretty` option, then whether the chosen destination is a TTY.
 */
function pickFormat(options: LoggerOptions | undefined, destination: LogDestination): LogFormat {
  if (options?.format !== undefined) return options.format;
  const fromEnv = process.env['LOG_FORMAT'];
  if (isLogFormat(fromEnv)) return fromEnv;
  if (options?.pretty !== undefined) {
    return options.pretty
      ? 'terminal'
      : 'json';
  }
  return streamFor(destination).isTTY === true
    ? 'terminal'
    : 'json';
}

/**
 * A synchronous stream that writes each pino line to the destination,
 * through the terminal decorator for `terminal` and unchanged for `json`.
 * The process stream and its `write` are looked up on every write, so a
 * later swap of `process.stdout.write` or `process.stderr.write` is honoured.
 */
function destinationStream(format: LogFormat, destination: LogDestination): pino.DestinationStream {
  const decorate: Decorator | undefined = format === 'terminal'
    ? terminal
    : undefined;
  return {
    write: (line: string) => {
      streamFor(destination).write(decorate === undefined
        ? line
        : decorate(line));
    },
  };
}

/**
 * Create a named pino logger bound to the given service name.
 *
 * @param name - Service identifier attached to every log entry as `service`.
 * @param options - Optional configuration overrides (level, context, format,
 *   destination).
 * @returns A {@link Logger} instance configured for Node.js output.
 *
 * @example
 * ```ts
 * const logger = createLogger('my-service', { level: 'debug', format: 'json' });
 * logger.info({ requestId: '123' }, 'handling request');
 * ```
 */
export function createLogger(name: string, options?: LoggerOptions): Logger {
  const level: LogLevel = options?.level ?? (process.env['LOG_LEVEL'] as LogLevel) ?? 'info';
  const pinoOptions: pino.LoggerOptions = {
    level,
    base: { service: name, ...options?.context },
    serializers: { err: pino.stdSerializers.errWithCause },
  };
  const destination: LogDestination = options?.destination ?? 'stdout';
  const channel = destinationStream(pickFormat(options, destination), destination);

  return pino(pinoOptions, channel) as unknown as Logger;
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
 * **Trace-id propagation:** The middleware takes the `x-request-id` header as
 * the request id when `isTraceId` from `@open-tomato/service` accepts it
 * (`[A-Za-z0-9._:-]{1,64}`); otherwise it generates a `crypto.randomUUID()`
 * value. The id is exposed as `req.id`, and `req.log` binds only that id, as
 * `traceId` (`quietReqLogger`), so a crumb logged through it carries no `req`.
 * The completion line carries `req`, `res` and `responseTime` under the same
 * `traceId`.
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
    genReqId: (req) => {
      const header = req.headers['x-request-id'];
      return isTraceId(header)
        ? header
        : randomUUID();
    },
    quietReqLogger: true,
    customAttributeKeys: { reqId: TRACE_ID_FIELD },
    autoLogging: { ignore: (req) => ignoreRoutes.some((r) => (req.url ?? '').startsWith(r)) },
  });
}

export type { Logger, LogLevel, LogContext, LogDestination, LogFormat, LoggerOptions, HttpLoggerOptions } from './types.js';
