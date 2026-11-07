/**
 * Unit tests for MCPConfigSchema.
 *
 * Covers:
 * - Missing required fields (serviceId, setup)
 * - Empty string serviceId
 * - Minimal valid config with all defaults applied
 * - Explicit health overrides preserved
 * - Port and strict fields left unset for `resolvePortConfig`, and kept when given
 * - `version` and `features` defaults and overrides
 */
import { describe, expect, it } from 'vitest';

import { MCPConfigSchema } from '../src/schema.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const noopSetup = (_server: unknown, _ctx: unknown) => {};

const minimalConfig = {
  serviceId: 'test-mcp',
  setup: noopSetup,
};

// ---------------------------------------------------------------------------
// Negative tests
// ---------------------------------------------------------------------------

describe('MCPConfigSchema — negative', () => {
  it.each([
    ['port', { port: 80.5 }],
    ['port', { port: '8080' }],
    ['strictPort', { strictPort: 'true' }],
    ['health.port', { health: { port: 30.5 } }],
    ['health.strictPort', { health: { strictPort: 1 } }],
    ['version', { version: '' }],
    ['features', { features: { flag: null } }],
  ])('rejects a malformed %s', (_field, override) => {
    const result = MCPConfigSchema.safeParse({ ...minimalConfig, ...override });
    expect(result.success).toBe(false);
  });

  it('rejects when serviceId is missing', () => {
    const result = MCPConfigSchema.safeParse({ setup: noopSetup });
    expect(result.success).toBe(false);
  });

  it('rejects when serviceId is an empty string', () => {
    const result = MCPConfigSchema.safeParse({ serviceId: '', setup: noopSetup });
    expect(result.success).toBe(false);
  });

  it('rejects when setup is missing', () => {
    const result = MCPConfigSchema.safeParse({ serviceId: 'test-mcp' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Positive tests
// ---------------------------------------------------------------------------

describe('MCPConfigSchema — positive', () => {
  it('parses minimal config and applies all defaults', () => {
    const result = MCPConfigSchema.safeParse(minimalConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clients).toEqual([]);
      expect(result.data.health.port).toBeUndefined();
      expect(result.data.health.strictPort).toBeUndefined();
      expect(result.data.health.path).toBe('/health');
      expect(result.data.port).toBeUndefined();
      expect(result.data.strictPort).toBeUndefined();
      expect(result.data.version).toBe('unknown');
      expect(result.data.features).toEqual({});
      expect(result.data.logger).toBeUndefined();
    }
  });

  it('preserves explicit health.port and health.path overrides', () => {
    const result = MCPConfigSchema.safeParse({
      ...minimalConfig,
      health: { port: 9000, path: '/ping' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.health.port).toBe(9000);
      expect(result.data.health.path).toBe('/ping');
    }
  });

  it('keeps explicit port, strictPort and health.strictPort, port 0 included', () => {
    const result = MCPConfigSchema.safeParse({
      ...minimalConfig,
      port: 0,
      strictPort: true,
      health: { port: 9001, strictPort: false },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.port).toBe(0);
      expect(result.data.strictPort).toBe(true);
      expect(result.data.health).toEqual({ port: 9001, strictPort: false, path: '/health' });
    }
  });

  it('keeps an explicit version and features', () => {
    const features = { tools: 3, beta: true, region: 'eu' };
    const result = MCPConfigSchema.safeParse({ ...minimalConfig, version: '2.1.0', features });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe('2.1.0');
      expect(result.data.features).toEqual(features);
    }
  });

  it('gives each parse its own features record', () => {
    const first = MCPConfigSchema.parse(minimalConfig);
    const second = MCPConfigSchema.parse(minimalConfig);
    expect(first.features).not.toBe(second.features);
  });
});
