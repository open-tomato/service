/**
 * Integration test for the startup port rule of `createMCP` over real
 * sockets: a held health port and MCP port make an HTTP start fall back to
 * the next ports, and a strict flag turns the taken port into a
 * `PortInUseError`.
 */
import type { MCPConfig, MCPHandle } from '../src/types.js';
import type { Logger } from '@open-tomato/service';
import type { Server } from 'node:net';

import { createServer } from 'node:net';

import { PortInUseError } from '@open-tomato/service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMCP } from '../src/create-mcp.js';

// Unique ports: other test files use 3001 to 3099 and 8080 to 8097.
const MCP_PORT = 8111;
const HEALTH_PORT = 3111;

const ENV_NAMES = ['NODE_ENV', 'MCP_TRANSPORT', 'PORT', 'PORT_STRICT', 'HEALTH_PORT', 'HEALTH_PORT_STRICT'] as const;

/** Holds `port` with a real server until it is closed. */
function hold(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, () => resolve(server));
  });
}

/** Closes `server`. */
function release(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

/** Reads the calls of a logger spy as unknown arrays. */
function callsOf(spy: { mock: { calls: unknown[][] } }): unknown[][] {
  return spy.mock.calls;
}

describe('createMCP port fallback over real servers', () => {
  const saved: Record<string, string | undefined> = {};
  let held: Server[] = [];
  let handle: MCPHandle | undefined;
  let warn: ReturnType<typeof vi.spyOn> | undefined;
  let info: ReturnType<typeof vi.spyOn> | undefined;

  /**
   * Starts a handle on the held ports, spying on its logger from inside
   * `setup`. `ports` replaces the port fields of the config, so a case can
   * leave a port to the environment.
   */
  function start(
    health: { strictPort?: boolean } = {},
    ports: Pick<MCPConfig, 'port' | 'health'> = { port: MCP_PORT, health: { port: HEALTH_PORT, ...health } },
  ): MCPHandle {
    handle = createMCP({
      serviceId: 'ports-test',
      ...ports,
      logger: { level: 'silent' },
      setup: (_server, { logger }: { logger: Logger }) => {
        warn = vi.spyOn(logger, 'warn');
        info = vi.spyOn(logger, 'info');
      },
    });
    return handle;
  }

  beforeEach(async () => {
    for (const name of ENV_NAMES) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    process.env['NODE_ENV'] = 'test';
    held = [await hold(HEALTH_PORT), await hold(MCP_PORT)];
  });

  afterEach(async () => {
    await handle?.stop().catch(() => undefined);
    handle = undefined;
    warn?.mockRestore();
    info?.mockRestore();
    await Promise.all(held.map(release));
    for (const name of ENV_NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it('starts on the next ports, warns for both and logs a started record with both fallbacks', async () => {
    const address = await start().ready();

    expect(address.port).toBeGreaterThan(MCP_PORT);
    expect(address.healthPort).toBeGreaterThan(HEALTH_PORT);

    const warnings = callsOf(warn!).map(call => call[0]);
    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ takenPort: MCP_PORT, port: address.port }),
      expect.objectContaining({ takenPort: HEALTH_PORT, port: address.healthPort }),
    ]));

    const started = callsOf(info!).find(call => call[1] === 'started');
    expect(started?.[0]).toMatchObject({
      transport: 'http',
      url: `http://localhost:${address.port}`,
      healthUrl: `http://localhost:${address.healthPort}/health`,
      fallbackPort: MCP_PORT,
      healthFallbackPort: HEALTH_PORT,
    });
  });

  it('rejects ready() with PortInUseError naming health.port when health.strictPort is true', async () => {
    const error = await start({ strictPort: true }).ready()
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(PortInUseError);
    expect((error as Error).message).toBe(`port ${HEALTH_PORT} is taken; set health.port to a free port`);
    expect(callsOf(info!).some(call => call[1] === 'started')).toBe(false);
  });

  it('rejects ready() with PortInUseError naming health.port when HEALTH_PORT_STRICT is true', async () => {
    process.env['HEALTH_PORT_STRICT'] = 'true';

    const error = await start().ready()
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(PortInUseError);
    expect((error as Error).message).toBe(`port ${HEALTH_PORT} is taken; set health.port to a free port`);
    expect(callsOf(info!).some(call => call[1] === 'started')).toBe(false);
  });

  it('names HEALTH_PORT in the PortInUseError when HEALTH_PORT gave the port and HEALTH_PORT_STRICT is true', async () => {
    process.env['HEALTH_PORT'] = String(HEALTH_PORT);
    process.env['HEALTH_PORT_STRICT'] = 'true';

    const error = await start({}, { port: MCP_PORT }).ready()
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(PortInUseError);
    expect((error as Error).message).toBe(`port ${HEALTH_PORT} is taken; set HEALTH_PORT to a free port`);
  });

  it('names PORT in the PortInUseError when PORT gave the port and PORT_STRICT is true', async () => {
    process.env['PORT'] = String(MCP_PORT);
    process.env['PORT_STRICT'] = 'true';

    const error = await start({}, { health: { port: HEALTH_PORT } }).ready()
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(PortInUseError);
    expect((error as Error).message).toBe(`port ${MCP_PORT} is taken; set PORT to a free port`);
  });
});
