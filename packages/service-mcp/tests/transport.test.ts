/**
 * Unit tests for resolveTransport and wireHttpTransport.
 *
 * Covers:
 * - Returns 'stdio' when MCP_TRANSPORT=stdio
 * - Returns 'http' when MCP_TRANSPORT is absent or any other value
 * - wireHttpTransport picks its port through listenOnPickedPort, falls back
 *   past a taken port with a warning, and rejects under strict
 */
import type { HttpTransportConfig, HttpTransportHandle } from '../src/transport.js';
import type { AddressInfo, Server } from 'node:net';

import { EventEmitter } from 'node:events';
import { createServer as createNetServer } from 'node:net';
import process from 'node:process';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createConsoleLogger, PortInUseError } from '@open-tomato/service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveTransport, wireHttpTransport } from '../src/transport.js';

describe('resolveTransport', () => {
  const original = process.env['MCP_TRANSPORT'];

  beforeEach(() => {
    delete process.env['MCP_TRANSPORT'];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env['MCP_TRANSPORT'];
    } else {
      process.env['MCP_TRANSPORT'] = original;
    }
  });

  it('returns "stdio" when MCP_TRANSPORT is "stdio"', async () => {
    process.env['MCP_TRANSPORT'] = 'stdio';
    vi.resetModules();
    const { resolveTransport: resolve } = await import('../src/transport.js');
    expect(resolve()).toBe('stdio');
  });

  it('returns "http" when MCP_TRANSPORT is absent', () => {
    expect(resolveTransport()).toBe('http');
  });

  it('returns "http" when MCP_TRANSPORT is an unrecognised value', () => {
    process.env['MCP_TRANSPORT'] = 'websocket';
    expect(resolveTransport()).toBe('http');
  });
});

/** Calls of a spied method, read as plain arrays. */
function callsOf(spy: { mock: { calls: unknown } }): unknown[][] {
  return spy.mock.calls as unknown[][];
}

/** Holds a port the system chose with a real server, resolving with the server and its port. */
async function holdPort(): Promise<{ held: Server; port: number }> {
  const held = createNetServer();
  await new Promise<void>((resolve) => held.listen(0, resolve));
  const address = held.address() as AddressInfo;
  return { held, port: address.port };
}

/** Closes `server`, resolving once it has stopped listening. */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('wireHttpTransport', () => {
  let handle: HttpTransportHandle | null = null;
  let held: Server | null = null;
  const logger = createConsoleLogger('svc', { level: 'silent' });

  afterEach(async () => {
    await handle?.close();
    handle = null;
    if (held) await closeServer(held);
    held = null;
    vi.restoreAllMocks();
  });

  function wire(overrides: Partial<HttpTransportConfig> = {}): Promise<HttpTransportHandle> {
    const createSessionServer = (): McpServer => new McpServer({ name: 'svc', version: '1.0.0' });
    return wireHttpTransport({ createSessionServer, port: 0, strict: false, logger, ...overrides });
  }

  it('resolves with the port it is bound to, the system\'s choice for port 0', async () => {
    handle = await wire();
    expect(handle.port).toBeGreaterThan(0);
    expect(handle.requested).toBe(0);
    expect(handle.fellBack).toBe(false);
  });

  it('listens on the asked port when it is free, and logs no warning', async () => {
    const probe = await holdPort();
    await closeServer(probe.held);
    const warn = vi.spyOn(logger, 'warn');
    handle = await wire({ port: probe.port });
    expect(handle.port).toBe(probe.port);
    expect(handle.fellBack).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back past a taken port, serves on the next one, and logs the fallback warning', async () => {
    const taken = await holdPort();
    held = taken.held;
    const warn = vi.spyOn(logger, 'warn');
    handle = await wire({ port: taken.port });

    expect(handle.port).toBeGreaterThan(taken.port);
    expect(handle.requested).toBe(taken.port);
    expect(handle.fellBack).toBe(true);
    // An MCP request without the initialize handshake still reaches the transport, which answers it.
    const res = await fetch(`http://localhost:${handle.port}/mcp`, { method: 'GET' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    const calls = callsOf(warn);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toEqual({
      takenPort: taken.port,
      port: handle.port,
      strictKey: 'strictPort',
      strictEnv: 'PORT_STRICT',
    });
    expect(calls[0]?.[1]).toBe(
      `port ${taken.port} is taken, falling back to ${handle.port}; set strictPort or PORT_STRICT=true to fail instead`,
    );
  });

  it('rejects with PortInUseError naming port when the port is taken under strict', async () => {
    const taken = await holdPort();
    held = taken.held;
    const warn = vi.spyOn(logger, 'warn');
    const wired = wire({ port: taken.port, strict: true });
    await expect(wired).rejects.toBeInstanceOf(PortInUseError);
    await expect(wired).rejects.toMatchObject({ port: taken.port, configKey: 'port' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('names the config key it is given in the PortInUseError', async () => {
    const taken = await holdPort();
    held = taken.held;
    await expect(wire({ port: taken.port, strict: true, configKey: 'PORT' }))
      .rejects.toMatchObject({ configKey: 'PORT' });
  });

  it('logs an error the server raises once listening instead of leaving it unhandled', async () => {
    const error = vi.spyOn(logger, 'error');
    const on = vi.spyOn(EventEmitter.prototype, 'on');
    handle = await wire();
    const errorListeners = callsOf(on).filter(call => call[0] === 'error');
    on.mockRestore();
    const listener = errorListeners.at(-1)?.[1] as ((err: Error) => void) | undefined;
    expect(listener).toBeTypeOf('function');
    const boom = new Error('boom');
    listener?.(boom);
    expect(callsOf(error)).toEqual([[{ err: boom }, 'MCP HTTP server error']]);
  });
});
