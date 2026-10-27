import type { ServiceConfig } from './schema.js';
import type { ServiceHandle, ServiceContext } from './types.js';
import type { TypedClient } from '@open-tomato/service';
import type { Server } from 'http';

import { createServiceLogger } from '@open-tomato/service';
import express from 'express';

import { buildRequireAuth, buildOptionalAuth, passthroughMiddleware } from './auth.js';
import { mountBuiltinRoutes } from './builtin-routes.js';
import { buildClientsMap } from './clients-map.js';
import { buildDepsMap } from './deps-map.js';
import { applyMiddleware, errorHandler } from './middleware.js';
import { ServiceConfigSchema } from './schema.js';
import { gracefulStop, registerShutdown } from './shutdown.js';

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
 * 9. Listen on `config.port` (or an ephemeral port when `NODE_ENV=test`).
 * 10. Register SIGTERM/SIGINT shutdown handlers (skipped in test mode).
 *
 * **Test-mode behaviour:**
 * When `NODE_ENV=test`, the server binds to port 0 (OS-assigned ephemeral
 * port) and `process.exit` is never called, making the factory safe to use
 * inside unit and integration tests.
 *
 * @param config - Service configuration. See {@link ServiceConfig} for all options.
 * @returns A {@link ServiceHandle} containing the Express `app` and a `stop()` method
 *   that gracefully shuts down the server and stops all dependencies in reverse order.
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
  const logger = createServiceLogger(resolved.serviceId);

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
  app.use(errorHandler);

  // 6. Listen
  const port = process.env.NODE_ENV === 'test'
    ? 0
    : (resolved.port ?? 3000);
  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(port, () => {
      const addr = s.address();
      const bound = typeof addr === 'object'
        ? addr?.port
        : port;
      logger.info({ port: bound }, 'listening');
      resolve(s);
    });
    s.once('error', reject);
  });

  // 7. Register shutdown handlers (production only)
  if (process.env.NODE_ENV !== 'test') {
    registerShutdown(server, resolved.dependencies, logger, resolved.shutdown?.drainTimeout ?? 10_000);
  }

  return {
    app,
    stop: () => gracefulStop(server, resolved.dependencies, logger, resolved.shutdown?.drainTimeout ?? 10_000),
  };
}
