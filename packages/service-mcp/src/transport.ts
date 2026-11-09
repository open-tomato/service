import type { SessionServerFactory } from './http-sessions.js';
import type { MCPTransport } from './types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from '@open-tomato/service';

import { createServer } from 'node:http';
import process from 'node:process';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createHttpSessions } from './http-sessions.js';
import { listenOnPickedPort, warnOnFallback } from './listen.js';

/** The config key that sets the transport port, named by a `PortInUseError`. */
const PORT_KEY = 'port';

/** The strict names the transport's fallback warning points to. */
const STRICT_NAMES = { strictKey: 'strictPort', strictEnv: 'PORT_STRICT' } as const;

/** What `wireHttpTransport` needs to open sessions, pick its port and listen. */
export interface HttpTransportConfig {
  /** Builds the `McpServer` for each new client session, tools registered. */
  readonly createSessionServer: SessionServerFactory;
  /** The port to ask for; `0` lets the system choose. */
  readonly port: number;
  /** When `true`, a taken port rejects instead of falling back. */
  readonly strict: boolean;
  /**
   * Receives the fallback warning, any error the server raises once
   * listening, and the error of a session that could not be opened.
   */
  readonly logger: Logger;
  /** The config key a `PortInUseError` names; defaults to `port`. */
  readonly configKey?: string;
}

/** The Node HTTP server and the MCP sessions it serves. */
export interface HttpTransportHandle {
  /** The number of MCP sessions open right now. */
  sessionCount(): number;
  /** The port the HTTP server is bound to. */
  readonly port: number;
  /** The port that was asked for. */
  readonly requested: number;
  /** `true` when the asked port was taken and `port` is a later one. */
  readonly fellBack: boolean;
  /** Closes every session, then the HTTP server and its open connections. */
  close(): Promise<void>;
}

/**
 * Resolves the MCP transport mode from the environment.
 *
 * Reads `process.env.MCP_TRANSPORT` at call time (lazy, not a module-level constant).
 * Returns `'stdio'` when the value is `'stdio'`, otherwise defaults to `'http'`.
 *
 * @returns The resolved transport mode.
 *
 * @example
 * ```ts
 * // MCP_TRANSPORT=stdio bun run src/index.ts
 * const mode = resolveTransport(); // 'stdio'
 * ```
 */
export function resolveTransport(): MCPTransport {
  return process.env['MCP_TRANSPORT'] === 'stdio'
    ? 'stdio'
    : 'http';
}

/**
 * Starts a Node HTTP server, on a port picked by `listenOnPickedPort`, that
 * serves one MCP session per client: each `initialize` gets its own
 * `StreamableHTTPServerTransport` connected to a fresh server from
 * `config.createSessionServer`, and later requests reach their session by
 * the `Mcp-Session-Id` header.
 *
 * A taken port falls back to the next free one of the range and logs a `warn`
 * record naming `strictPort` and `PORT_STRICT`, unless `config.strict` is
 * set. An error the server raises after it listens, and the error of a
 * session that could not be opened, are logged at `error`.
 *
 * @param config - The session server factory, the port to ask for, the strict
 *                 flag, the logger and the optional config key.
 * @returns A handle holding the bound port and the pick, whose `close()` ends
 *          every session and stops the HTTP server.
 * @throws {PortInUseError} If the port is taken under `strict`, or every port of the range is taken.
 * @throws {RangeError} If the port is out of bounds.
 *
 * @example
 * ```ts
 * const handle = await wireHttpTransport({ createSessionServer, port: 8080, strict: false, logger });
 * handle.port; // 8080, or a later port if 8080 was taken
 * ```
 */
export async function wireHttpTransport(config: HttpTransportConfig): Promise<HttpTransportHandle> {
  const sessions = createHttpSessions({
    createSessionServer: config.createSessionServer,
    onError: (err) => {
      config.logger.error({ err }, 'Could not open an MCP session');
    },
  });

  const httpServer = createServer((req, res) => {
    sessions.handleRequest(req, res).catch((err: unknown) => {
      config.logger.error({ err }, 'MCP request failed');
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  const picked = await listenOnPickedPort(httpServer, {
    port: config.port,
    strict: config.strict,
    configKey: config.configKey ?? PORT_KEY,
    onPicked: (pick) => warnOnFallback(config.logger, pick, STRICT_NAMES),
  });
  httpServer.on('error', (err) => {
    config.logger.error({ err }, 'MCP HTTP server error');
  });

  return {
    sessionCount: () => sessions.count(),
    port: picked.port,
    requested: picked.requested,
    fellBack: picked.fellBack,
    close: async () => {
      await sessions.closeAll();
      // Streams a session left open would keep close() waiting.
      httpServer.closeAllConnections();
      await new Promise<void>(resolve => httpServer.close(() => resolve()));
    },
  };
}

/**
 * Constructs a `StdioServerTransport` and connects it to `server`.
 *
 * Uses the current process's `stdin`/`stdout` streams, which is the standard
 * wiring for Claude Desktop and other stdio-based MCP clients.
 *
 * @param server - The MCP SDK server instance to connect the transport to.
 * @returns The connected `StdioServerTransport` instance.
 *
 * @example
 * ```ts
 * const transport = await wireStdioTransport(server);
 * ```
 */
export async function wireStdioTransport(
  server: McpServer,
): Promise<StdioServerTransport> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return transport;
}
