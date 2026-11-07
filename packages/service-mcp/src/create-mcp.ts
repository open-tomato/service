import type { HealthServerHandle } from './health.js';
import type { HttpTransportHandle } from './transport.js';
import type { MCPAddress, MCPConfig, MCPHandle, MCPTransport, ResolvedMCPConfig } from './types.js';
import type { ClientsMap, Logger, TypedClient } from '@open-tomato/service';
import type { LoggerOptions } from '@open-tomato/service-logger';

import process from 'node:process';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logStarted } from '@open-tomato/service';
import { createLogger } from '@open-tomato/service-logger';

import { startHealthServer } from './health.js';
import { resolvePortConfig } from './listen.js';
import { MCPConfigSchema } from './schema.js';
import { resolveTransport, wireHttpTransport, wireStdioTransport } from './transport.js';

/**
 * Builds a `ClientsMap` from an array of `TypedClient` instances.
 *
 * @param clients - Array of managed HTTP clients to index.
 * @returns A `Record<string, TypedClient<unknown>>` keyed by each client's `name`.
 *
 * @example
 * ```ts
 * const map = buildClientsMap([apiClient, dbClient]);
 * // { 'api-client': apiClient, 'db-client': dbClient }
 * ```
 */
function buildClientsMap(clients: TypedClient<unknown>[]): ClientsMap {
  return Object.fromEntries(clients.map(c => [c.name, c]));
}

/** The URL of `path` on `localhost` at `port`. */
function localUrl(port: number, path = ''): string {
  return `http://localhost:${port}${path}`;
}

/**
 * Writes the startup banner for HTTP mode: the bound transport URL, the
 * bound health URL, and the asked port of each server that fell back.
 *
 * @param logger - The server's logger.
 * @param config - The resolved config, for the service id, version and features.
 * @param http - The listening HTTP transport.
 * @param health - The listening health server.
 */
function logHttpStarted(
  logger: Logger,
  config: ResolvedMCPConfig,
  http: HttpTransportHandle,
  health: HealthServerHandle,
): void {
  logStarted(logger, {
    version: config.version,
    transport: 'http',
    url: localUrl(http.port),
    features: config.features,
    ...(http.fellBack
      ? { fallbackPort: http.requested }
      : {}),
    extra: {
      healthUrl: localUrl(health.port, config.health.path),
      ...(health.fellBack
        ? { healthFallbackPort: health.requested }
        : {}),
    },
  });
}

/**
 * The logger options for `transport`: `destination` is `'stderr'` on stdio,
 * where stdout carries the protocol, and `'stdout'` on HTTP. A `destination`
 * in `options` wins over the pick.
 *
 * @param transport - The transport the server will wire.
 * @param options - The `logger` config, if any.
 * @returns The options to hand `createLogger`.
 */
function loggerOptionsFor(transport: MCPTransport, options: LoggerOptions | undefined): LoggerOptions {
  const picked = transport === 'stdio'
    ? 'stderr'
    : 'stdout';
  return { ...options, destination: options?.destination ?? picked };
}

/**
 * Creates and auto-starts an MCP server from the provided configuration.
 *
 * The server starts immediately upon calling this function — no explicit
 * `start()` call is needed. It progresses through six lifecycle phases:
 *
 * **1. Init** — `config` is validated and defaulted via `MCPConfigSchema`.
 * The transport is picked once, by `resolveTransport()`, and that pick picks
 * the logger's destination: stderr on stdio, where stdout carries the
 * protocol, and stdout on HTTP; a `destination` in the `logger` config wins.
 * A scoped logger is created from `serviceId` and the `logger` config.
 * The `clients` array is indexed into a `ClientsMap` keyed by each client's
 * `name` property (set when the client was constructed via `createHttpClient`).
 *
 * **2. Setup** — `config.setup(server, ctx)` is awaited. Register all tools,
 * resources, and prompts here. If this callback throws or rejects, the start
 * fails and the health server is never started.
 *
 * **3. Transport** — the transport picked at Init is wired; the pick follows
 * the `MCP_TRANSPORT` environment variable:
 * - _(default)_ `MCP_TRANSPORT` unset or any value other than `'stdio'`:
 *   `StreamableHTTPServerTransport` in stateful mode
 *   (`sessionIdGenerator: () => randomUUID()`), served by a Node HTTP server
 *   on `port`, else `PORT`, else `8080`. Stateless mode is intentionally avoided — it breaks the MCP
 *   `initialize` handshake which requires at least two HTTP round-trips.
 * - `MCP_TRANSPORT=stdio`: `StdioServerTransport` for local dev and Claude
 *   Desktop integration. The health server is **not** started in this mode.
 *
 * **4. Health** _(HTTP mode only)_ — a lightweight `node:http` server starts on
 * `health.port`, else `HEALTH_PORT`, else `3001`, at `health.path` (default `'/health'`).
 * The response aggregates circuit-breaker states from all registered clients:
 * `"ok"` when all circuits are closed, `"degraded"` when any circuit is open or
 * half-open, `"error"` when the MCP transport itself has failed.
 *
 * **5. Started** — once both servers listen in HTTP mode, `logStarted` writes
 * the `started` banner with the bound URLs, the `version` and `features`, and
 * `fallbackPort` and `healthFallbackPort` for a server that fell back, and
 * `ready()` resolves with the bound address. In `stdio` mode, once the
 * transport is connected, `logStarted` writes the `started` banner with
 * transport `stdio` and no `url` through the logger, which writes to stderr
 * there, and `ready()` resolves. A failed start rejects `ready()`, logs the error and,
 * outside `NODE_ENV=test`, exits the process with code 1; a health server that
 * cannot listen closes the transport first.
 *
 * **6. SIGTERM** — a one-time `SIGTERM` handler is registered _before_
 * `start()` is invoked so that signals received during the async setup phase
 * are still caught. On signal: the MCP transport is closed (draining in-flight
 * requests), then the health server is stopped. Both steps use optional
 * chaining so they are safe no-ops if startup had not yet reached those phases.
 *
 * **`clients` key caveat** — keys in `MCPContext.clients` are the `name` values
 * set on each `TypedClient` at construction time (e.g. `'github-api'`), not
 * positional indices. Accessing a client by the wrong name returns `undefined`.
 * Use {@link ClientsMap} helpers or store a direct reference to avoid typos.
 *
 * @param config - MCP server configuration. See {@link MCPConfig} for details.
 * @returns An {@link MCPHandle} with `ready()`, `stop()` and `healthUrl()` methods.
 *
 * @example Minimal — no clients
 * ```ts
 * const handle = createMCP({
 *   serviceId: 'my-mcp',
 *   setup: async (server, { logger }) => {
 *     server.tool('greet', {}, async () => ({ content: [{ type: 'text', text: 'Hello!' }] }));
 *   },
 * });
 *
 * const { url, healthUrl } = await handle.ready();
 *
 * // In tests or on SIGTERM:
 * await handle.stop();
 * ```
 *
 * @example With an HTTP client
 * ```ts
 * const github = createHttpClient(new GitHubApi(), { name: 'github', retry: { attempts: 2 } });
 *
 * const handle = createMCP({
 *   serviceId: 'context-generator',
 *   clients: [github],
 *   setup(server, { clients }) {
 *     // Access by the client's `name` property, not by index.
 *     const gh = clients['github-api'] as GitHubApi;
 *     server.tool('get-repo', GetRepoSchema, async ({ owner, repo }) => {
 *       const data = await gh.getRepo(owner, repo);
 *       return { content: [{ type: 'text', text: JSON.stringify(data) }] };
 *     });
 *   },
 * });
 * ```
 */
