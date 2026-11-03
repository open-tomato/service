import type { Dependency } from './types.js';

import { describe, expect, it } from 'vitest';

import {
  controlStatus,
  listDependencies,
  pauseDependency,
  resetClient,
  restartDependency,
  resumeDependency,
  verifyControlToken,
} from './control.js';
import { createDependency } from './dependency.js';
import { createHttpClient } from './http-client.js';
import { createConsoleLogger } from './logger.js';
import { createRuntime } from './runtime.js';

const silent = createConsoleLogger('test', { level: 'silent' });

/** A started runtime with a database (with health detail), a cache, and one client. */
async function startedRuntime(overrides: { cache?: Dependency } = {}) {
  const runtime = createRuntime({
    serviceId: 'orders',
    logger: silent,
    dependencies: {
      db: createDependency({ name: 'db', healthDetail: () => ({ pool: 5 }) }),
      cache: overrides.cache ?? createDependency({ name: 'cache' }),
    },
    clients: {
      inventory: createHttpClient({ stock: async (): Promise<number> => 1 }, { name: 'inventory' }),
    },
  });
  await runtime.ensureStarted();
  return runtime;
}

/** A dependency with only the required lifecycle: no pause or resume. */
function bare(name: string): Dependency {
  let status: Dependency['status'] = 'stopped';
  return {
    name,
    get status() { return status; },
    async start() { status = 'running'; },
    async stop() { status = 'stopped'; },
  };
}

describe('controlStatus', () => {
  it('reports the service, its health status, uptime, version, and each entry', async () => {
    const runtime = await startedRuntime();

    const result = controlStatus(runtime, { version: '2.0.0', startedAt: 1_000, now: 61_500 });

    expect(result).toEqual({
      code: 200,
      body: {
        serviceId: 'orders',
        status: 'ok',
        uptime: 60,
        version: '2.0.0',
        dependencies: { db: { status: 'running', detail: { pool: 5 } }, cache: { status: 'running' } },
        clients: { inventory: { status: 'running', circuitBreaker: 'closed' } },
      },
    });
  });

  it('answers 200 whatever the health, which the body carries', async () => {
    const runtime = await startedRuntime();
    await runtime.deps.cache.stop();

    const result = controlStatus(runtime, { version: '2.0.0', startedAt: 0, now: 0 });

    expect(result.code).toBe(200);
    expect(result.body.status).toBe('error');
    expect(result.body.dependencies['cache']).toEqual({ status: 'stopped' });
  });

  it.each([
    ['running', 'closed'],
    ['degraded', 'half-open'],
    ['error', 'open'],
    ['stopped', 'unknown'],
  ] as const)('maps a client status %s to the breaker state %s', (status, breaker) => {
    const client: Dependency = { ...bare('inventory'), status };
    const runtime = createRuntime({ serviceId: 'orders', logger: silent, clients: { inventory: client } });

    expect(controlStatus(runtime, { version: '1', startedAt: 0, now: 0 }).body.clients['inventory']?.circuitBreaker).toBe(breaker);
  });
});

describe('listDependencies', () => {
  it('lists each dependency with its status and detail, in order', async () => {
    const runtime = await startedRuntime();

    expect(listDependencies(runtime)).toEqual({
      code: 200,
      body: [{ name: 'db', status: 'running', detail: { pool: 5 } }, { name: 'cache', status: 'running' }],
    });
  });
});

describe('pauseDependency and resumeDependency', () => {
  it('pauses and resumes a dependency by name', async () => {
    const runtime = await startedRuntime();

    expect(await pauseDependency(runtime, 'cache')).toEqual({ code: 200, body: { ok: true } });
    expect(runtime.deps.cache.status).toBe('paused');
    expect(await resumeDependency(runtime, 'cache')).toEqual({ code: 200, body: { ok: true } });
    expect(runtime.deps.cache.status).toBe('running');
  });

  it('answers 404 for a name it does not know', async () => {
    const runtime = await startedRuntime();

    expect(await pauseDependency(runtime, 'nope')).toEqual({ code: 404, body: { error: 'dependency not found' } });
  });

  it('does not reach clients', async () => {
    const runtime = await startedRuntime();

    expect(await pauseDependency(runtime, 'inventory')).toEqual({ code: 404, body: { error: 'dependency not found' } });
  });

  it('answers 400 for an empty name', async () => {
    const runtime = await startedRuntime();

    expect(await resumeDependency(runtime, '')).toEqual({ code: 400, body: { error: 'invalid name parameter' } });
  });

  it('answers 400 for a dependency without pause or resume', async () => {
    const runtime = await startedRuntime({ cache: bare('cache') });

    expect(await pauseDependency(runtime, 'cache')).toEqual({ code: 400, body: { error: 'dependency does not support pause' } });
    expect(await resumeDependency(runtime, 'cache')).toEqual({ code: 400, body: { error: 'dependency does not support resume' } });
  });

  it('answers 500 with the message when the dependency throws', async () => {
    const runtime = await startedRuntime();

    const result = await resumeDependency(runtime, 'cache');

    expect(result).toEqual({ code: 500, body: { error: '[cache] Cannot resume a dependency that is not paused (current: running)' } });
  });
});

describe('restartDependency', () => {
  it('stops and starts a dependency by name', async () => {
    const log: string[] = [];
    const cache = createDependency({ name: 'cache', onStart: () => { log.push('start'); }, onStop: () => { log.push('stop'); } });
    const runtime = await startedRuntime({ cache });
    log.length = 0;

    expect(await restartDependency(runtime, 'cache')).toEqual({ code: 200, body: { ok: true } });
    expect(log).toEqual(['stop', 'start']);
  });

  it('answers 500 with the message when the start fails', async () => {
    let starts = 0;
    const cache = createDependency({
      name: 'cache',
      onStart: () => {
        starts++;
        if (starts > 1) throw new Error('cache is down');
      },
    });
    const runtime = await startedRuntime({ cache });

    expect(await restartDependency(runtime, 'cache')).toEqual({ code: 500, body: { error: 'cache is down' } });
  });
});

describe('resetClient', () => {
  it('stops and starts a client by name', async () => {
    const runtime = await startedRuntime();
    await runtime.clients.inventory.stop();

    expect(await resetClient(runtime, 'inventory')).toEqual({ code: 200, body: { ok: true } });
    expect(runtime.clients.inventory.status).toBe('running');
  });

  it('does not reach dependencies', async () => {
    const runtime = await startedRuntime();

    expect(await resetClient(runtime, 'db')).toEqual({ code: 404, body: { error: 'client not found' } });
  });
});

describe('verifyControlToken', () => {
  it('accepts the matching token', async () => {
    expect(await verifyControlToken('s3cret-token', 's3cret-token')).toBe(true);
  });

  it.each([
    ['a different token', 's3cret-tokeN'],
    ['a prefix', 's3cret'],
    ['a longer token', 's3cret-token!'],
    ['an empty token', ''],
    ['no token', undefined],
    ['a repeated header', ['s3cret-token', 's3cret-token']],
    ['a one-item header array, whose text is the token', ['s3cret-token']],
    ['a number', 42],
  ])('rejects %s', async (_label, given) => {
    expect(await verifyControlToken(given, 's3cret-token')).toBe(false);
  });

  it('rejects everything when the expected secret is empty', async () => {
    expect(await verifyControlToken('', '')).toBe(false);
  });
});
