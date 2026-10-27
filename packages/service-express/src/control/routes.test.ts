import type { Dependency } from '@open-tomato/service';

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createControlRouter } from './routes.js';

const SECRET = 'test-secret';

function makeApp(
  deps: Dependency[],
  clients: Dependency[],
  enabled = true,
) {
  const app = express();
  app.use(
    '/_control',
    createControlRouter(deps, clients, { enabled, secret: SECRET }, 'my-service'),
  );
  return app;
}

function makeDep(overrides: Partial<Dependency> = {}): Dependency {
  return {
    name: 'db',
    status: 'running',
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Dependency;
}

// ---------------------------------------------------------------------------
// GET /_control/status
// ---------------------------------------------------------------------------

describe('GET /_control/status', () => {
  it('returns 200 with full payload when all deps and clients are running', async () => {
    const dep = makeDep({ name: 'db', status: 'running' });
    const client = makeDep({ name: 'auth-service', status: 'running' });
    const app = makeApp([dep], [client]);

    const res = await request(app)
      .get('/_control/status')
      .set('x-control-token', SECRET);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      serviceId: 'my-service',
      status: 'running',
      // Status reports the live package version (readServiceVersion); assert the
      // shape, not a frozen literal, so release bumps don't break this test.
      version: expect.stringMatching(/^\d+\.\d+\.\d+/),
      dependencies: {
        db: { status: 'running' },
      },
      clients: {
        'auth-service': { status: 'running', circuitBreaker: 'closed' },
      },
    });
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('omits detail when dependency does not implement healthDetail', async () => {
    const dep = makeDep({ name: 'db', status: 'running' });
    const app = makeApp([dep], []);

    const res = await request(app)
      .get('/_control/status')
      .set('x-control-token', SECRET);

    expect(res.status).toBe(200);
    expect(res.body.dependencies.db).not.toHaveProperty('detail');
  });

  it('includes detail when dependency implements healthDetail', async () => {
    const dep = {
      ...makeDep({ name: 'db', status: 'running' }),
      healthDetail: vi.fn().mockReturnValue({ pool: { idle: 4, active: 1 } }),
    };
    const app = makeApp([dep as unknown as Dependency], []);

    const res = await request(app)
      .get('/_control/status')
      .set('x-control-token', SECRET);

    expect(res.status).toBe(200);
    expect(res.body.dependencies.db.detail).toEqual({ pool: { idle: 4, active: 1 } });
  });

  it('maps client status to circuitBreaker: closed when running', async () => {
    const client = makeDep({ name: 'api', status: 'running' });
    const res = await request(makeApp([], [client]))
      .get('/_control/status')
      .set('x-control-token', SECRET);
    expect(res.body.clients.api.circuitBreaker).toBe('closed');
  });

  it('maps client status to circuitBreaker: half-open when degraded', async () => {
    const client = makeDep({ name: 'api', status: 'degraded' });
    const res = await request(makeApp([], [client]))
      .get('/_control/status')
      .set('x-control-token', SECRET);
    expect(res.body.clients.api.circuitBreaker).toBe('half-open');
  });

  it('maps client status to circuitBreaker: open when error', async () => {
    const client = makeDep({ name: 'api', status: 'error' });
    const res = await request(makeApp([], [client]))
      .get('/_control/status')
      .set('x-control-token', SECRET);
    expect(res.body.clients.api.circuitBreaker).toBe('open');
  });

  it('reports aggregate status as degraded when any dep is degraded', async () => {
    const dep = makeDep({ name: 'db', status: 'degraded' });
    const res = await request(makeApp([dep], []))
      .get('/_control/status')
      .set('x-control-token', SECRET);
    expect(res.body.status).toBe('degraded');
  });

  it('reports aggregate status as error when any dep is in error', async () => {
    const dep = makeDep({ name: 'db', status: 'error' });
    const res = await request(makeApp([dep], []))
      .get('/_control/status')
      .set('x-control-token', SECRET);
    expect(res.body.status).toBe('error');
  });

  it('always returns 200 even when dependencies are in error state', async () => {
    const dep = makeDep({ name: 'db', status: 'error' });
    const res = await request(makeApp([dep], []))
      .get('/_control/status')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(200);
  });

  it('returns 403 when x-control-token is missing', async () => {
    const res = await request(makeApp([], []))
      .get('/_control/status');
    expect(res.status).toBe(403);
  });

  it('returns 403 when x-control-token is wrong', async () => {
    const res = await request(makeApp([], []))
      .get('/_control/status')
      .set('x-control-token', 'wrong');
    expect(res.status).toBe(403);
  });

  it('returns 404 when control plane is disabled', async () => {
    const res = await request(makeApp([], [], false))
      .get('/_control/status')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(404);
  });

  it('handles empty deps and clients', async () => {
    const res = await request(makeApp([], []))
      .get('/_control/status')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(200);
    expect(res.body.dependencies).toEqual({});
    expect(res.body.clients).toEqual({});
    expect(res.body.status).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// GET /_control/dependencies
// ---------------------------------------------------------------------------

describe('GET /_control/dependencies', () => {
  it('returns 200 with an array of dependency objects', async () => {
    const dep = makeDep({ name: 'db', status: 'running' });
    const res = await request(makeApp([dep], []))
      .get('/_control/dependencies')
      .set('x-control-token', SECRET);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ name: 'db', status: 'running' }]);
  });

  it('omits detail when dependency does not implement healthDetail', async () => {
    const dep = makeDep({ name: 'db', status: 'running' });
    const res = await request(makeApp([dep], []))
      .get('/_control/dependencies')
      .set('x-control-token', SECRET);

    expect(res.status).toBe(200);
    expect(res.body[0]).not.toHaveProperty('detail');
  });

  it('includes detail when dependency implements healthDetail', async () => {
    const dep = {
      ...makeDep({ name: 'db', status: 'running' }),
      healthDetail: vi.fn().mockReturnValue({ pool: { idle: 4, active: 1 } }),
    };
    const res = await request(makeApp([dep as unknown as Dependency], []))
      .get('/_control/dependencies')
      .set('x-control-token', SECRET);

    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual({
      name: 'db',
      status: 'running',
      detail: { pool: { idle: 4, active: 1 } },
    });
  });

  it('returns empty array when there are no dependencies', async () => {
    const res = await request(makeApp([], []))
      .get('/_control/dependencies')
      .set('x-control-token', SECRET);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns multiple dependencies in order', async () => {
    const db = makeDep({ name: 'db', status: 'running' });
    const redis = makeDep({ name: 'redis', status: 'degraded' });
    const res = await request(makeApp([db, redis], []))
      .get('/_control/dependencies')
      .set('x-control-token', SECRET);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { name: 'db', status: 'running' },
      { name: 'redis', status: 'degraded' },
    ]);
  });

  it('returns 403 when x-control-token is missing', async () => {
    const res = await request(makeApp([], []))
      .get('/_control/dependencies');
    expect(res.status).toBe(403);
  });

  it('returns 403 when x-control-token is wrong', async () => {
    const res = await request(makeApp([], []))
      .get('/_control/dependencies')
      .set('x-control-token', 'wrong');
    expect(res.status).toBe(403);
  });

  it('returns 404 when control plane is disabled', async () => {
    const res = await request(makeApp([], [], false))
      .get('/_control/dependencies')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /_control/dependencies/:name/pause
// ---------------------------------------------------------------------------

describe('POST /_control/dependencies/:name/pause', () => {
  it('returns 404 when the dependency name is not found', async () => {
    const res = await request(makeApp([], []))
      .post('/_control/dependencies/unknown/pause')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'dependency not found' });
  });

  it('returns 400 when the dependency does not implement pause', async () => {
    const dep = makeDep({ name: 'db' });
    const res = await request(makeApp([dep], []))
      .post('/_control/dependencies/db/pause')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'dependency does not support pause' });
  });

  it('calls dep.pause() and returns 200 when supported', async () => {
    const pause = vi.fn().mockResolvedValue(undefined);
    const resume = vi.fn().mockResolvedValue(undefined);
    const dep = { ...makeDep({ name: 'db' }), pause, resume };
    const res = await request(makeApp([dep as unknown as Dependency], []))
      .post('/_control/dependencies/db/pause')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(200);
    expect(pause).toHaveBeenCalledOnce();
  });

  it('returns 500 when dep.pause() throws', async () => {
    const pause = vi.fn().mockRejectedValue(new Error('pause failed'));
    const resume = vi.fn().mockResolvedValue(undefined);
    const dep = { ...makeDep({ name: 'db' }), pause, resume };
    const res = await request(makeApp([dep as unknown as Dependency], []))
      .post('/_control/dependencies/db/pause')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'pause failed' });
  });

  it('returns 403 when x-control-token is missing', async () => {
    const res = await request(makeApp([], []))
      .post('/_control/dependencies/db/pause');
    expect(res.status).toBe(403);
  });

  it('returns 403 when x-control-token is wrong', async () => {
    const res = await request(makeApp([], []))
      .post('/_control/dependencies/db/pause')
      .set('x-control-token', 'wrong');
    expect(res.status).toBe(403);
  });

  it('returns 404 when control plane is disabled', async () => {
    const dep = makeDep({ name: 'db' });
    const res = await request(makeApp([dep], [], false))
      .post('/_control/dependencies/db/pause')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /_control/dependencies/:name/resume
// ---------------------------------------------------------------------------

describe('POST /_control/dependencies/:name/resume', () => {
  it('returns 404 when the dependency name is not found', async () => {
    const res = await request(makeApp([], []))
      .post('/_control/dependencies/unknown/resume')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'dependency not found' });
  });

  it('returns 400 when the dependency does not implement resume', async () => {
    const dep = makeDep({ name: 'db' });
    const res = await request(makeApp([dep], []))
      .post('/_control/dependencies/db/resume')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'dependency does not support resume' });
  });

  it('calls dep.resume() and returns 200 when supported', async () => {
    const pause = vi.fn().mockResolvedValue(undefined);
    const resume = vi.fn().mockResolvedValue(undefined);
    const dep = { ...makeDep({ name: 'db' }), pause, resume };
    const res = await request(makeApp([dep as unknown as Dependency], []))
      .post('/_control/dependencies/db/resume')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(200);
    expect(resume).toHaveBeenCalledOnce();
  });

  it('returns 500 when dep.resume() throws', async () => {
    const pause = vi.fn().mockResolvedValue(undefined);
    const resume = vi.fn().mockRejectedValue(new Error('resume failed'));
    const dep = { ...makeDep({ name: 'db' }), pause, resume };
    const res = await request(makeApp([dep as unknown as Dependency], []))
      .post('/_control/dependencies/db/resume')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'resume failed' });
  });

  it('returns 403 when x-control-token is missing', async () => {
    const res = await request(makeApp([], []))
      .post('/_control/dependencies/db/resume');
    expect(res.status).toBe(403);
  });

  it('returns 403 when x-control-token is wrong', async () => {
    const res = await request(makeApp([], []))
      .post('/_control/dependencies/db/resume')
      .set('x-control-token', 'wrong');
    expect(res.status).toBe(403);
  });

  it('returns 404 when control plane is disabled', async () => {
    const dep = makeDep({ name: 'db' });
    const res = await request(makeApp([dep], [], false))
      .post('/_control/dependencies/db/resume')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /_control/dependencies/:name/restart
// ---------------------------------------------------------------------------

describe('POST /_control/dependencies/:name/restart', () => {
  it('returns 404 when the dependency name is not found', async () => {
    const res = await request(makeApp([], []))
      .post('/_control/dependencies/unknown/restart')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'dependency not found' });
  });

  it('returns 400 when the dependency does not implement stop/start', async () => {
    const dep = { name: 'db', status: 'running' } as unknown as Dependency;
    const res = await request(makeApp([dep], []))
      .post('/_control/dependencies/db/restart')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'dependency does not support restart' });
  });

  it('calls stop() before start() and returns 200 on success', async () => {
    const callOrder: string[] = [];
    const stop = vi.fn().mockImplementation(() => {
      callOrder.push('stop');
      return Promise.resolve();
    });
    const start = vi.fn().mockImplementation(() => {
      callOrder.push('start');
      return Promise.resolve();
    });
    const dep = makeDep({ name: 'db', stop, start });
    const res = await request(makeApp([dep], []))
      .post('/_control/dependencies/db/restart')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(200);
    expect(callOrder).toEqual(['stop', 'start']);
  });

  it('returns 500 when stop() throws', async () => {
    const stop = vi.fn().mockRejectedValue(new Error('stop failed'));
    const dep = makeDep({ name: 'db', stop });
    const res = await request(makeApp([dep], []))
      .post('/_control/dependencies/db/restart')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'stop failed' });
  });

  it('returns 500 when start() throws', async () => {
    const start = vi.fn().mockRejectedValue(new Error('start failed'));
    const dep = makeDep({ name: 'db', start });
    const res = await request(makeApp([dep], []))
      .post('/_control/dependencies/db/restart')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'start failed' });
  });

  it('returns 403 when x-control-token is missing', async () => {
    const res = await request(makeApp([], []))
      .post('/_control/dependencies/db/restart');
    expect(res.status).toBe(403);
  });

  it('returns 403 when x-control-token is wrong', async () => {
    const res = await request(makeApp([], []))
      .post('/_control/dependencies/db/restart')
      .set('x-control-token', 'wrong');
    expect(res.status).toBe(403);
  });

  it('returns 404 when control plane is disabled', async () => {
    const dep = makeDep({ name: 'db' });
    const res = await request(makeApp([dep], [], false))
      .post('/_control/dependencies/db/restart')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /_control/clients/:name/reset
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// POST /_control/stop
// ---------------------------------------------------------------------------

describe('POST /_control/stop', () => {
  it('responds 200 with { ok: true } before triggering shutdown', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const res = await request(makeApp([], []))
      .post('/_control/stop')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    killSpy.mockRestore();
  });

  it('triggers process.kill with SIGTERM after responding', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    await request(makeApp([], []))
      .post('/_control/stop')
      .set('x-control-token', SECRET);
    await new Promise(resolve => setImmediate(resolve));
    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM');
    killSpy.mockRestore();
  });

  it('returns 403 when x-control-token is missing', async () => {
    const res = await request(makeApp([], []))
      .post('/_control/stop');
    expect(res.status).toBe(403);
  });

  it('returns 403 when x-control-token is wrong', async () => {
    const res = await request(makeApp([], []))
      .post('/_control/stop')
      .set('x-control-token', 'wrong');
    expect(res.status).toBe(403);
  });

  it('returns 404 when control plane is disabled', async () => {
    const res = await request(makeApp([], [], false))
      .post('/_control/stop')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /_control/clients/:name/reset
// ---------------------------------------------------------------------------

describe('POST /_control/clients/:name/reset', () => {
  it('returns 404 when the client name is not found', async () => {
    const res = await request(makeApp([], []))
      .post('/_control/clients/unknown/reset')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'client not found' });
  });

  it('calls stop() then start() and returns 200 on success', async () => {
    const callOrder: string[] = [];
    const stop = vi.fn().mockImplementation(() => {
      callOrder.push('stop');
      return Promise.resolve();
    });
    const start = vi.fn().mockImplementation(() => {
      callOrder.push('start');
      return Promise.resolve();
    });
    const client = makeDep({ name: 'auth-service', stop, start });
    const res = await request(makeApp([], [client]))
      .post('/_control/clients/auth-service/reset')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(200);
    expect(callOrder).toEqual(['stop', 'start']);
  });

  it('returns 500 when stop() throws', async () => {
    const stop = vi.fn().mockRejectedValue(new Error('stop failed'));
    const client = makeDep({ name: 'auth-service', stop });
    const res = await request(makeApp([], [client]))
      .post('/_control/clients/auth-service/reset')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'stop failed' });
  });

  it('returns 500 when start() throws', async () => {
    const start = vi.fn().mockRejectedValue(new Error('start failed'));
    const client = makeDep({ name: 'auth-service', start });
    const res = await request(makeApp([], [client]))
      .post('/_control/clients/auth-service/reset')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'start failed' });
  });

  it('returns 403 when x-control-token is missing', async () => {
    const res = await request(makeApp([], []))
      .post('/_control/clients/auth-service/reset');
    expect(res.status).toBe(403);
  });

  it('returns 403 when x-control-token is wrong', async () => {
    const res = await request(makeApp([], []))
      .post('/_control/clients/auth-service/reset')
      .set('x-control-token', 'wrong');
    expect(res.status).toBe(403);
  });

  it('returns 404 when control plane is disabled', async () => {
    const client = makeDep({ name: 'auth-service' });
    const res = await request(makeApp([], [client], false))
      .post('/_control/clients/auth-service/reset')
      .set('x-control-token', SECRET);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// All routes return 404 when control plane is disabled — no auth required
// Confirms that controlEnabled fires before controlAuth: callers receive 404
// even when the x-control-token header is absent or wrong.
// ---------------------------------------------------------------------------

describe('all routes return 404 when control plane is disabled (no auth header)', () => {
  const disabledApp = () => makeApp([], [], false);

  it('GET /_control/status → 404', async () => {
    const res = await request(disabledApp()).get('/_control/status');
    expect(res.status).toBe(404);
  });

  it('GET /_control/dependencies → 404', async () => {
    const res = await request(disabledApp()).get('/_control/dependencies');
    expect(res.status).toBe(404);
  });

  it('POST /_control/dependencies/:name/pause → 404', async () => {
    const res = await request(disabledApp()).post('/_control/dependencies/db/pause');
    expect(res.status).toBe(404);
  });

  it('POST /_control/dependencies/:name/resume → 404', async () => {
    const res = await request(disabledApp()).post('/_control/dependencies/db/resume');
    expect(res.status).toBe(404);
  });

  it('POST /_control/dependencies/:name/restart → 404', async () => {
    const res = await request(disabledApp()).post('/_control/dependencies/db/restart');
    expect(res.status).toBe(404);
  });

  it('POST /_control/clients/:name/reset → 404', async () => {
    const res = await request(disabledApp()).post('/_control/clients/auth-service/reset');
    expect(res.status).toBe(404);
  });

  it('POST /_control/stop → 404', async () => {
    const res = await request(disabledApp()).post('/_control/stop');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// All routes return 403 when x-control-token is wrong or missing (control enabled)
// Confirms that controlAuth fires on all routes when the control plane is enabled.
// ---------------------------------------------------------------------------

describe('all routes return 403 when x-control-token is wrong or missing (and control is enabled)', () => {
  const enabledApp = () => makeApp([], [], true);

  it('GET /_control/status → 403 when token is missing', async () => {
    const res = await request(enabledApp()).get('/_control/status');
    expect(res.status).toBe(403);
  });

  it('GET /_control/status → 403 when token is wrong', async () => {
    const res = await request(enabledApp()).get('/_control/status')
      .set('x-control-token', 'bad');
    expect(res.status).toBe(403);
  });

  it('GET /_control/dependencies → 403 when token is missing', async () => {
    const res = await request(enabledApp()).get('/_control/dependencies');
    expect(res.status).toBe(403);
  });

  it('GET /_control/dependencies → 403 when token is wrong', async () => {
    const res = await request(enabledApp()).get('/_control/dependencies')
      .set('x-control-token', 'bad');
    expect(res.status).toBe(403);
  });

  it('POST /_control/dependencies/:name/pause → 403 when token is missing', async () => {
    const res = await request(enabledApp()).post('/_control/dependencies/db/pause');
    expect(res.status).toBe(403);
  });

  it('POST /_control/dependencies/:name/pause → 403 when token is wrong', async () => {
    const res = await request(enabledApp()).post('/_control/dependencies/db/pause')
      .set('x-control-token', 'bad');
    expect(res.status).toBe(403);
  });

  it('POST /_control/dependencies/:name/resume → 403 when token is missing', async () => {
    const res = await request(enabledApp()).post('/_control/dependencies/db/resume');
    expect(res.status).toBe(403);
  });

  it('POST /_control/dependencies/:name/resume → 403 when token is wrong', async () => {
    const res = await request(enabledApp()).post('/_control/dependencies/db/resume')
      .set('x-control-token', 'bad');
    expect(res.status).toBe(403);
  });

  it('POST /_control/dependencies/:name/restart → 403 when token is missing', async () => {
    const res = await request(enabledApp()).post('/_control/dependencies/db/restart');
    expect(res.status).toBe(403);
  });

  it('POST /_control/dependencies/:name/restart → 403 when token is wrong', async () => {
    const res = await request(enabledApp()).post('/_control/dependencies/db/restart')
      .set('x-control-token', 'bad');
    expect(res.status).toBe(403);
  });

  it('POST /_control/clients/:name/reset → 403 when token is missing', async () => {
    const res = await request(enabledApp()).post('/_control/clients/auth-service/reset');
    expect(res.status).toBe(403);
  });

  it('POST /_control/clients/:name/reset → 403 when token is wrong', async () => {
    const res = await request(enabledApp()).post('/_control/clients/auth-service/reset')
      .set('x-control-token', 'bad');
    expect(res.status).toBe(403);
  });

  it('POST /_control/stop → 403 when token is missing', async () => {
    const res = await request(enabledApp()).post('/_control/stop');
    expect(res.status).toBe(403);
  });

  it('POST /_control/stop → 403 when token is wrong', async () => {
    const res = await request(enabledApp()).post('/_control/stop')
      .set('x-control-token', 'bad');
    expect(res.status).toBe(403);
  });
});
