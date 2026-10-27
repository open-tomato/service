import type { MCPTransport } from './types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { randomUUID } from 'node:crypto';
import process from 'node:process';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

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
 * Constructs a `WebStandardStreamableHTTPServerTransport`, starts a Bun HTTP
 * server on `port` to route incoming requests to the transport, and connects
 * the transport to `server`.
 *
 * @param server - The MCP SDK server instance to connect the transport to.
 * @param port   - The port on which the MCP HTTP server should listen (typically
 *                 read from the `PORT` env var, defaulting to `8080`).
 * @returns The connected `WebStandardStreamableHTTPServerTransport` instance.
 *
 * @example
 * ```ts
 * const port = Number(process.env['PORT'] ?? 8080);
 * const transport = await wireHttpTransport(server, port);
 * ```
 */
export async function wireHttpTransport(
  server: McpServer,
  port: number,
): Promise<WebStandardStreamableHTTPServerTransport> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  Bun.serve({
    port,
    fetch: (req: Request) => transport.handleRequest(req),
  });

  await server.connect(transport);
  return transport;
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
