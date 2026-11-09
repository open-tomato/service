import { createServer } from 'node:net';

import { Client } from '@modelcontextprotocol/sdk/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createConsoleLogger } from '@open-tomato/service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { wireHttpTransport } from '../src/transport.js';

// Unique ports: other test files use 8085, 8096, 8097 and 8098.
const PORT_NODE = 8091;
const PORT_TWO_CLIENTS = 8092;
const PORT_RECONNECT = 8093;
const PORT_CLOSE = 8094;

type WithBun = { Bun?: unknown };

const logger = createConsoleLogger('node-transport', { level: 'silent' });

/** Resolves when `port` can be listened on, rejects when it is still taken. */
function listenOnce(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(port, () => probe.close(() => resolve()));
  });
}

/** A server factory whose every server answers `ping` with `pong`. */
function pingServerFactory(): () => Promise<McpServer> {
  return async () => {
    const server = new McpServer({ name: 'node-transport', version: '1.0.0' });
    server.registerTool('ping', { description: 'Answers pong' }, async () => ({
      content: [{ type: 'text', text: 'pong' }],
    }));
    return server;
  };
}

async function connectClient(port: number): Promise<{ client: Client, transport: StreamableHTTPClientTransport }> {
  const client = new Client({ name: 'node-transport-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`));
  await client.connect(transport);
  return { client, transport };
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
    const handle = await wireHttpTransport({
      createSessionServer: pingServerFactory(),
      port: PORT_NODE,
      strict: true,
      logger,
    });
    expect(handle.port).toBe(PORT_NODE);
    expect(handle.fellBack).toBe(false);
    const { client } = await connectClient(PORT_NODE);

    const result = await client.callTool({ name: 'ping', arguments: {} });
    expect(result.content).toEqual([{ type: 'text', text: 'pong' }]);

    await client.close();
    await handle.close();
    await expect(listenOnce(PORT_NODE)).resolves.toBeUndefined();
  });

  it('serves two clients at once, each on its own session and server', async () => {
    const createSessionServer = vi.fn(pingServerFactory());
    const handle = await wireHttpTransport({ createSessionServer, port: PORT_TWO_CLIENTS, strict: true, logger });

    const first = await connectClient(PORT_TWO_CLIENTS);
    const second = await connectClient(PORT_TWO_CLIENTS);

    expect(first.transport.sessionId).toBeDefined();
    expect(first.transport.sessionId).not.toBe(second.transport.sessionId);
    expect((await first.client.listTools()).tools.map(t => t.name)).toEqual(['ping']);
    expect((await second.client.listTools()).tools.map(t => t.name)).toEqual(['ping']);
    expect(createSessionServer).toHaveBeenCalledTimes(2);
    expect(handle.sessionCount()).toBe(2);

    await first.client.close();
    await second.client.close();
    await handle.close();
  });

  it('lets a client end its session and connect again without a restart', async () => {
    const handle = await wireHttpTransport({
      createSessionServer: pingServerFactory(),
      port: PORT_RECONNECT,
      strict: true,
      logger,
    });

    const first = await connectClient(PORT_RECONNECT);
    await first.transport.terminateSession();
    await first.client.close();
    expect(handle.sessionCount()).toBe(0);

    const second = await connectClient(PORT_RECONNECT);
    const result = await second.client.callTool({ name: 'ping', arguments: {} });
    expect(result.content).toEqual([{ type: 'text', text: 'pong' }]);

    await second.client.close();
    await handle.close();
  });

  it('close() ends every open session and frees the port', async () => {
    const handle = await wireHttpTransport({
      createSessionServer: pingServerFactory(),
      port: PORT_CLOSE,
      strict: true,
      logger,
    });
    const first = await connectClient(PORT_CLOSE);
    const second = await connectClient(PORT_CLOSE);

    await handle.close();

    expect(handle.sessionCount()).toBe(0);
    await expect(first.client.listTools()).rejects.toThrow();
    await expect(second.client.listTools()).rejects.toThrow();
    await expect(listenOnce(PORT_CLOSE)).resolves.toBeUndefined();
  });
});
