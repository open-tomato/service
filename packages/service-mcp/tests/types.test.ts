/**
 * Structural type tests for MCPConfig and MCPContext.
 *
 * Uses `satisfies` assertions to verify that concrete objects conform to the
 * exported interfaces at compile time, and runtime checks to guard against
 * accidental regressions in the schema defaults that back these types.
 */
import type { ClientsMap, HealthConfig, MCPConfig, MCPContext } from '../src/types.js';

import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// MCPConfig — structural satisfies checks
// ---------------------------------------------------------------------------

describe('MCPConfig', () => {
  it('accepts a minimal config (satisfies)', () => {
    const config = {
      serviceId: 'test-svc',
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      setup: (_server: unknown, _ctx: unknown) => {},
    } satisfies MCPConfig;

    expect(config.serviceId).toBe('test-svc');
    expect(typeof config.setup).toBe('function');
  });

  it('accepts a full config with clients and health overrides (satisfies)', () => {
    const config = {
      serviceId: 'full-svc',
      clients: [],
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      setup: (_server: unknown, _ctx: unknown) => {},
      health: { port: 9000, path: '/ping' },
      logger: { level: 'debug' as const },
    } satisfies MCPConfig;

    expect(config.health?.port).toBe(9000);
    expect(config.health?.path).toBe('/ping');
  });

  it('accepts health with only port specified', () => {
    const config = {
      serviceId: 'port-only',
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      setup: (_server: unknown, _ctx: unknown) => {},
      health: { port: 8080 },
    } satisfies MCPConfig;

    expect(config.health?.port).toBe(8080);
    expect((config.health as HealthConfig).path).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MCPContext — structural satisfies checks
// ---------------------------------------------------------------------------

describe('MCPContext', () => {
  it('accepts a valid context object (satisfies)', () => {
    const fakeClients: ClientsMap = {};
    const ctx = {
      logger: {
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {},
        level: 'info',
        child: () => ({}) as never,
      },
      clients: fakeClients,
    } satisfies MCPContext;

    expect(ctx.clients).toBe(fakeClients);
    expect(typeof ctx.logger.info).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// HealthConfig — standalone interface
// ---------------------------------------------------------------------------

describe('HealthConfig', () => {
  it('accepts empty object (all fields optional)', () => {
    const config = {} satisfies HealthConfig;
    expect(config).toEqual({});
  });

  it('accepts port-only config', () => {
    const config = { port: 3001 } satisfies HealthConfig;
    expect(config.port).toBe(3001);
  });

  it('accepts path-only config', () => {
    const config = { path: '/healthz' } satisfies HealthConfig;
    expect(config.path).toBe('/healthz');
  });

  it('accepts full config', () => {
    const config = { port: 4000, path: '/ready' } satisfies HealthConfig;
    expect(config.port).toBe(4000);
    expect(config.path).toBe('/ready');
  });
});
