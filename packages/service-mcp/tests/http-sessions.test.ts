import type { HttpSessions } from '../src/http-sessions.js';
import type { Server } from 'node:http';

import { createServer } from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHttpSessions } from '../src/http-sessions.js';

// Unique port: other test files use 8085, 8091 to 8094, 8096 and 8097.
const PORT = 8098;
const URL_ = `http://localhost:${PORT}/mcp`;

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'sessions-test', version: '1.0.0' },
  },
};

const LIST_TOOLS = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };

// Each test stops its server, so a pooled keep-alive socket would be dead
// for the next test: every request asks for its own connection.
const HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  connection: 'close',
};

function post(body: string, extra: Record<string, string> = {}): Promise<Response> {
  return fetch(URL_, { method: 'POST', headers: { ...HEADERS, ...extra }, body });
}

async function initialize(): Promise<string> {
  const res = await post(JSON.stringify(INITIALIZE));
  expect(res.status).toBe(200);
  const sessionId = res.headers.get('mcp-session-id');
  if (sessionId === null) throw new Error('initialize returned no session id');
  await res.text();
  return sessionId;
}

function listen(server: Server): Promise<void> {
  return new Promise(resolve => server.listen(PORT, () => resolve()));
}

function stop(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise(resolve => server.close(() => resolve()));
}

