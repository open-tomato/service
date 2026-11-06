import type { ResolvedServiceConfig, ServiceConfig } from './schema.js';
import type { ServiceHandle, ServiceContext } from './types.js';
import type { PickedPort, Logger, TypedClient } from '@open-tomato/service';

import { createServer } from 'node:http';

import { logStarted } from '@open-tomato/service';
import { createLogger } from '@open-tomato/service-logger';
import express from 'express';

import { buildRequireAuth, buildOptionalAuth, passthroughMiddleware } from './auth.js';
import { mountBuiltinRoutes } from './builtin-routes.js';
import { buildClientsMap } from './clients-map.js';
import { readServiceVersion } from './control/version.js';
import { buildDepsMap } from './deps-map.js';
import { createErrorHandler } from './error-handler.js';
import { listenOnPickedPort, resolvePortConfig } from './listen.js';
import { applyMiddleware } from './middleware.js';
import { ServiceConfigSchema } from './schema.js';
import { gracefulStop, registerShutdown } from './shutdown.js';

/** The config key that makes a taken port an error instead of a fallback. */
const STRICT_KEY = 'strictPort';
/** The environment variable that does the same when the config is silent. */
const STRICT_ENV = 'PORT_STRICT';

/**
 * The port, strict flag and config key to listen with: the resolved port
 * config, with port 0 under `NODE_ENV=test` when neither the config nor
 * `PORT` named a port.
 */
function listenTarget(config: ResolvedServiceConfig): { port: number; strict: boolean; configKey: string } {
  const { port, strict, portGiven } = resolvePortConfig(config);
  const configKey = portGiven && config.port === undefined
    ? 'PORT'
    : 'port';
  const testPort = process.env.NODE_ENV === 'test' && !portGiven;
  return {
    port: testPort
      ? 0
      : port,
    strict,
    configKey,
  };
}

/** Logs a `warn` record when `pick` fell back from the asked port. */
function warnOnFallback(logger: Logger, pick: PickedPort): void {
  if (!pick.fellBack) return;
  logger.warn(
    { takenPort: pick.requested, port: pick.port, strictKey: STRICT_KEY, strictEnv: STRICT_ENV },
    `port ${pick.requested} is taken, falling back to ${pick.port}; set ${STRICT_KEY} or ${STRICT_ENV}=true to fail instead`,
  );
}

/**
 * Creates and starts an Express HTTP service.
 *
 * **Startup sequence:**
 * 1. Parse and validate `config` with Zod — throws on invalid input.
 * 2. Start each dependency in array order. If any `start()` rejects,
 *    the factory aborts: in test mode (`NODE_ENV=test`) the error is
 *    re-thrown; in production `process.exit(1)` is called.
 * 3. Apply the standard middleware stack (helmet, cors, body parser, rate-limit, pino-http).
 * 4. Build the {@link ServiceContext} (logger, auth middleware, dep/client accessors).
 * 5. Mount built-in routes (`GET /health`).
 * 6. Apply plugins in array order.
 * 7. Call `config.register(app, ctx)` to mount service-specific routes.
 * 8. Attach the error handler as the last middleware.
 * 9. Settle the port: `config.port`, else `PORT`, else 3000, and the
 *    strict flag: `config.strictPort`, else `PORT_STRICT`, else `false`.
 * 10. Probe the port and listen on it. A taken port under the strict flag
 *    rejects with `PortInUseError`; otherwise the first free port of the
 *    next 20 is used, and a `warn` record naming the taken port, the port
 *    used and `strictPort` is logged before listening.
 * 11. Once listening, log the `started` banner: `service`, `version`,
 *    `transport: 'http'`, the bound `url`, `features`, and `fallbackPort`
 *    (the taken port) when the port fell back.
 * 12. Register SIGTERM/SIGINT shutdown handlers (skipped in test mode).
 *
 * **Test-mode behaviour:**
 * When `NODE_ENV=test` and neither `config.port` nor `PORT` names a port,
 * the server binds to port 0 (an OS-assigned ephemeral port); a named port
 * is used as given, so a test can pick one. `process.exit` is never called,
 * making the factory safe to use inside unit and integration tests.
 *
 * @param config - Service configuration. See {@link ServiceConfig} for all options.
 * @returns A {@link ServiceHandle} containing the Express `app`, the bound `port`
 *   and `url`, and a `stop()` method that gracefully shuts down the server and
 *   stops all dependencies in reverse order.
 * @throws {PortInUseError} If the port is taken under the strict flag, or every
 *   port of the fallback range is taken.
 *
 * @example
 * ```ts
 * const { app, stop } = await createService({
 *   serviceId: 'my-service',
 *   register(app, { logger }) {
 *     app.get('/hello', (_req, res) => res.json({ hello: 'world' }))
 *   },
 * })
 * ```
 */
export async function createService(config: ServiceConfig): Promise<ServiceHandle> {
  const resolved = ServiceConfigSchema.parse(config);
  const logger = createLogger(resolved.serviceId);

  // 1. Start dependencies — abort on first failure
  for (const dep of resolved.dependencies) {
    try {
      await dep.start();
      logger.info({ dep: dep.name }, 'dependency started');
    } catch (err) {
      logger.error({ dep: dep.name }, 'dependency failed to start — aborting');
      if (process.env.NODE_ENV !== 'test') process.exit(1);
      throw err;
    }
  }

  const app = express();
  applyMiddleware(app, resolved, logger);

  const ctx: ServiceContext = {
    logger,
    requireAuth: resolved.auth
      ? buildRequireAuth(resolved.auth.introspectUrl, logger, resolved.auth.introspectSecret)
      : passthroughMiddleware,
    optionalAuth: resolved.auth
      ? buildOptionalAuth(resolved.auth.introspectUrl, logger, resolved.auth.introspectSecret)
      : passthroughMiddleware,
    deps: buildDepsMap(resolved.dependencies),
    clients: buildClientsMap(resolved.clients as TypedClient<unknown>[]),
    config: resolved,
  };

  // 2. Mount built-in routes
  mountBuiltinRoutes(app, resolved, logger, ctx);

  // 3. Plugins — sequential, after middleware + built-in routes, before register
  for (const plugin of resolved.plugins) {
    await plugin.register({ app, ...ctx });
  }

  // 4. Service routes
  await resolved.register(app, ctx);

  // 5. Error handler — always last
  app.use(createErrorHandler(logger, resolved.formatError));

  // 6. Listen on the picked port, warn on a fallback, then log the banner
  const server = createServer(app);
  const picked = await listenOnPickedPort(server, {
    ...listenTarget(resolved),
    onPicked: (pick) => warnOnFallback(logger, pick),
  });
  const url = `http://localhost:${picked.port}`;
  logStarted(logger, {
    version: readServiceVersion(),
    transport: 'http',
    url,
    features: resolved.features,
    ...(picked.fellBack
      ? { fallbackPort: picked.requested }
      : {}),
  });

  // 7. Register shutdown handlers (production only)
  if (process.env.NODE_ENV !== 'test') {
    registerShutdown(server, resolved.dependencies, logger, resolved.shutdown?.drainTimeout ?? 10_000);
  }

  return {
    app,
    port: picked.port,
    url,
    stop: () => gracefulStop(server, resolved.dependencies, logger, resolved.shutdown?.drainTimeout ?? 10_000),
  };
}
