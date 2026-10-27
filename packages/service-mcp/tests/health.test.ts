import type { TypedClient } from '@open-tomato/service';

import { afterEach, describe, expect, it } from 'vitest';

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

describe('startHealthServer', () => {
  let server: ReturnType<typeof startHealthServer> | null = null;

  afterEach(() => {
    server?.stop();
    server = null;
  });

  it('responds with 200 and ok payload at the configured path', async () => {
    server = startHealthServer({ port: 19501, path: '/health', serviceId: 'svc', clients: [] });
    const res = await fetch('http://localhost:19501/health');
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; serviceId: string };
    expect(body.status).toBe('ok');
    expect(body.serviceId).toBe('svc');
  });

  it('responds with 503 when any client is in error state', async () => {
    const clients = [makeClient('http-client', 'error')];
    server = startHealthServer({ port: 19502, path: '/health', serviceId: 'svc', clients });
    const res = await fetch('http://localhost:19502/health');
    expect(res.status).toBe(503);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('error');
  });

  it('responds with 200 when a client is degraded (circuit half-open)', async () => {
    const clients = [makeClient('http-client', 'degraded')];
    server = startHealthServer({ port: 19503, path: '/health', serviceId: 'svc', clients });
    const res = await fetch('http://localhost:19503/health');
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('degraded');
  });

  it('responds with 404 for unrecognised paths', async () => {
    server = startHealthServer({ port: 19504, path: '/health', serviceId: 'svc', clients: [] });
    const res = await fetch('http://localhost:19504/other');
    expect(res.status).toBe(404);
  });

  it('uses the configured path', async () => {
    server = startHealthServer({ port: 19505, path: '/health', serviceId: 'svc', clients: [] });
    const res = await fetch('http://localhost:19505/health');
    expect(res.status).toBe(200);
  });
});
