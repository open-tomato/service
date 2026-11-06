import { readEnv } from './env.js';

/** Log severity levels, in pino's names; `silent` writes nothing. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

/**
 * The structured logger the service stack writes through.
 *
 * It is the part of pino's API the stack uses, so a pino logger, a logger from
 * `@open-tomato/service-logger`, or {@link createConsoleLogger} all fit it.
 */
export interface Logger {
  trace(obj: object, msg?: string): void
  trace(msg: string): void
  debug(obj: object, msg?: string): void
  debug(msg: string): void
  info(obj: object, msg?: string): void
  info(msg: string): void
  warn(obj: object, msg?: string): void
  warn(msg: string): void
  error(obj: object, msg?: string): void
  error(msg: string): void
  fatal(obj: object, msg?: string): void
  fatal(msg: string): void
  /** A logger that adds `bindings` to every record it writes. */
  child(bindings: Record<string, unknown>): Logger
}

/** Where {@link createConsoleLogger} writes: the four `console` methods it calls. */
export interface LogSink {
  debug(...data: unknown[]): void
  info(...data: unknown[]): void
  warn(...data: unknown[]): void
  error(...data: unknown[]): void
}

/** Options for {@link createConsoleLogger}. */
export interface ConsoleLoggerOptions {
  /** The lowest level written. Defaults to `LOG_LEVEL`, then `info`. */
  level?: LogLevel
  /** Fields added to every record. */
  bindings?: Record<string, unknown>
  /** Where records go. Defaults to the global `console`. */
  sink?: LogSink
}

type WrittenLevel = Exclude<LogLevel, 'silent'>;

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60, silent: Infinity,
};

const SINK_METHOD: Readonly<Record<WrittenLevel, keyof LogSink>> = {
  trace: 'debug', debug: 'debug', info: 'info', warn: 'warn', error: 'error', fatal: 'error',
};

const WRITTEN_LEVELS = Object.keys(SINK_METHOD) as readonly WrittenLevel[];

function isLogLevel(value: string | undefined): value is LogLevel {
  return value !== undefined && Object.hasOwn(LEVEL_RANK, value);
}

/** The level `LOG_LEVEL` names, or `info` when it names none. */
function levelFromEnv(): LogLevel {
  const envLevel = readEnv('LOG_LEVEL');
  if (isLogLevel(envLevel)) return envLevel;
  return 'info';
}

function defaultSink(): LogSink {
  return (globalThis as unknown as { readonly console: LogSink }).console;
}

/** Turns the `(obj, msg?)` or `(msg)` call shape into the fields and the message. */
function splitArgs(objOrMsg: object | string, msg?: string): { fields: object, message?: string } {
  if (typeof objOrMsg === 'string') return { fields: {}, message: objOrMsg };
  if (objOrMsg instanceof Error) return { fields: { err: objOrMsg }, message: msg };
  return { fields: objOrMsg, message: msg };
}

/**
 * Creates a logger that writes through `console`, with no dependency.
 *
 * It is the default where no logger is passed in, and it runs anywhere a
 * `console` exists. Each record is written as the message, then an object
 * holding the level, the service name, the bindings and the call's fields;
 * an `Error` passed as the object goes under `err`.
 *
 * @param name - The service name, written as `service` on every record.
 * @param options - The level, extra bindings and sink.
 * @returns A {@link Logger}.
 *
 * @example
 * ```ts
 * const logger = createConsoleLogger('orders', { level: 'debug' });
 * logger.info({ orderId: 'o-1' }, 'order created');
 * // console.info('order created', { level: 'info', service: 'orders', orderId: 'o-1' })
 * ```
 */
export function createConsoleLogger(name: string, options: ConsoleLoggerOptions = {}): Logger {
  const level = options.level ?? levelFromEnv();
  const sink = options.sink ?? defaultSink();
  const bindings = options.bindings ?? {};

  const write = (recordLevel: WrittenLevel, objOrMsg: object | string, msg?: string): void => {
    if (LEVEL_RANK[recordLevel] < LEVEL_RANK[level]) return;
    const { fields, message } = splitArgs(objOrMsg, msg);
    const record = { level: recordLevel, service: name, ...bindings, ...fields };
    const method = SINK_METHOD[recordLevel];
    if (message === undefined) sink[method](record);
    else sink[method](message, record);
  };

  const methods = Object.fromEntries(WRITTEN_LEVELS.map(recordLevel => [
    recordLevel,
    (objOrMsg: object | string, msg?: string) => write(recordLevel, objOrMsg, msg),
  ]));

  return {
    ...methods,
    child: (childBindings: Record<string, unknown>) => createConsoleLogger(name, {
      level,
      sink,
      bindings: { ...bindings, ...childBindings },
    }),
  } as unknown as Logger;
}

/** The record field that carries the request's trace id. */
export const TRACE_ID_FIELD = 'traceId';

/** The record field that names the entry point of a file's workflow, such as `create`. */
export const SCOPE_FIELD = 'scope';

/** The record field that names the domain the record belongs to, such as `Users`. */
export const DOMAIN_FIELD = 'domain';

/** The record field that names the step within a scope; set per call, never bound. */
export const STEP_FIELD = 'step';

/** The breadcrumb fields a record may carry: its trace id, domain, scope and step. */
export interface LogBreadcrumb {
  /** The trace id of the request the record belongs to. */
  [TRACE_ID_FIELD]?: string
  /** The domain the record belongs to, in PascalCase, such as `Users`. */
  [DOMAIN_FIELD]?: string
  /** The entry point of a file's workflow, in camelCase, such as `create`. */
  [SCOPE_FIELD]?: string
  /** The step within the scope, in camelCase, such as `insert`; passed in the call's fields. */
  [STEP_FIELD]?: string
}

/**
 * Returns a child logger whose records carry `domain`.
 *
 * A child's bindings win over its parent's, so calling it on a domain logger
 * replaces the domain and keeps every other binding.
 *
 * @param logger - The logger to bind the domain on.
 * @param domain - The domain name, in PascalCase, such as `Users`.
 * @returns The child {@link Logger}.
 *
 * @example
 * ```ts
 * const log = inDomain(createConsoleLogger('users'), 'Users');
 * log.info({ step: 'insert' }, 'user created'); // carries domain: 'Users', step: 'insert'
 * ```
 */
export function inDomain(logger: Logger, domain: string): Logger {
  return logger.child({ [DOMAIN_FIELD]: domain });
}

/**
 * Returns a child logger whose records carry `scope`.
 *
 * The scope names the entry point of a file's workflow; the domain comes from
 * {@link inDomain}. A child's bindings win over its parent's, so scoping a
 * scoped logger replaces the scope and keeps the domain and the trace id.
 *
 * @param logger - The logger to scope.
 * @param scope - The entry point, in camelCase, such as `create`.
 * @returns The child {@link Logger}.
 *
 * @example
 * ```ts
 * const log = scoped(inDomain(createConsoleLogger('users'), 'Users'), 'create');
 * log.info({ step: 'insert' }, 'user created'); // carries domain: 'Users', scope: 'create', step: 'insert'
 * ```
 */
export function scoped(logger: Logger, scope: string): Logger {
  return logger.child({ [SCOPE_FIELD]: scope });
}
