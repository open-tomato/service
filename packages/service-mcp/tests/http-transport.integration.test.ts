import { createServer } from 'node:net';

import { Client } from '@modelcontextprotocol/sdk/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { wireHttpTransport } from '../src/transport.js';

// Unique port: other integration files use 8085, 8096 and 8097.
const PORT = 8091;

type WithBun = { Bun?: unknown };

/** Resolves when `port` can be listened on, rejects when it is still taken. */
function listenOnce(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(port, () => probe.close(() => resolve()));
  });
}

describe('wireHttpTransport under Node', () => {
  let savedBun: unknown;

  beforeEach(() => {
    savedBun = (globalThis as WithBun).Bun;
    delete (globalThis as WithBun).Bun;
  });

  afterEach(() => {
    if (savedBun !== undefined) (globalThis as WithBun).Bun = savedBun;
  });

  it('serves MCP requests without Bun, and frees its port on close', async () => {
    const server = new McpServer({ name: 'node-transport', version: '1.0.0' });
    server.registerTool('ping', { description: 'Answers pong' }, async () => ({
      content: [{ type: 'text', text: 'pong' }],
    }));

    const handle = await wireHttpTransport(server, PORT);
    const client = new Client({ name: 'node-transport-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${PORT}/mcp`)));

    const result = await client.callTool({ name: 'ping', arguments: {} });
    expect(result.content).toEqual([{ type: 'text', text: 'pong' }]);

    await client.close();
    await handle.close();
    await expect(listenOnce(PORT)).resolves.toBeUndefined();
  });
});