describe('createHttpSessions', () => {
  let httpServer: Server;
  let sessions: HttpSessions;
  let createSessionServer: ReturnType<typeof vi.fn<() => Promise<McpServer>>>;
  let onError: ReturnType<typeof vi.fn<(error: unknown) => void>>;

  beforeEach(async () => {
    createSessionServer = vi.fn(async () => new McpServer({ name: 'sessions', version: '1.0.0' }));
    onError = vi.fn();
    sessions = createHttpSessions({ createSessionServer, onError });
    httpServer = createServer((req, res) => {
      sessions.handleRequest(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    await listen(httpServer);
  });

  afterEach(async () => {
    await sessions.closeAll();
    await stop(httpServer);
  });

  it('opens one session per initialize and runs the factory once each', async () => {
    const first = await initialize();
    const second = await initialize();

    expect(first).not.toBe(second);
    expect(createSessionServer).toHaveBeenCalledTimes(2);
    expect(sessions.count()).toBe(2);
  });

  it('routes a request with a known session id to that session', async () => {
    createSessionServer.mockImplementation(async () => {
      const server = new McpServer({ name: 'sessions', version: '1.0.0' });
      const name = `tool-${createSessionServer.mock.calls.length}`;
      server.registerTool(name, { description: name }, async () => ({ content: [] }));
      return server;
    });
    const first = await initialize();
    const second = await initialize();

    // The SDK answers a POST as an SSE stream; the result is its `data:` line.
    const names = async (sessionId: string): Promise<string[]> => {
      const res = await post(JSON.stringify(LIST_TOOLS), { 'mcp-session-id': sessionId });
      expect(res.status).toBe(200);
      const data = (await res.text()).split('\n').find(line => line.startsWith('data: '));
      if (data === undefined) throw new Error('no data line in the SSE response');
      const body = JSON.parse(data.slice('data: '.length)) as { result: { tools: { name: string }[] } };
      return body.result.tools.map(tool => tool.name);
    };

    expect(await names(first)).toEqual(['tool-1']);
    expect(await names(second)).toEqual(['tool-2']);
  });

  it('answers 404 to an unknown session id', async () => {
    const res = await post(JSON.stringify(LIST_TOOLS), { 'mcp-session-id': 'stale' });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: -32001, message: 'Session not found' } });
    expect(createSessionServer).not.toHaveBeenCalled();
  });

  it('answers 400 to a POST without a session id that is not an initialize', async () => {
    const res = await post(JSON.stringify(LIST_TOOLS));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: -32000 } });
    expect(createSessionServer).not.toHaveBeenCalled();
  });

  it('treats an empty session id header as missing', async () => {
    const res = await post(JSON.stringify(LIST_TOOLS), { 'mcp-session-id': '' });

    expect(res.status).toBe(400);
    expect(createSessionServer).not.toHaveBeenCalled();
  });

  it('answers 400 to a GET or DELETE without a session id', async () => {
    const get = await fetch(URL_, { headers: { accept: 'text/event-stream', connection: 'close' } });
    const del = await fetch(URL_, { method: 'DELETE', headers: { connection: 'close' } });

    expect(get.status).toBe(400);
    expect(del.status).toBe(400);
    expect(createSessionServer).not.toHaveBeenCalled();
  });

  it('answers 400 to a body that is not JSON', async () => {
    const res = await post('{not json');

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: -32700 } });
  });

  it('answers 413 to a body over the size limit', async () => {
    const res = await post(`"${'x'.repeat(4 * 1024 * 1024 + 1)}"`);

    expect(res.status).toBe(413);
  });

  it('answers 413 to a chunked body that grows over the size limit', async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(120);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 5; i += 1) controller.enqueue(chunk);
        controller.close();
      },
    });

    // `duplex` is required for a streamed body and missing from the lib types.
    const init = { method: 'POST', headers: HEADERS, body, duplex: 'half' } as Parameters<typeof fetch>[1];
    const res = await fetch(URL_, init);

    expect(res.status).toBe(413);
  });

  it('closes the transport it built when the SDK refuses the initialize', async () => {
    const noAccept = await fetch(URL_, {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify(INITIALIZE),
    });
    const batch = await post(JSON.stringify([INITIALIZE, LIST_TOOLS]));

    expect(noAccept.status).toBe(406);
    expect(batch.status).toBe(400);
    expect(createSessionServer).toHaveBeenCalledTimes(2);
    expect(sessions.count()).toBe(0);
    expect(sessions.pending()).toBe(0);
  });

  it('answers 500 and reports the error when the factory fails', async () => {
    createSessionServer.mockRejectedValueOnce(new Error('setup failed'));

    const res = await post(JSON.stringify(INITIALIZE));

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: -32603 } });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'setup failed' }));
    expect(sessions.count()).toBe(0);
  });

  it('forgets a session the client ends with DELETE', async () => {
    const sessionId = await initialize();

    const res = await fetch(URL_, {
      method: 'DELETE',
      headers: { 'mcp-session-id': sessionId, connection: 'close' },
    });

    expect(res.status).toBe(200);
    expect(sessions.count()).toBe(0);
    const after = await post(JSON.stringify(LIST_TOOLS), { 'mcp-session-id': sessionId });
    expect(after.status).toBe(404);
  });

  it('closeAll refuses an initialize that is still being opened', async () => {
    let releaseFactory: () => void = () => {};
    createSessionServer.mockImplementationOnce(() => new Promise(resolve => {
      releaseFactory = () => resolve(new McpServer({ name: 'late', version: '1.0.0' }));
    }));

    const pending = post(JSON.stringify(INITIALIZE));
    await vi.waitFor(() => expect(sessions.pending()).toBe(1));
    const closing = sessions.closeAll();
    releaseFactory();
    const res = await pending;
    await closing;

    expect(res.status).toBe(503);
    expect(sessions.count()).toBe(0);
    expect(sessions.pending()).toBe(0);
  });

  it('refuses a new initialize after closeAll', async () => {
    await sessions.closeAll();

    const res = await post(JSON.stringify(INITIALIZE));

    expect(res.status).toBe(503);
    expect(createSessionServer).not.toHaveBeenCalled();
  });

  it('closeAll ends every session', async () => {
    const sessionId = await initialize();
    await initialize();

    await sessions.closeAll();

    expect(sessions.count()).toBe(0);
    const after = await post(JSON.stringify(LIST_TOOLS), { 'mcp-session-id': sessionId });
    expect(after.status).toBe(404);
  });
});
