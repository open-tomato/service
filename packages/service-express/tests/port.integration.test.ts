import type { ServiceContext, ServiceHandle } from '../src/types.js';
import type { Logger } from '@open-tomato/service';
import type { MockInstance } from 'vitest';

import { createServer } from 'node:net';

import { PortInUseError, STARTED_MESSAGE } from '@open-tomato/service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createService } from '../src/create-service.js';

process.env.NODE_ENV = 'test';

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

/** Reads a spy's calls as plain argument lists across the logger overloads. */
function callsOf(spy: MockInstance<Logger['info']> | MockInstance<Logger['warn']>): unknown[][] {
  return spy.mock.calls as unknown[][];
}

describe('createService — taken port (integration)', () => {
  let handle: ServiceHandle | undefined;
  let held: HeldPort | undefined;
  const savedEnv = { PORT: process.env['PORT'], PORT_STRICT: process.env['PORT_STRICT'] };

  beforeEach(async () => {
    delete process.env['PORT'];
    delete process.env['PORT_STRICT'];
    held = await holdPort();
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

  it('falls back to the next port, warns, and logs started with fallbackPort', async () => {
    const taken = held!.port;
    const spies: { current?: LogSpies } = {};

    handle = await createService({ serviceId: 'port-it', port: taken, register: spyRegister(spies) });

    expect(handle.port).toBeGreaterThan(taken);
    expect(handle.port).toBeLessThanOrEqual(taken + 20);
    const { info, warn } = spies.current!;
    const warnings = callsOf(warn);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]![0]).toMatchObject({ takenPort: taken, port: handle.port, strictKey: 'strictPort' });
    expect(String(warnings[0]![1])).toContain(`port ${taken} is taken`);
    const started = callsOf(info).filter((call) => call[1] === STARTED_MESSAGE);
    expect(started).toHaveLength(1);
    expect(started[0]![0]).toMatchObject({ fallbackPort: taken, url: handle.url });
  });

  it('rejects with PortInUseError when strictPort is true', async () => {
    await expect(
      createService({ serviceId: 'port-it', port: held!.port, strictPort: true, register() {} }),
    ).rejects.toBeInstanceOf(PortInUseError);
  });

  it('rejects with PortInUseError when PORT_STRICT=true', async () => {
    process.env['PORT_STRICT'] = 'true';

    await expect(
      createService({ serviceId: 'port-it', port: held!.port, register() {} }),
    ).rejects.toBeInstanceOf(PortInUseError);
  });
});
