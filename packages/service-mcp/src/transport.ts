import type { SessionServerFactory } from './http-sessions.js';
import type { MCPTransport } from './types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createServer } from 'node:http';
import process from 'node:process';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createHttpSessions } from './http-sessions.js';

/** The HTTP server and the sessions it serves. */
export interface HttpTransportHandle {
  /** The number of MCP sessions open right now. */
  sessionCount(): number;
  /** Closes every session, then the HTTP server and its open connections. */
  close(): Promise<void>;
}

/** What `wireHttpTransport` needs. */
export interface HttpTransportOptions {
  /** Builds the `McpServer` for each new session, tools registered. */
  readonly createSessionServer: SessionServerFactory;
  /** The port to listen on (typically `PORT`, defaulting to `8080`). */
  readonly port: number;
  /** Receives the error when a session cannot be opened. */
  readonly onError?: (error: unknown) => void;
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
 * Starts a Node HTTP server on `options.port` that serves one MCP session
 * per client: each `initialize` gets its own `StreamableHTTPServerTransport`
 * connected to a fresh server from `options.createSessionServer`, and later
 * requests reach their session by the `Mcp-Session-Id` header.
 *
 * @param options - The session server factory, the port and the error sink.
 * @returns A handle whose `close()` ends every session and stops the server.
 *
 * @example
 * ```ts
 * const port = Number(process.env['PORT'] ?? 8080);
 * const handle = await wireHttpTransport({ createSessionServer, port });
 * ```
 */
export async function wireHttpTransport(options: HttpTransportOptions): Promise<HttpTransportHandle> {
  const sessions = createHttpSessions({
    createSessionServer: options.createSessionServer,
    onError: options.onError,
  });

  const httpServer = createServer((req, res) => {
    sessions.handleRequest(req, res).catch((error: unknown) => {
      options.onError?.(error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, () => resolve());
  });

  return {
    sessionCount: () => sessions.count(),
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
