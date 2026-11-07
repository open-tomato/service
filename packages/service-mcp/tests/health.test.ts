import type { HealthServerConfig, HealthServerHandle } from '../src/health.js';
import type { TypedClient } from '@open-tomato/service';
import type { AddressInfo } from 'node:net';

import { EventEmitter } from 'node:events';
import { createServer as createNetServer, Server } from 'node:net';

import { createConsoleLogger, PortInUseError } from '@open-tomato/service';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildHealthResponse, startHealthServer } from '../src/health.js';

function makeClient(name: string, status: string): TypedClient<unknown> {
  return { name, status } as unknown as TypedClient<unknown>;
}

describe('buildHealthResponse', () => {
  it('returns status "ok" when all clients are running', () => {
    const clients = [makeClient('a', 'running'), makeClient('b', 'running')];
    const result = buildHealthResponse('my-service', clients);
    expect(result.status).toBe('ok');
    expect(result.serviceId).toBe('my-service');
    expect(result.clients).toEqual({
      a: { status: 'running' },
      b: { status: 'running' },
    });
  });

  it('returns status "error" when any client has status "error"', () => {
    const clients = [makeClient('a', 'running'), makeClient('b', 'error')];
    const result = buildHealthResponse('my-service', clients);
    expect(result.status).toBe('error');
  });

  it('returns status "degraded" when a client has status "starting" and none have "error"', () => {
    const clients = [makeClient('a', 'running'), makeClient('b', 'starting')];
    const result = buildHealthResponse('my-service', clients);
    expect(result.status).toBe('degraded');
  });

  it('returns status "degraded" when a client has status "degraded" (circuit half-open)', () => {
    const clients = [makeClient('a', 'running'), makeClient('b', 'degraded')];
    const result = buildHealthResponse('my-service', clients);
    expect(result.status).toBe('degraded');
  });

  it('returns status "ok" and empty clients map for an empty array', () => {
    const result = buildHealthResponse('my-service', []);
    expect(result.status).toBe('ok');
    expect(result.clients).toEqual({});
  });
});

/** Calls of a spied logger method, read as plain arrays. */
function callsOf(spy: { mock: { calls: unknown } }): unknown[][] {
  return spy.mock.calls as unknown[][];
}

/** Holds a port the system chose with a real server, resolving with the server and its port. */
async function holdPort(): Promise<{ held: Server; port: number }> {
  const held = createNetServer();
  await new Promise<void>((resolve) => held.listen(0, resolve));
  const address = held.address() as AddressInfo;
  return { held, port: address.port };
}

/** Closes `server`, resolving once it has stopped listening. */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('startHealthServer', () => {
  let server: HealthServerHandle | null = null;
  let held: Server | null = null;
  const logger = createConsoleLogger('svc', { level: 'silent' });

  afterEach(async () => {
    server?.stop();
    server = null;
    if (held) await closeServer(held);
    held = null;
    vi.restoreAllMocks();
  });

  function start(overrides: Partial<HealthServerConfig> = {}): Promise<HealthServerHandle> {
    return startHealthServer({
      port: 0, strict: false, path: '/health', serviceId: 'svc', clients: [], logger, ...overrides,
    });
  }

  it('responds with 200 and ok payload at the configured path', async () => {
    server = await start();
    const res = await fetch(`http://localhost:${server.port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; serviceId: string };
    expect(body.status).toBe('ok');
    expect(body.serviceId).toBe('svc');
  });

  it('responds with 503 when any client is in error state', async () => {
    server = await start({ clients: [makeClient('http-client', 'error')] });
    const res = await fetch(`http://localhost:${server.port}/health`);
    expect(res.status).toBe(503);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('error');
  });

  it('responds with 200 when a client is degraded (circuit half-open)', async () => {
    server = await start({ clients: [makeClient('http-client', 'degraded')] });
    const res = await fetch(`http://localhost:${server.port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('degraded');
  });

  it('responds with 404 for unrecognised paths', async () => {
    server = await start();
    const res = await fetch(`http://localhost:${server.port}/other`);
    expect(res.status).toBe(404);
  });

  it('uses the configured path', async () => {
    server = await start({ path: '/healthz' });
    expect((await fetch(`http://localhost:${server.port}/healthz`)).status).toBe(200);
    expect((await fetch(`http://localhost:${server.port}/health`)).status).toBe(404);
  });

  it('resolves with the port it is bound to, the system\'s choice for port 0', async () => {
    server = await start();
    expect(server.port).toBeGreaterThan(0);
    expect(server.requested).toBe(0);
    expect(server.fellBack).toBe(false);
  });

  it('listens on the asked port when it is free, and logs no warning', async () => {
    const probe = await holdPort();
    await closeServer(probe.held);
    const warn = vi.spyOn(logger, 'warn');
    server = await start({ port: probe.port });
    expect(server.port).toBe(probe.port);
    expect(server.fellBack).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back past a taken port, serves on the next one, and logs the fallback warning', async () => {
    const taken = await holdPort();
    held = taken.held;
    const warn = vi.spyOn(logger, 'warn');
    server = await start({ port: taken.port });

    expect(server.port).toBeGreaterThan(taken.port);
    expect(server.requested).toBe(taken.port);
    expect(server.fellBack).toBe(true);
    expect((await fetch(`http://localhost:${server.port}/health`)).status).toBe(200);

    const calls = callsOf(warn);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toEqual({
      takenPort: taken.port,
      port: server.port,
      strictKey: 'health.strictPort',
      strictEnv: 'HEALTH_PORT_STRICT',
    });
    expect(calls[0]?.[1]).toBe(
      `port ${taken.port} is taken, falling back to ${server.port}; set health.strictPort or HEALTH_PORT_STRICT=true to fail instead`,
    );
  });

  it('rejects with PortInUseError naming health.port when the port is taken under strict', async () => {
    const taken = await holdPort();
    held = taken.held;
    const warn = vi.spyOn(logger, 'warn');
    const started = start({ port: taken.port, strict: true });
    await expect(started).rejects.toBeInstanceOf(PortInUseError);
    await expect(started).rejects.toMatchObject({ port: taken.port, configKey: 'health.port' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('names the config key it is given in the PortInUseError', async () => {
    const taken = await holdPort();
    held = taken.held;
    await expect(start({ port: taken.port, strict: true, configKey: 'HEALTH_PORT' }))
      .rejects.toMatchObject({ configKey: 'HEALTH_PORT' });
  });

  it('logs an error the server raises once listening instead of leaving it unhandled', async () => {
    const error = vi.spyOn(logger, 'error');
    const on = vi.spyOn(EventEmitter.prototype, 'on');
    server = await start();
    const errorListeners = callsOf(on).filter(call => call[0] === 'error');
    on.mockRestore();
    const listener = errorListeners.at(-1)?.[1] as ((err: Error) => void) | undefined;
    expect(listener).toBeTypeOf('function');
    const boom = new Error('boom');
    listener?.(boom);
    expect(callsOf(error)).toEqual([[{ err: boom }, 'Health server error']]);
  });
});
