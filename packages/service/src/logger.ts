import type { Logger, LoggerOptions } from '@open-tomato/service-logger';

import { createLogger } from '@open-tomato/service-logger';

export type { Logger, LoggerOptions } from '@open-tomato/service-logger';

/**
 * @deprecated Use `Logger` from `@open-tomato/service-logger` directly.
 * Kept as an alias for backward compatibility.
 */
export type ServiceLogger = Logger;

/**
 * Creates a structured logger scoped to the given service identifier.
 *
 * Delegates to `@open-tomato/service-logger` `createLogger`, which binds `service`
 * to every emitted log record so aggregators can filter by service.
 *
 * @param serviceId - A unique identifier for the service (e.g. `"payments-api"`).
 * @param options   - Optional logger configuration (level, context, pretty-printing).
 *                    When omitted, sensible defaults are applied (level from `LOG_LEVEL`
 *                    env var, falls back to `'info'`).
 * @returns A {@link Logger} instance scoped to `serviceId`.
 */
export function createServiceLogger(serviceId: string, options?: LoggerOptions): Logger {
  return createLogger(serviceId, options);
}
