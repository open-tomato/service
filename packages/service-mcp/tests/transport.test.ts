/**
 * Unit tests for resolveTransport.
 *
 * Covers:
 * - Returns 'stdio' when MCP_TRANSPORT=stdio
 * - Returns 'http' when MCP_TRANSPORT is absent or any other value
 */
import process from 'node:process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveTransport } from '../src/transport.js';

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
