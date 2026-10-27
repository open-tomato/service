import type { TypedClient } from '@open-tomato/service';

import { createServer } from 'node:http';

/**
 * Shape of the health check response returned by `buildHealthResponse`
 * and served at the configured health endpoint path.
 */
export interface HealthResponse {
  /** Aggregate status across all managed clients. */
  status: 'ok' | 'degraded' | 'error';
  /** The service identifier passed to `createMCP`. */
  serviceId: string;
  /** Per-client status, keyed by client name. */
  clients: Record<string, { status: string }>;
}

/**
 * Handle returned by `startHealthServer`, used to stop the server gracefully.
 */
export interface HealthServerHandle {
  /** Close the health server. Resolves once the server has stopped listening. */
  stop: () => void;
}

/**
 * Builds a health response payload for the MCP service.
 *
 * Derives `overallStatus` by inspecting each client's `status` property:
 * - `'error'` if any client has `status === 'error'`
 * - `'degraded'` if any client has `status === 'starting'` or `'degraded'` (and none are `'error'`)
 * - `'ok'` otherwise
 *
 * @param serviceId - The unique identifier of the MCP service.
 * @param clients   - The array of managed `TypedClient` instances to inspect.
 * @returns A `HealthResponse` object describing the aggregate and per-client health.
 *
 * @example
 * ```ts
 * const response = buildHealthResponse('my-service', [apiClient]);
 * // { status: 'ok', serviceId: 'my-service', clients: { 'http-client': { status: 'running' } } }
 * ```
 */
export function buildHealthResponse(
  serviceId: string,
  clients: TypedClient<unknown>[],
): HealthResponse {
  const clientStatuses = Object.fromEntries(
    clients.map(c => [c.name, { status: c.status as string }]),
  );

  let overallStatus: HealthResponse['status'] = 'ok';
  if (clients.some(c => c.status === 'error')) {
    overallStatus = 'error';
  } else if (clients.some(c => c.status === 'starting' || c.status === 'degraded')) {
    overallStatus = 'degraded';
  }

  return { status: overallStatus, serviceId, clients: clientStatuses };
}

/**
 * Starts a standalone `node:http` health server on the configured port.
 *
 * Responds with JSON at `config.path`:
 * - HTTP `200` when status is `'ok'` or `'degraded'`
 * - HTTP `503` when status is `'error'`
 * - HTTP `404` for all other paths
 *
 * @param config - Health server configuration.
 * @param config.port      - Port to listen on (default `3001`).
 * @param config.path      - URL path for the health check route (default `'/health'`).
 * @param config.serviceId - Service identifier forwarded to `buildHealthResponse`.
 * @param config.clients   - Managed clients forwarded to `buildHealthResponse`.
 * @returns A {@link HealthServerHandle} with a `stop()` method for graceful shutdown.
 *
 * @example
 * ```ts
 * const handle = startHealthServer({ port: 3001, path: '/health', serviceId: 'my-svc', clients: [] });
 * // Later on SIGTERM:
 * handle.stop();
 * ```
 */
export function startHealthServer(config: {
  port: number;
  path: string;
  serviceId: string;
  clients: TypedClient<unknown>[];
}): HealthServerHandle {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${config.port}`);
    if (url.pathname === config.path) {
      const payload = buildHealthResponse(config.serviceId, config.clients);
      const httpStatus = payload.status === 'error'
        ? 503
        : 200;
      const body = JSON.stringify(payload);
      res.writeHead(httpStatus, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(config.port);

  return {
    stop: () => { server.close(); },
  };
}