export function createMCP(config: MCPConfig): MCPHandle {
  const resolved = MCPConfigSchema.parse(config);
  const ports = resolvePortConfig(resolved);
  const transport = resolveTransport();
  const logger = createLogger(resolved.serviceId, loggerOptionsFor(transport, resolved.logger));
  const clientsMap = buildClientsMap(resolved.clients);
  const server = new McpServer({ name: resolved.serviceId, version: resolved.version });

  let transportInstance:
    | Awaited<ReturnType<typeof wireHttpTransport>>
    | Awaited<ReturnType<typeof wireStdioTransport>>
    | null = null;
  let healthServer: Awaited<ReturnType<typeof startHealthServer>> | null = null;
  let address: MCPAddress | null = null;

  /**
   * Starts the health server beside the listening `http` transport, closing
   * the transport when the health server cannot listen.
   */
  async function startHealth(http: HttpTransportHandle): Promise<HealthServerHandle> {
    try {
      return await startHealthServer({
        port: ports.health.port,
        strict: ports.health.strict,
        logger,
        path: resolved.health.path,
        serviceId: resolved.serviceId,
        clients: resolved.clients,
      });
    } catch (err) {
      transportInstance = null;
      await http.close().catch((closeErr: unknown) => {
        logger.error({ err: closeErr }, 'Error closing MCP transport after a failed start');
      });
      throw err;
    }
  }

  /**
   * Initialises the server: invokes `setup`, wires the transport, starts the
   * health server (HTTP mode only) and writes the banner.
   */
  async function start(): Promise<MCPAddress> {
    await resolved.setup(server, { logger, clients: clientsMap });

    if (transport === 'stdio') {
      transportInstance = await wireStdioTransport(server);
      address = { transport: 'stdio' };
      logStarted(logger, {
        version: resolved.version,
        transport: 'stdio',
        features: resolved.features,
      });
      return address;
    }

    const http = await wireHttpTransport(server, {
      port: ports.port,
      strict: ports.strict,
      logger,
    });
    transportInstance = http;
    const health = await startHealth(http);
    healthServer = health;
    address = {
      transport: 'http',
      port: http.port,
      url: localUrl(http.port),
      healthPort: health.port,
      healthUrl: localUrl(health.port, resolved.health.path),
    };
    logHttpStarted(logger, resolved, http, health);
    return address;
  }

  /**
   * Gracefully shuts down the transport and health server.
   * Safe to call multiple times — subsequent calls are no-ops once resources
   * have been released.
   */
  async function shutdown(): Promise<void> {
    logger.info('Shutting down MCP server...');
    await transportInstance?.close();
    healthServer?.stop();
    logger.info('Shutdown complete');
  }

  // Register SIGTERM handler before start() so that a signal received during
  // startup (e.g. during the async setup phase) is still handled gracefully.
  // Uses optional chaining so calls before transport/health are wired are
  // safe no-ops — the process will not hang.
  process.once('SIGTERM', () => {
    shutdown().catch(err => {
      logger.error({ err }, 'Error during SIGTERM shutdown');
    });
  });

  const started = start();
  // This handler also keeps a rejection nobody awaits from going unhandled;
  // ready() still hands the rejection to every caller.
  started.catch((err: unknown) => {
    logger.error({ err }, 'Failed to start MCP server');
    if (process.env['NODE_ENV'] !== 'test') process.exit(1);
  });

  return {
    ready: () => started,
    stop: shutdown,
    healthUrl: () => {
      if (address === null) return localUrl(ports.health.port, resolved.health.path);
      return address.healthUrl ?? '';
    },
  };
}
