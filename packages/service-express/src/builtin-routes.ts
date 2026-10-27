import type { ResolvedServiceConfig } from './schema.js';
import type { ServiceContext } from './types.js';
import type { ServiceLogger } from '@open-tomato/service';
import type { Application } from 'express';

import { createControlRouter } from './control/routes.js';

/**
 * Mounts built-in routes: GET /health and ALL /_control/*.
 *
 * The `/_control` router is mounted only when `config.control` is defined.
 * It is mounted after core middleware but before service-specific routes and
 * the global error handler, and does not inherit any user-auth middleware.
 *
 * @param app - Express application instance
 * @param config - Resolved service configuration
 * @param _logger - Service logger instance
 * @param _ctx - Service context containing deps and other runtime handles
 */
export function mountBuiltinRoutes(
  app: Application,
  config: ResolvedServiceConfig,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _logger: ServiceLogger,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _ctx: ServiceContext,
): void {
  app.get('/health', (_req, res) => {
    const allDeps = [...config.dependencies, ...config.clients];
    const hasError = allDeps.some(d => d.status === 'error');
    if (hasError) {
      res.status(503).json({ status: 'error' });
    } else {
      res.json({ status: 'ok' });
    }
  });

  if (config.control) {
    app.use('/_control', createControlRouter(
      config.dependencies,
      config.clients,
      config.control,
      config.serviceId,
    ));
  }
}
