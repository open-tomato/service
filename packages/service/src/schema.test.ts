import type { DependencyRecord } from './runtime.js';
import type { BaseServiceConfig, ResolvedBaseServiceConfig } from './schema.js';

import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import { createDependency } from './dependency.js';
import { BaseServiceConfigSchema } from './schema.js';

/** The issue messages of a failed parse, by dotted path. */
function issues(input: unknown): Record<string, string> {
  const result = BaseServiceConfigSchema.safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]));
}

describe('BaseServiceConfigSchema', () => {
  it('fills the defaults for a bare serviceId', () => {
    expect(BaseServiceConfigSchema.parse({ serviceId: 'orders' })).toEqual({
      serviceId: 'orders',
      version: 'unknown',
      dependencies: {},
      clients: {},
    });
  });

  it('keeps the records, version, control and stop timeout it is given', () => {
    const db = createDependency({ name: 'db' });
    const input = {
      serviceId: 'orders',
      version: '2.0.0',
      dependencies: { db },
      clients: {},
      control: { enabled: true, secret: 'configured-secret' },
      stopTimeoutMs: 500,
    };

    const parsed = BaseServiceConfigSchema.parse(input);

    expect(parsed).toEqual(input);
    expect(parsed.dependencies['db']).toBe(db);
  });

  it.each(['', '   '])('rejects the blank serviceId %j', (serviceId) => {
    expect(issues({ serviceId })).toHaveProperty('serviceId');
  });

  it('rejects an empty version', () => {
    expect(issues({ serviceId: 'orders', version: '' })).toHaveProperty('version');
  });

  it('rejects a 1.x dependencies array, saying records replaced it', () => {
    expect(issues({ serviceId: 'orders', dependencies: [createDependency({ name: 'db' })] })).toEqual({
      dependencies: 'dependencies must be a record of Dependency objects by key; 1.x arrays are no longer accepted',
    });
  });

  it('rejects a record holding something other than a Dependency', () => {
    expect(issues({ serviceId: 'orders', clients: { inventory: { name: 'inventory' } } })).toEqual({
      clients: 'clients must be a record of Dependency objects by key; 1.x arrays are no longer accepted',
    });
  });

  it('rejects an enabled control plane with an empty secret', () => {
    expect(issues({ serviceId: 'orders', control: { enabled: true, secret: '' } })).toEqual({
      'control.secret': 'control.secret must be a non-empty string when the control plane is enabled',
    });
  });

  it('accepts a disabled control plane with an empty secret', () => {
    expect(issues({ serviceId: 'orders', control: { enabled: false, secret: '' } })).toEqual({});
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects the stop timeout %d', (stopTimeoutMs) => {
    expect(issues({ serviceId: 'orders', stopTimeoutMs })).toHaveProperty('stopTimeoutMs');
  });

  it('extends into an adapter schema', () => {
    const AdapterSchema = BaseServiceConfigSchema.extend({ port: z.number().default(3000) });

    expect(AdapterSchema.parse({ serviceId: 'orders' })).toMatchObject({ serviceId: 'orders', port: 3000, version: 'unknown' });
  });

  it('types the records as DependencyRecord, optional on input and filled on output', () => {
    expectTypeOf<ResolvedBaseServiceConfig['dependencies']>().toEqualTypeOf<DependencyRecord>();
    expectTypeOf<BaseServiceConfig['clients']>().toEqualTypeOf<DependencyRecord | undefined>();
  });
});
