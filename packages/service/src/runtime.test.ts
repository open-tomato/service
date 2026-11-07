import type { Dependency, TypedDependency } from './types.js';

import { describe, expect, expectTypeOf, it } from 'vitest';

import { createDependency } from './dependency.js';
import { createHttpClient } from './http-client.js';
import { createConsoleLogger } from './logger.js';
import { createRuntime } from './runtime.js';

const silent = createConsoleLogger('test', { level: 'silent' });

/** A dependency that records its start and stop in `log`. */
function tracked(name: string, log: string[], hooks: { onStart?: () => Promise<void> | void; onStop?: () => Promise<void> | void } = {}): Dependency {
  return createDependency({
    name,
    async onStart() {
      log.push(`start ${name}`);
      await hooks.onStart?.();
    },
    async onStop() {
      log.push(`stop ${name}`);
      await hooks.onStop?.();
    },
  });
}

/** A promise with its resolve function, for holding a hook open. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('createRuntime — start and stop order', () => {
  it('starts dependencies, then clients, in record order', async () => {
    const log: string[] = [];
    const runtime = createRuntime({
      serviceId: 'orders',
      logger: silent,
      dependencies: { db: tracked('db', log), cache: tracked('cache', log) },
      clients: { inventory: tracked('inventory', log) },
    });

    await runtime.ensureStarted();

    expect(log).toEqual(['start db', 'start cache', 'start inventory']);
    expect(runtime.state).toBe('running');
  });

  it('stops in reverse order', async () => {
    const log: string[] = [];
    const runtime = createRuntime({
      serviceId: 'orders',
      logger: silent,
      dependencies: { db: tracked('db', log), cache: tracked('cache', log) },
      clients: { inventory: tracked('inventory', log) },
    });
    await runtime.ensureStarted();
    log.length = 0;

    const result = await runtime.stop();

    expect(log).toEqual(['stop inventory', 'stop cache', 'stop db']);
    expect(result).toEqual({ stopped: ['inventory', 'cache', 'db'], failed: [], timedOut: [] });
    expect(runtime.state).toBe('stopped');
  });
});

describe('createRuntime — typed records', () => {
  it('gives each dependency and client back under its key, with its type', () => {
    const pool = { query: (): string => 'rows' };
    const db = createDependency({ name: 'db', client: pool });
    const inventory = createHttpClient({ stock: async (): Promise<number> => 3 }, { name: 'inventory' });

    const runtime = createRuntime({ serviceId: 'orders', logger: silent, dependencies: { db }, clients: { inventory } });

    expect(runtime.deps.db.client).toBe(pool);
    expect(runtime.clients.inventory).toBe(inventory);
    expectTypeOf(runtime.deps.db).toEqualTypeOf<TypedDependency<{ query: () => string }>>();
    expectTypeOf(runtime.clients.inventory.stock).toEqualTypeOf<() => Promise<number>>();
  });

  it('defaults to empty records', async () => {
    const runtime = createRuntime({ serviceId: 'orders', logger: silent });

    await runtime.ensureStarted();

    expect(runtime.deps).toEqual({});
    expect(runtime.clients).toEqual({});
    expect(runtime.state).toBe('running');
  });
});

describe('createRuntime — ensureStarted', () => {
  it('starts once for 100 concurrent calls', async () => {
    let starts = 0;
    const gate = deferred();
    const db = createDependency({
      name: 'db',
      async onStart() {
        starts++;
        await gate.promise;
      },
    });
    const runtime = createRuntime({ serviceId: 'orders', logger: silent, dependencies: { db } });

    const calls = Array.from({ length: 100 }, () => runtime.ensureStarted());
    expect(runtime.state).toBe('starting');
    gate.resolve();
    await Promise.all(calls);

    expect(starts).toBe(1);
    expect(runtime.state).toBe('running');
  });

  it('does not start again once running', async () => {
    const log: string[] = [];
    const runtime = createRuntime({ serviceId: 'orders', logger: silent, dependencies: { db: tracked('db', log) } });

    await runtime.ensureStarted();
    await runtime.ensureStarted();

    expect(log).toEqual(['start db']);
  });

  it('rolls back the started dependencies, in reverse, when one fails', async () => {
    const log: string[] = [];
    const boom = new Error('cache is down');
    const runtime = createRuntime({
      serviceId: 'orders',
      logger: silent,
      dependencies: {
        db: tracked('db', log),
        queue: tracked('queue', log),
        cache: tracked('cache', log, { onStart: () => { throw boom; } }),
        search: tracked('search', log),
      },
    });

    await expect(runtime.ensureStarted()).rejects.toBe(boom);

    expect(log).toEqual(['start db', 'start queue', 'start cache', 'stop queue', 'stop db']);
    expect(runtime.deps.cache.status).toBe('error');
    expect(runtime.deps.search.status).toBe('stopped');
    expect(runtime.state).toBe('idle');
  });

  it('tries again on the next call after a failed start', async () => {
    let attempts = 0;
    const db = createDependency({
      name: 'db',
      onStart() {
        attempts++;
        if (attempts === 1) throw new Error('not yet');
      },
    });
    const runtime = createRuntime({ serviceId: 'orders', logger: silent, dependencies: { db } });

    await expect(runtime.ensureStarted()).rejects.toThrow('not yet');
    await runtime.ensureStarted();

    expect(attempts).toBe(2);
    expect(runtime.state).toBe('running');
  });

  it('starts again after a stop', async () => {
    const log: string[] = [];
    const runtime = createRuntime({ serviceId: 'orders', logger: silent, dependencies: { db: tracked('db', log) } });

    await runtime.ensureStarted();
    await runtime.stop();
    await runtime.ensureStarted();

    expect(log).toEqual(['start db', 'stop db', 'start db']);
    expect(runtime.state).toBe('running');
  });

  it('rejects while the runtime is stopping', async () => {
    const gate = deferred();
    const runtime = createRuntime({
      serviceId: 'orders',
      logger: silent,
      dependencies: { db: tracked('db', [], { onStop: () => gate.promise }) },
    });
    await runtime.ensureStarted();

    const stopping = runtime.stop();
    await expect(runtime.ensureStarted()).rejects.toThrow(/stopping/);
    gate.resolve();
    await stopping;
  });
});

describe('createRuntime — stop', () => {
  it('reports a dependency whose stop outlasts the timeout, and stops the rest', async () => {
    const log: string[] = [];
    const runtime = createRuntime({
      serviceId: 'orders',
      logger: silent,
      stopTimeoutMs: 10,
      dependencies: {
        db: tracked('db', log),
        slow: tracked('slow', log, { onStop: () => new Promise<void>(() => {}) }),
      },
    });
    await runtime.ensureStarted();

    const result = await runtime.stop();

    expect(result).toEqual({ stopped: ['db'], failed: [], timedOut: ['slow'] });
    expect(log).toContain('stop db');
    expect(runtime.state).toBe('stopped');
  });

  it('reports a dependency whose stop throws, and stops the rest', async () => {
    const runtime = createRuntime({
      serviceId: 'orders',
      logger: silent,
      dependencies: {
        db: tracked('db', []),
        bad: tracked('bad', [], { onStop: () => { throw new Error('stuck'); } }),
      },
    });
    await runtime.ensureStarted();

    const result = await runtime.stop();

    expect(result).toEqual({ stopped: ['db'], failed: ['bad'], timedOut: [] });
  });

  it('does nothing before a start', async () => {
    const log: string[] = [];
    const runtime = createRuntime({ serviceId: 'orders', logger: silent, dependencies: { db: tracked('db', log) } });

    const result = await runtime.stop();

    expect(result).toEqual({ stopped: [], failed: [], timedOut: [] });
    expect(log).toEqual([]);
    expect(runtime.state).toBe('idle');
  });

  it('waits for a start in progress, then stops', async () => {
    const log: string[] = [];
    const gate = deferred();
    const runtime = createRuntime({
      serviceId: 'orders',
      logger: silent,
      dependencies: { db: tracked('db', log, { onStart: () => gate.promise }) },
    });

    const starting = runtime.ensureStarted();
    const stopping = runtime.stop();
    gate.resolve();
    await starting;
    await stopping;

    expect(log).toEqual(['start db', 'stop db']);
    expect(runtime.state).toBe('stopped');
  });

  it('stops once for concurrent calls', async () => {
    const log: string[] = [];
    const runtime = createRuntime({ serviceId: 'orders', logger: silent, dependencies: { db: tracked('db', log) } });
    await runtime.ensureStarted();

    const [first, second] = await Promise.all([runtime.stop(), runtime.stop()]);

    expect(log).toEqual(['start db', 'stop db']);
    expect(second).toEqual(first);
  });
});

describe('createRuntime — health', () => {
  it('follows the runtime through start and stop', async () => {
    const runtime = createRuntime({ serviceId: 'orders', logger: silent, dependencies: { db: tracked('db', []) } });

    expect(runtime.health()).toEqual({ status: 'degraded', dependencies: { db: 'stopped' } });
    await runtime.ensureStarted();
    expect(runtime.health()).toEqual({ status: 'ok', dependencies: { db: 'running' } });
    await runtime.stop();
    expect(runtime.health()).toEqual({ status: 'error', dependencies: { db: 'stopped' } });
  });
});

describe('createRuntime — validation', () => {
  it('rejects two entries that share a name', () => {
    expect(() => createRuntime({
      serviceId: 'orders',
      logger: silent,
      dependencies: { db: tracked('inventory', []) },
      clients: { inventory: tracked('inventory', []) },
    })).toThrow(new TypeError('createRuntime: duplicate dependency or client name "inventory"'));
  });

  it.each(['', '  '])('rejects the blank serviceId %j', (serviceId) => {
    expect(() => createRuntime({ serviceId, logger: silent })).toThrow(new TypeError('createRuntime: serviceId must be a non-empty string'));
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects the stop timeout %d', (stopTimeoutMs) => {
    expect(() => createRuntime({ serviceId: 'orders', logger: silent, stopTimeoutMs })).toThrow(new TypeError('createRuntime: stopTimeoutMs must be a finite number, 0 or more'));
  });
});
