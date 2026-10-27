/**
 * Unit tests for MCPConfigSchema.
 *
 * Covers:
 * - Missing required fields (serviceId, setup)
 * - Empty string serviceId
 * - Minimal valid config with all defaults applied
 * - Explicit health overrides preserved
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
      expect(result.data.health.port).toBe(3001);
      expect(result.data.health.path).toBe('/health');
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
});
