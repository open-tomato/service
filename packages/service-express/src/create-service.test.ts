import type { ServiceContext , ServiceHandle } from './types.js';

import { createDependency } from '@open-tomato/service';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { passthroughMiddleware } from './auth.js';
import { createService } from './create-service.js';

// Tests run in test mode — no process.exit, ephemeral port
process.env.NODE_ENV = 'test';

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

describe('createService — startup', () => {
  let handle: ServiceHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.stop();
      handle = undefined;
    }
  });

  it('minimal config starts and GET /health returns 200', async () => {
    handle = await createService({
      serviceId: 'test-svc',
      register() {},
    });

    const res = await request(handle.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('dependency start() is called before register()', async () => {
    const events: string[] = [];

    const dep = createDependency({
      name: 'db',
      async onStart() {
        events.push('start');
      },
    });

    handle = await createService({
      serviceId: 'test-svc',
      dependencies: [dep],
      register() {
        events.push('register');
      },
    });

    expect(events).toEqual(['start', 'register']);
  });

  it('throws at startup when control.enabled is true and secret is empty', async () => {
    await expect(
      createService({
        serviceId: 'test-svc',
        control: { enabled: true, secret: '' },
        register() {},
      }),
    ).rejects.toThrow('control.secret must be a non-empty string when the control plane is enabled');
  });

  it('does not throw at startup when control.enabled is false and secret is empty', async () => {
    handle = await createService({
      serviceId: 'test-svc',
      control: { enabled: false, secret: '' },
      register() {},
    });
    expect(handle).toBeDefined();
  });

  it('throws if a dependency start() throws (test mode)', async () => {
    const dep = createDependency({
      name: 'failing-dep',
      async onStart() {
        throw new Error('start failed');
      },
    });

    await expect(
      createService({
        serviceId: 'test-svc',
        dependencies: [dep],
        register() {},
      }),
    ).rejects.toThrow('start failed');
  });

  it('register receives a ServiceContext with all expected fields', async () => {
    let capturedCtx: ServiceContext | undefined;

    handle = await createService({
      serviceId: 'test-svc',
      register(_app, ctx) {
        capturedCtx = ctx;
      },
    });

    expect(capturedCtx).toBeDefined();
    expect(typeof capturedCtx!.logger.info).toBe('function');
    expect(typeof capturedCtx!.logger.warn).toBe('function');
    expect(typeof capturedCtx!.logger.error).toBe('function');
    expect(typeof capturedCtx!.logger.debug).toBe('function');
    expect(capturedCtx!.requireAuth).toBeDefined();
    expect(capturedCtx!.optionalAuth).toBeDefined();
    expect(typeof capturedCtx!.deps.get).toBe('function');
    expect(typeof capturedCtx!.clients.get).toBe('function');
    expect(capturedCtx!.config).toBeDefined();
    expect(capturedCtx!.config.serviceId).toBe('test-svc');
  });
});

// ---------------------------------------------------------------------------
// DepsMap
// ---------------------------------------------------------------------------

describe('createService — DepsMap', () => {
  let handle: ServiceHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.stop();
      handle = undefined;
    }
  });

  it('deps.get(dep) returns the typed .client instance after startup', async () => {
    const fakeClient = { query: () => 'result' };
    const dep = createDependency({ name: 'db', client: fakeClient });
    let capturedCtx: ServiceContext | undefined;

    handle = await createService({
      serviceId: 'test-svc',
      dependencies: [dep],
      register(_app, ctx) {
        capturedCtx = ctx;
      },
    });

    expect(capturedCtx!.deps.get(dep)).toBe(fakeClient);
  });

  it('deps.get(unknownDep) throws with a message containing the dependency name', async () => {
    let capturedCtx: ServiceContext | undefined;

    handle = await createService({
      serviceId: 'test-svc',
      register(_app, ctx) {
        capturedCtx = ctx;
      },
    });

    const unknownDep = createDependency({ name: 'not-registered' });
    expect(() => capturedCtx!.deps.get(unknownDep)).toThrow('not-registered');
  });
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe('createService — auth', () => {
  let handle: ServiceHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.stop();
      handle = undefined;
    }
  });

  it('requireAuth is passthroughMiddleware when no auth config is provided', async () => {
    let capturedCtx: ServiceContext | undefined;

    handle = await createService({
      serviceId: 'test-svc',
      register(_app, ctx) {
        capturedCtx = ctx;
      },
    });

    expect(capturedCtx!.requireAuth).toBe(passthroughMiddleware);
  });

  it('optionalAuth is passthroughMiddleware when no auth config is provided', async () => {
    let capturedCtx: ServiceContext | undefined;

    handle = await createService({
      serviceId: 'test-svc',
      register(_app, ctx) {
        capturedCtx = ctx;
      },
    });

    expect(capturedCtx!.optionalAuth).toBe(passthroughMiddleware);
  });

  it('throws at startup when auth.introspectUrl is set without introspectSecret', async () => {
    // A half-configured auth block (URL but no secret) must fail at boot —
    // never start up and silently 401 every request forever.
    const badConfig = {
      serviceId: 'test-svc',
      auth: { introspectUrl: 'http://auth.test/introspect' },
      register() {},
    } as unknown as Parameters<typeof createService>[0];

    await expect(createService(badConfig)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Plugin ordering
// ---------------------------------------------------------------------------

describe('createService — plugin ordering', () => {
  let handle: ServiceHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.stop();
      handle = undefined;
    }
  });

  it('plugins receive ctx.logger with standard log methods', async () => {
    let pluginLogger: unknown;

    const plugin = {
      name: 'logger-check',
      register: vi.fn(({ logger }: { logger: unknown }) => {
        pluginLogger = logger;
      }),
    };

    handle = await createService({
      serviceId: 'test-svc',
      plugins: [plugin],
      register() {},
    });

    expect(pluginLogger).toBeDefined();
    expect(typeof (pluginLogger as { info?: unknown }).info).toBe('function');
    expect(typeof (pluginLogger as { warn?: unknown }).warn).toBe('function');
    expect(typeof (pluginLogger as { error?: unknown }).error).toBe('function');
  });

  it('plugins are applied in array order: plugin[0].register before plugin[1].register', async () => {
    const callOrder: string[] = [];

    const plugin0 = {
      name: 'plugin-0',
      register: vi.fn(async () => {
        callOrder.push('plugin-0');
      }),
    };
    const plugin1 = {
      name: 'plugin-1',
      register: vi.fn(async () => {
        callOrder.push('plugin-1');
      }),
    };

    handle = await createService({
      serviceId: 'test-svc',
      plugins: [plugin0, plugin1],
      register() {},
    });

    expect(callOrder).toEqual(['plugin-0', 'plugin-1']);
  });
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

describe('createService — error handler', () => {
  let handle: ServiceHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.stop();
      handle = undefined;
    }
  });

  it('a route that throws is caught by the error handler and returns a 5xx response', async () => {
    handle = await createService({
      serviceId: 'test-svc',
      register(app) {
        app.get('/boom', (_req, _res, next) => {
          next(new Error('test error'));
        });
      },
    });

    const res = await request(handle.app).get('/boom');
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.status).toBeLessThan(600);
  });
});
