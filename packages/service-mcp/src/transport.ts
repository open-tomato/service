import type { MCPTransport } from './types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import process from 'node:process';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/** The HTTP transport and the Node server that feeds it. */
export interface HttpTransportHandle {
  /** The connected Streamable HTTP transport. */
  readonly transport: StreamableHTTPServerTransport;
  /** Closes the transport, then the HTTP server and its open connections. */
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
 * Constructs a `StreamableHTTPServerTransport`, starts a Node HTTP server on
 * `port` that hands every request to the transport, and connects the
 * transport to `server`.
 *
 * @param server - The MCP SDK server instance to connect the transport to.
 * @param port   - The port on which the MCP HTTP server should listen (typically
 *                 read from the `PORT` env var, defaulting to `8080`).
 * @returns A handle holding the transport, whose `close()` also stops the
 *          HTTP server.
 *
 * @example
 * ```ts
 * const port = Number(process.env['PORT'] ?? 8080);
 * const handle = await wireHttpTransport(server, port);
 * ```
 */
export async function wireHttpTransport(
  server: McpServer,
  port: number,
): Promise<HttpTransportHandle> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  const httpServer = createServer((req, res) => {
    transport.handleRequest(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, () => resolve());
  });

  await server.connect(transport);
  return {
    transport,
    close: async () => {
      await transport.close();
      // Streams the transport left open would keep close() waiting.
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
