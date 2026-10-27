import { describe, expect, it, vi } from 'vitest';

import { createDependency } from './dependency.js';

// ---------------------------------------------------------------------------
// Positive: full lifecycle
// ---------------------------------------------------------------------------

describe('createDependency — lifecycle', () => {
  it('starts in "stopped" state', () => {
    const dep = createDependency({ name: 'test' });
    expect(dep.status).toBe('stopped');
  });

  it('transitions stopped → running on successful start', async () => {
    const dep = createDependency({ name: 'test' });
    await dep.start();
    expect(dep.status).toBe('running');
  });

  it('transitions running → stopped on stop', async () => {
    const dep = createDependency({ name: 'test' });
    await dep.start();
    await dep.stop();
    expect(dep.status).toBe('stopped');
  });

  it('full lifecycle: stopped → starting → running → stopped', async () => {
    const events: string[] = [];

    const dep = createDependency({
      name: 'test',
      async onStart() {
        events.push('onStart');
      },
      async onStop() {
        events.push('onStop');
      },
    });

    expect(dep.status).toBe('stopped');
    const startPromise = dep.start();
    // By the time start() is awaited, status will be running
    await startPromise;
    expect(dep.status).toBe('running');
    await dep.stop();
    expect(dep.status).toBe('stopped');
    expect(events).toEqual(['onStart', 'onStop']);
  });

  it('calls onStart hook exactly once', async () => {
    const onStart = vi.fn(async () => {});
    const dep = createDependency({ name: 'test', onStart });
    await dep.start();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('calls onStop hook exactly once', async () => {
    const onStop = vi.fn(async () => {});
    const dep = createDependency({ name: 'test', onStop });
    await dep.start();
    await dep.stop();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('stop() is idempotent when already stopped', async () => {
    const onStop = vi.fn(async () => {});
    const dep = createDependency({ name: 'test', onStop });
    // Never started — already stopped
    await dep.stop();
    await dep.stop();
    expect(onStop).toHaveBeenCalledTimes(0);
    expect(dep.status).toBe('stopped');
  });

  it('allows restart from error state', async () => {
    let calls = 0;
    const dep = createDependency({
      name: 'test',
      async onStart() {
        calls++;
        if (calls === 1) throw new Error('first attempt fails');
      },
    });

    await expect(dep.start()).rejects.toThrow('first attempt fails');
    expect(dep.status).toBe('error');

    // Restart from error — should succeed
    await dep.start();
    expect(dep.status).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// Positive: typed client
// ---------------------------------------------------------------------------

describe('createDependency — typed client', () => {
  it('exposes the client on the returned object', async () => {
    const myClient = { query: async () => 'result' };
    const dep = createDependency({ name: 'db', client: myClient });
    expect(dep.client).toBe(myClient);
  });

  it('client is accessible after start', async () => {
    const myClient = { ping: async () => 'pong' };
    const dep = createDependency({ name: 'db', client: myClient });
    await dep.start();
    expect(await dep.client.ping()).toBe('pong');
    await dep.stop();
  });
});

// ---------------------------------------------------------------------------
// Positive: healthDetail
// ---------------------------------------------------------------------------

describe('createDependency — healthDetail', () => {
  it('exposes healthDetail when provided', () => {
    const dep = createDependency({
      name: 'test',
      healthDetail: () => ({ healthy: true }),
    });
    expect(typeof dep.healthDetail).toBe('function');
    expect(dep.healthDetail!()).toEqual({ healthy: true });
  });

  it('does not expose healthDetail when omitted', () => {
    const dep = createDependency({ name: 'test' });
    expect(dep.healthDetail).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Positive: metadata
// ---------------------------------------------------------------------------

describe('createDependency — metadata', () => {
  it('exposes metadata when provided', () => {
    const meta = { host: 'localhost', port: 5432 };
    const dep = createDependency({ name: 'db', metadata: meta });
    expect(dep.metadata).toEqual(meta);
  });

  it('metadata is undefined when not provided', () => {
    const dep = createDependency({ name: 'test' });
    expect(dep.metadata).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Negative: invalid state transitions
// ---------------------------------------------------------------------------

describe('createDependency — invalid transitions', () => {
  it('throws when start() is called on a running dependency', async () => {
    const dep = createDependency({ name: 'test' });
    await dep.start();
    expect(dep.status).toBe('running');
    await expect(dep.start()).rejects.toThrow(/already running/);
  });

  it('throws when start() is called while starting', async () => {
    let resolveStart!: () => void;
    const dep = createDependency({
      name: 'test',
      onStart() {
        return new Promise<void>((resolve) => {
          resolveStart = resolve;
        });
      },
    });

    const firstStart = dep.start();
    // At this point status is "starting"
    expect(dep.status).toBe('starting');
    await expect(dep.start()).rejects.toThrow(/already starting/);

    // Clean up
    resolveStart();
    await firstStart;
  });

  it('transitions to error when onStart rejects', async () => {
    const dep = createDependency({
      name: 'test',
      async onStart() {
        throw new Error('init failed');
      },
    });

    await expect(dep.start()).rejects.toThrow('init failed');
    expect(dep.status).toBe('error');
  });

  it('transitions to stopped even when onStop rejects', async () => {
    const dep = createDependency({
      name: 'test',
      async onStop() {
        throw new Error('cleanup failed');
      },
    });

    await dep.start();
    await expect(dep.stop()).rejects.toThrow('cleanup failed');
    expect(dep.status).toBe('stopped');
  });
});
