import type { Logger, TypedClient } from '@open-tomato/service';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { createServer } from 'node:http';

import { listenOnPickedPort, warnOnFallback } from './listen.js';

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

/** The config key that sets the health port, named by a `PortInUseError`. */
const HEALTH_PORT_KEY = 'health.port';

/** The strict names the health server's fallback warning points to. */
const HEALTH_STRICT_NAMES = { strictKey: 'health.strictPort', strictEnv: 'HEALTH_PORT_STRICT' } as const;

/**
 * Handle returned by `startHealthServer` once the server listens, used to read
 * the bound port and to stop the server gracefully.
 */
export interface HealthServerHandle {
  /** The port the health server is bound to. */
  readonly port: number;
  /** The port that was asked for. */
  readonly requested: number;
  /** `true` when the asked port was taken and `port` is a later one. */
  readonly fellBack: boolean;
  /** Close the health server. */
  stop: () => void;
}

/** What `startHealthServer` needs to serve the health route. */
export interface HealthServerConfig {
  /** The port to ask for; `0` lets the system choose. */
  readonly port: number;
  /** When `true`, a taken port rejects instead of falling back. */
  readonly strict: boolean;
  /** URL path of the health route. */
  readonly path: string;
  /** Service identifier forwarded to `buildHealthResponse`. */
  readonly serviceId: string;
  /** Managed clients forwarded to `buildHealthResponse`. */
  readonly clients: TypedClient<unknown>[];
  /** Receives the fallback warning and any error the server raises once listening. */
  readonly logger: Logger;
  /** The config key a `PortInUseError` names; defaults to `health.port`. */
  readonly configKey?: string;
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

/** Answers one request: the health payload at `path`, `404` elsewhere. */
function handleRequest(config: HealthServerConfig, req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== config.path) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
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
}

/**
 * Starts a standalone `node:http` health server on a port picked by
 * `listenOnPickedPort`, and resolves once it listens.
 *
 * Responds with JSON at `config.path`:
 * - HTTP `200` when status is `'ok'` or `'degraded'`
 * - HTTP `503` when status is `'error'`
 * - HTTP `404` for all other paths
 *
 * A taken port falls back to the next free one of the range and logs a `warn`
 * record, unless `config.strict` is set. An error the server raises after it
 * listens is logged at `error` rather than left unhandled.
 *
 * @param config - Health server configuration: port, strict flag, path, service id, clients and logger.
 * @returns A {@link HealthServerHandle} with the bound port, the pick and a `stop()` method.
 * @throws {PortInUseError} If the port is taken under `strict`, or every port of the range is taken.
 * @throws {RangeError} If the port is out of bounds.
 *
 * @example
 * ```ts
 * const handle = await startHealthServer({
 *   port: 3001, strict: false, path: '/health', serviceId: 'my-svc', clients: [], logger,
 * });
 * handle.port; // 3001, or a later port if 3001 was taken
 * handle.stop();
 * ```
 */
export async function startHealthServer(config: HealthServerConfig): Promise<HealthServerHandle> {
  const server = createServer((req, res) => handleRequest(config, req, res));
  const picked = await listenOnPickedPort(server, {
    port: config.port,
    strict: config.strict,
    configKey: config.configKey ?? HEALTH_PORT_KEY,
    onPicked: (pick) => warnOnFallback(config.logger, pick, HEALTH_STRICT_NAMES),
  });
  server.on('error', (err) => {
    config.logger.error({ err }, 'Health server error');
  });

  return {
    port: picked.port,
    requested: picked.requested,
    fellBack: picked.fellBack,
    stop: () => { server.close(); },
  };
}
