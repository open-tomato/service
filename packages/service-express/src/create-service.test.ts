import type { ServiceContext , ServiceHandle } from './types.js';
import type { Logger } from '@open-tomato/service';
import type { MockInstance } from 'vitest';

import { createServer } from 'node:net';

import { createDependency, NotFoundError, PortInUseError, STARTED_MESSAGE } from '@open-tomato/service';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { passthroughMiddleware } from './auth.js';
import { readServiceVersion } from './control/version.js';
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
    expect(res.status).toBe(500);
    expect(res.body).toStrictEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  });

  it('answers an error class with its status and body', async () => {
    handle = await createService({
      serviceId: 'test-svc',
      register(app) {
        app.get('/orders/:id', (req) => {
          throw new NotFoundError('order not found', { orderId: req.params['id'] });
        });
      },
    });

    const res = await request(handle.app).get('/orders/o-1');
    expect(res.status).toBe(404);
    expect(res.body).toStrictEqual({ code: 'NOT_FOUND', message: 'order not found', details: { orderId: 'o-1' } });
  });

  it('answers with config.formatError when the service gives one', async () => {
    handle = await createService({
      serviceId: 'test-svc',
      formatError: (err) => ({ status: 400, body: { code: 'ORDERS_FAILED', message: String((err as Error).message) } }),
      register(app) {
        app.get('/boom', () => {
          throw new Error('custom');
        });
      },
    });

    const res = await request(handle.app).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body).toStrictEqual({ code: 'ORDERS_FAILED', message: 'custom' });
  });

  it('rejects a formatError that is not a function', async () => {
    await expect(createService({
      serviceId: 'test-svc',
      formatError: 'json' as never,
      register() {},
    })).rejects.toThrow('formatError must be a function');
  });
});

// ---------------------------------------------------------------------------
// Port and startup banner
// ---------------------------------------------------------------------------

interface HeldPort {
  port: number
  release: () => Promise<void>
}

/** Holds a port the system chose with a real `node:net` server. */
function holdPort(): Promise<HeldPort> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address !== 'object') {
        reject(new Error('held server has no TCP address'));
        return;
      }
      resolve({
        port: address.port,
        release: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

/** A port the system chose and released again, so it is free for now. */
async function freePort(): Promise<number> {
  const held = await holdPort();
  await held.release();
  return held.port;
}

interface LogSpies {
  info: MockInstance<Logger['info']>
  warn: MockInstance<Logger['warn']>
}

/** Spies on the service logger's `info` and `warn` from inside `register`. */
function spyRegister(spies: { current?: LogSpies }) {
  return (_app: unknown, ctx: ServiceContext): void => {
    spies.current = {
      info: vi.spyOn(ctx.logger, 'info'),
      warn: vi.spyOn(ctx.logger, 'warn'),
    };
  };
}

/** Every call to `info`, read as plain argument lists across its overloads. */
function infoCalls(spies: LogSpies): unknown[][] {
  return spies.info.mock.calls as unknown[][];
}

/** The calls to `info` whose message is `started`. */
function startedCalls(spies: LogSpies): unknown[][] {
  return infoCalls(spies).filter((call) => call[1] === STARTED_MESSAGE);
}

describe('createService — port and startup banner', () => {
  let handle: ServiceHandle | undefined;
  let held: HeldPort | undefined;
  const savedEnv = { PORT: process.env['PORT'], PORT_STRICT: process.env['PORT_STRICT'] };

  beforeEach(() => {
    delete process.env['PORT'];
    delete process.env['PORT_STRICT'];
  });

  afterEach(async () => {
    if (handle) {
      await handle.stop();
      handle = undefined;
    }
    if (held) {
      await held.release();
      held = undefined;
    }
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('rejects with PortInUseError naming port when strictPort is set and the port is taken', async () => {
    held = await holdPort();

    const started = createService({ serviceId: 'test-svc', port: held.port, strictPort: true, register() {} });

    await expect(started).rejects.toBeInstanceOf(PortInUseError);
    await expect(started).rejects.toThrow(`port ${held.port} is taken; set port to a free port`);
  });

  it('names PORT in PortInUseError when PORT gave the port and PORT_STRICT makes it strict', async () => {
    held = await holdPort();
    process.env['PORT'] = String(held.port);
    process.env['PORT_STRICT'] = 'true';

    await expect(createService({ serviceId: 'test-svc', register() {} }))
      .rejects.toThrow(`port ${held.port} is taken; set PORT to a free port`);
  });

  it('binds an ephemeral port under NODE_ENV=test when no port is given, and exposes it as port and url', async () => {
    handle = await createService({ serviceId: 'test-svc', register() {} });

    expect(handle.port).toBeGreaterThan(0);
    expect(handle.port).not.toBe(3000);
    expect(handle.url).toBe(`http://localhost:${handle.port}`);
    const res = await fetch(`${handle.url}/health`);
    expect(res.status).toBe(200);
  });

  it('listens on the port the config names under NODE_ENV=test', async () => {
    const port = await freePort();

    handle = await createService({ serviceId: 'test-svc', port, register() {} });

    expect(handle.port).toBe(port);
    expect(handle.url).toBe(`http://localhost:${port}`);
  });

  it('listens on PORT under NODE_ENV=test when the config names no port', async () => {
    const port = await freePort();
    process.env['PORT'] = String(port);

    handle = await createService({ serviceId: 'test-svc', register() {} });

    expect(handle.port).toBe(port);
  });

  it('logs started once it listens, with transport http, the bound url, the version and the features', async () => {
    const spies: { current?: LogSpies } = {};

    handle = await createService({
      serviceId: 'test-svc',
      features: { auth: 'password', backup: true, workers: 2 },
      register: spyRegister(spies),
    });

    const calls = startedCalls(spies.current!);
    expect(calls).toHaveLength(1);
    // No `service` here: the logger binds it on every line, so the record repeating it would
    // write the key twice into the JSON line.
    expect(calls[0]![0]).toStrictEqual({
      version: readServiceVersion(),
      transport: 'http',
      url: handle.url,
      features: { auth: 'password', backup: true, workers: 2 },
    });
    expect(spies.current!.warn).not.toHaveBeenCalled();
  });

  it('falls back from a taken port, warning before the banner, which carries fallbackPort', async () => {
    held = await holdPort();
    const spies: { current?: LogSpies } = {};

    handle = await createService({ serviceId: 'test-svc', port: held.port, register: spyRegister(spies) });

    expect(handle.port).toBeGreaterThan(held.port);
    expect(handle.port).toBeLessThanOrEqual(held.port + 20);
    const { info, warn } = spies.current!;
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toStrictEqual({
      takenPort: held.port,
      port: handle.port,
      strictKey: 'strictPort',
      strictEnv: 'PORT_STRICT',
    });
    const calls = startedCalls(spies.current!);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toMatchObject({ url: `http://localhost:${handle.port}`, fallbackPort: held.port, features: {} });
    const startedOrder = info.mock.invocationCallOrder[infoCalls(spies.current!).indexOf(calls[0]!)]!;
    expect(warn.mock.invocationCallOrder[0]).toBeLessThan(startedOrder);
  });
});
