/**
 * Integration tests for createMCP HTTP server.
 *
 * Covers:
 * - Health endpoint returns ok status with no clients
 * - Health server stops accepting connections after handle.stop()
 */
import type { MCPHandle } from '../src/types.js';

import process from 'node:process';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createMCP } from '../src/create-mcp.js';

// Health port is reused across tests — shutdown() stops the health server,
// freeing the port before the next test starts.
const HEALTH_PORT = 3099;
const HEALTH_PATH = '/health';
const SERVICE_ID = 'integration-test';

// Each test listens on its own port, so a test never depends on the previous
// one's server having released its port.
const MCP_PORT_TEST1 = 8097;
const MCP_PORT_TEST2 = 8096;

async function waitUntil(
  fn: () => Promise<boolean>,
  { timeout = 5000, interval = 50 } = {},
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error(`waitUntil timed out after ${timeout}ms`);
}

describe('createMCP — HTTP server integration', () => {
  let handle: MCPHandle | null = null;

  beforeEach(() => {
    process.env['MCP_TRANSPORT'] = 'http';
  });

  afterEach(async () => {
    if (handle) {
      await handle.stop();
      handle = null;
    }
    process.removeAllListeners('SIGTERM');
    delete process.env['MCP_TRANSPORT'];
    delete process.env['PORT'];
  });

  it('serves /health and returns ok status with no clients', async () => {
    process.env['PORT'] = String(MCP_PORT_TEST1);

    handle = createMCP({
      serviceId: SERVICE_ID,
      setup: async () => {},
      health: { port: HEALTH_PORT, path: HEALTH_PATH },
    });

    await waitUntil(async () => {
      try {
        const res = await fetch(`http://localhost:${HEALTH_PORT}${HEALTH_PATH}`);
        return res.ok;
      } catch {
        return false;
      }
    });

    const res = await fetch(`http://localhost:${HEALTH_PORT}${HEALTH_PATH}`);
    const body = await res.json() as unknown;

    expect(body).toEqual({ status: 'ok', serviceId: SERVICE_ID, clients: {} });
  });

  it('stops accepting connections after handle.stop()', async () => {
    process.env['PORT'] = String(MCP_PORT_TEST2);

    handle = createMCP({
      serviceId: SERVICE_ID,
      setup: async () => {},
      health: { port: HEALTH_PORT, path: HEALTH_PATH },
    });

    await waitUntil(async () => {
      try {
        const res = await fetch(`http://localhost:${HEALTH_PORT}${HEALTH_PATH}`);
        return res.ok;
      } catch {
        return false;
      }
    });

    await handle.stop();
    handle = null;

    await expect(
      fetch(`http://localhost:${HEALTH_PORT}${HEALTH_PATH}`),
    ).rejects.toThrow();
  });
});
