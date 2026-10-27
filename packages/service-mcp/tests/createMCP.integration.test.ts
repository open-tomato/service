/**
 * Integration tests for MCP tool calls via WebStandardStreamableHTTPServerTransport.
 *
 * Uses a standalone Node.js HTTP server that pipes the transport's ReadableStream
 * bodies, so SSE responses stream instead of buffering. A
 * single Client instance is shared across all tests via beforeAll/afterAll since
 * McpServer supports only one client session at a time.
 */
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { Client } from '@modelcontextprotocol/sdk/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

// Unique port — must differ from ports used by other integration test files
// (http-server.integration.test.ts uses 8096 and 8097).
const MCP_PORT = 8085;

// ---------------------------------------------------------------------------
// Node.js HTTP server that properly pipes ReadableStream bodies (SSE-safe)
// ---------------------------------------------------------------------------

async function adaptRequest(nodeReq: IncomingMessage, port: number): Promise<Request> {
  const url = new URL(nodeReq.url ?? '/', `http://localhost:${port}`);
  const headers = new Headers();
  for (const [key, rawVal] of Object.entries(nodeReq.headers)) {
    if (rawVal !== undefined) {
      headers.set(
        key,
        Array.isArray(rawVal)
          ? rawVal.join(', ')
          : rawVal,
      );
    }
  }
  const chunks: Buffer[] = [];
  for await (const chunk of nodeReq) {
    chunks.push(chunk as Buffer);
  }
  const body = chunks.length > 0
    ? Buffer.concat(chunks)
    : null;
  return new Request(url.toString(), { method: nodeReq.method ?? 'GET', headers, body });
}

async function pipeResponse(webRes: Response, nodeRes: ServerResponse): Promise<void> {
  const headers: Record<string, string> = {};
  webRes.headers.forEach((val, key) => {
    headers[key] = val;
  });
  nodeRes.writeHead(webRes.status, headers);

  if (webRes.body) {
    const reader = webRes.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        nodeRes.write(value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  nodeRes.end();
}

async function startMcpNodeServer(
  transport: WebStandardStreamableHTTPServerTransport,
  port: number,
): Promise<Server> {
  const httpServer = createServer(async (req, res) => {
    try {
      const webReq = await adaptRequest(req, port);
      const webRes = await transport.handleRequest(webReq);
      await pipeResponse(webRes, res);
    } catch {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  });
  return new Promise<Server>(resolve => httpServer.listen(port, () => resolve(httpServer)));
}

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

describe('createMCP — MCP protocol integration', () => {
  let httpServer: Server;
  let transport: WebStandardStreamableHTTPServerTransport;
  let client: Client;

  beforeAll(async () => {
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    const mcpServer = new McpServer({ name: 'integration-test-mcp', version: '1.0.0' });

    mcpServer.tool('ping', {}, async () => ({
      content: [{ type: 'text' as const, text: 'pong' }],
    }));

    mcpServer.tool('echo', { message: z.string() }, async ({ message }) => ({
      content: [{ type: 'text' as const, text: message }],
    }));

    await mcpServer.connect(transport);
    httpServer = await startMcpNodeServer(transport, MCP_PORT);

    client = new Client({ name: 'test-client', version: '1.0.0' });
    const clientTransport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${MCP_PORT}/`),
    );
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await transport.close();
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
  });

  it('ping tool returns pong', async () => {
    const result = await client.callTool({ name: 'ping', arguments: {} });
    expect(result.content).toEqual([{ type: 'text', text: 'pong' }]);
  });

  it('echo tool returns the input message', async () => {
    const result = await client.callTool({ name: 'echo', arguments: { message: 'hello world' } });
    expect(result.content).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('listTools returns all registered tools', async () => {
    const result = await client.listTools();
    const names = result.tools.map(t => t.name);
    expect(names).toContain('ping');
    expect(names).toContain('echo');
  });
});
