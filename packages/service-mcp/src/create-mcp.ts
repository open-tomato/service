import type { MCPConfig, MCPHandle } from './types.js';
import type { ClientsMap, TypedClient } from '@open-tomato/service';

import process from 'node:process';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServiceLogger } from '@open-tomato/service';

import { startHealthServer } from './health.js';
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

/**
 * Creates and auto-starts an MCP server from the provided configuration.
 *
 * The server starts immediately upon calling this function — no explicit
 * `start()` call is needed. It progresses through five lifecycle phases:
 *
 * **1. Init** — `config` is validated and defaulted via `MCPConfigSchema`.
 * A scoped logger is created from `serviceId` and the optional `logger` config.
 * The `clients` array is indexed into a `ClientsMap` keyed by each client's
 * `name` property (set when the client was constructed via `createHttpClient`).
 * Health and SIGTERM below are phases 4 and 5; setup is phase 3 because it
 * runs per session once the transport is up.
 *
 * **2. Transport** — the transport is selected based on the `MCP_TRANSPORT`
 * environment variable:
 * - _(default)_ `MCP_TRANSPORT` unset or any value other than `'stdio'`: a
 *   Node HTTP server on `PORT` (default `8080`) that serves one MCP session
 *   per client. Each `initialize` gets its own stateful
 *   `StreamableHTTPServerTransport` and its own `McpServer`, and later
 *   requests reach their session by the `Mcp-Session-Id` header. Stateless
 *   mode is intentionally avoided — it breaks the MCP `initialize`
 *   handshake which requires at least two HTTP round-trips.
 * - `MCP_TRANSPORT=stdio`: `StdioServerTransport` for local dev and Claude
 *   Desktop integration. The health server is **not** started in this mode.
 *
 * **3. Setup** — `config.setup(server, ctx)` is awaited against each new
 * `McpServer`. Register all tools, resources, and prompts here. In HTTP mode
 * it runs once per client session, when that client's `initialize` arrives;
 * a throw or rejection answers that client `500`, is logged, and leaves the
 * process up. In stdio mode it runs once at startup, and a failure logs the
 * error and exits the process.
 *
 * **4. Health** _(HTTP mode only)_ — a lightweight `node:http` server starts on
 * `health.port` (default `3001`) at `health.path` (default `'/health'`).
 * The response aggregates circuit-breaker states from all registered clients:
 * `"ok"` when all circuits are closed, `"degraded"` when any circuit is open or
 * half-open, `"error"` when the MCP transport itself has failed.
 *
 * **5. SIGTERM** — a one-time `SIGTERM` handler is registered _before_
 * `start()` is invoked so that signals received during the async setup phase
 * are still caught. On signal: the MCP transport is closed (draining in-flight
 * requests), then the health server is stopped. In HTTP mode closing the
 * transport closes every open session. Both steps use optional
 * chaining so they are safe no-ops if startup had not yet reached those phases.
 *
 * **`clients` key caveat** — keys in `MCPContext.clients` are the `name` values
 * set on each `TypedClient` at construction time (e.g. `'github-api'`), not
 * positional indices. Accessing a client by the wrong name returns `undefined`.
 * Use {@link ClientsMap} helpers or store a direct reference to avoid typos.
 *
 * @param config - MCP server configuration. See {@link MCPConfig} for details.
 * @returns An {@link MCPHandle} with `stop()` and `healthUrl()` methods.
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
 * // In tests or on SIGTERM:
 * await handle.stop();
 * ```
 *
 * @example With an HTTP client
 * ```ts
 * const github = createHttpClient(new GitHubApi(), { retry: { attempts: 2 } });
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
  const logger = createServiceLogger(resolved.serviceId, resolved.logger);
  const clientsMap = buildClientsMap(resolved.clients);

  let transportInstance:
    | Awaited<ReturnType<typeof wireHttpTransport>>
    | Awaited<ReturnType<typeof wireStdioTransport>>
    | null = null;
  let healthServer: ReturnType<typeof startHealthServer> | null = null;

  /**
   * Builds one `McpServer` and runs `setup` against it. HTTP mode calls this
   * once per client session; stdio mode calls it once at startup.
   */
  async function createSessionServer(): Promise<McpServer> {
    const server = new McpServer({ name: resolved.serviceId, version: '1.0.0' });
    await resolved.setup(server, { logger, clients: clientsMap });
    return server;
  }

  /**
   * Initialises the server: wires the transport, and starts the health
   * server (HTTP mode only).
   */
  async function start(): Promise<void> {
    const transport = resolveTransport();

    if (transport === 'http') {
      const port = Number(process.env['PORT'] ?? 8080);
      transportInstance = await wireHttpTransport({
        createSessionServer,
        port,
        onError: error => {
          logger.error({ err: error }, 'Could not open an MCP session');
        },
      });
      healthServer = startHealthServer({
        port: resolved.health.port,
        path: resolved.health.path,
        serviceId: resolved.serviceId,
        clients: resolved.clients,
      });
    } else {
      transportInstance = await wireStdioTransport(await createSessionServer());
    }
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

  start().catch(err => {
    logger.error({ err }, 'Failed to start MCP server');
    process.exit(1);
  });

  return {
    stop: shutdown,
    healthUrl: () => `http://localhost:${resolved.health.port}${resolved.health.path}`,
  };
}
