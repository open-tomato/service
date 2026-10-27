import type { ResolvedServiceConfig } from './schema.js';
import type { Dependency, DependencyStatus } from '@open-tomato/service';

import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { mountBuiltinRoutes } from './builtin-routes.js';

function makeDep(status: DependencyStatus, name = 'dep'): Dependency {
  return {
    name,
    status,
    start: async () => {},
    stop: async () => {},
  };
}

function makeApp(deps: Dependency[], clients: Dependency[]) {
  const app = express();
  const config = {
    dependencies: deps,
    clients,
    serviceId: 'test-service',
  } as unknown as ResolvedServiceConfig;
  mountBuiltinRoutes(app, config, {} as never, {} as never);
  return app;
}

describe('GET /health', () => {
  it('returns 200 when all dependencies are running', async () => {
    const app = makeApp([makeDep('running')], [makeDep('running', 'client')]);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('returns 200 when a dependency is degraded', async () => {
    const app = makeApp([makeDep('degraded')], []);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('returns 503 when a dependency is in error state', async () => {
    const app = makeApp([makeDep('running'), makeDep('error', 'db2')], []);
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error' });
  });

  it('returns 200 when only a client is degraded', async () => {
    const app = makeApp([makeDep('running')], [makeDep('degraded', 'auth-client')]);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('returns 503 when a client is in error state', async () => {
    const app = makeApp([makeDep('running')], [makeDep('error', 'auth-client')]);
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error' });
  });

  it('returns 200 when there are no dependencies or clients', async () => {
    const app = makeApp([], []);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
