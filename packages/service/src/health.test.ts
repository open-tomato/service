import type { HealthStatus } from './health.js';
import type { DependencyStatus } from './types.js';

import { describe, expect, it } from 'vitest';

import { aggregateHealth, HEALTH_HTTP_STATUS } from './health.js';

/** What one dependency in each status makes of the service, before and after start. */
const EXPECTED = {
  running: { beforeStart: 'ok', afterStart: 'ok' },
  starting: { beforeStart: 'degraded', afterStart: 'degraded' },
  degraded: { beforeStart: 'degraded', afterStart: 'degraded' },
  paused: { beforeStart: 'degraded', afterStart: 'degraded' },
  stopped: { beforeStart: 'degraded', afterStart: 'error' },
  stopping: { beforeStart: 'degraded', afterStart: 'error' },
  error: { beforeStart: 'error', afterStart: 'error' },
} as const satisfies Record<DependencyStatus, Record<'beforeStart' | 'afterStart', HealthStatus>>;

const ROWS = (Object.keys(EXPECTED) as DependencyStatus[]).flatMap((status) => [
  { status, started: false, expected: EXPECTED[status].beforeStart },
  { status, started: true, expected: EXPECTED[status].afterStart },
]);

describe('aggregateHealth', () => {
  it.each(ROWS)('one dependency $status, started $started -> $expected', ({ status, started, expected }) => {
    const report = aggregateHealth([{ name: 'db', status }], { started });

    expect(report).toEqual({ status: expected, dependencies: { db: status } });
  });

  it('reports ok for a service with no dependencies', () => {
    expect(aggregateHealth([], { started: true })).toEqual({ status: 'ok', dependencies: {} });
  });

  it('takes the worst status across dependencies', () => {
    const report = aggregateHealth([
      { name: 'db', status: 'running' },
      { name: 'cache', status: 'degraded' },
      { name: 'inventory', status: 'error' },
    ], { started: true });

    expect(report.status).toBe('error');
    expect(report.dependencies).toEqual({ db: 'running', cache: 'degraded', inventory: 'error' });
  });

  it('keeps the worse status when two dependencies share a name', () => {
    const report = aggregateHealth([
      { name: 'inventory', status: 'error' },
      { name: 'inventory', status: 'running' },
    ], { started: true });

    expect(report).toEqual({ status: 'error', dependencies: { inventory: 'error' } });
  });

  it('accepts any iterable of dependencies', () => {
    const deps = new Set([{ name: 'db', status: 'running' as const }]);

    expect(aggregateHealth(deps, { started: true }).status).toBe('ok');
  });
});

describe('HEALTH_HTTP_STATUS', () => {
  it('answers 503 for error only', () => {
    expect(HEALTH_HTTP_STATUS).toEqual({ ok: 200, degraded: 200, error: 503 });
  });
});
