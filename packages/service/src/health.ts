import type { Dependency, DependencyStatus } from './types.js';

/**
 * A service's overall health.
 *
 * - `"ok"` — every dependency is running
 * - `"degraded"` — the service answers, but a dependency is impaired, paused,
 *   or not started yet
 * - `"error"` — a dependency has failed, or is stopped while the service runs
 */
export type HealthStatus = 'ok' | 'degraded' | 'error';

/** The health report: the overall status and each dependency's own. */
export interface HealthReport {
  /** The worst status across the dependencies; `"ok"` when there are none. */
  readonly status: HealthStatus;
  /** Each dependency's status, keyed by its name. */
  readonly dependencies: Readonly<Record<string, DependencyStatus>>;
}

/** Inputs to {@link aggregateHealth} beyond the dependencies themselves. */
export interface AggregateHealthOptions {
  /**
   * Whether the service has finished starting. Before that, a `stopped` or
   * `stopping` dependency is expected and counts as degraded; after it, the
   * dependency should be serving and counts as an error.
   */
  readonly started: boolean;
}

/** The HTTP status a health route answers with, per overall status. */
export const HEALTH_HTTP_STATUS: Readonly<Record<HealthStatus, 200 | 503>> = {
  ok: 200,
  degraded: 200,
  error: 503,
};

const RANK: Readonly<Record<HealthStatus, number>> = { ok: 0, degraded: 1, error: 2 };

/**
 * What one dependency's status makes of the service.
 *
 * A dependency that is stopped or stopping before the service has started
 * counts as degraded, so a service that starts on its first request still
 * answers 200 to the probe that has to let that request through.
 */
function healthOf(status: DependencyStatus, started: boolean): HealthStatus {
  switch (status) {
    case 'running':
      return 'ok';
    case 'starting':
    case 'degraded':
    case 'paused':
      return 'degraded';
    case 'stopped':
    case 'stopping':
      return started
        ? 'error'
        : 'degraded';
    case 'error':
      return 'error';
  }
}

/** The worse of two statuses, by {@link RANK}. */
function worse(a: HealthStatus, b: HealthStatus): HealthStatus {
  return RANK[b] > RANK[a]
    ? b
    : a;
}

/**
 * Folds the dependencies' statuses into one health report: the single rule
 * every adapter's health route answers with.
 *
 * The overall status is the worst any dependency contributes: `error` and,
 * once the service has started, `stopped` or `stopping` give `"error"`;
 * `starting`, `degraded` and `paused` give `"degraded"`; `running` gives
 * `"ok"`. Map it to an HTTP status with {@link HEALTH_HTTP_STATUS}.
 *
 * Names are expected to be unique. When two dependencies share one, the
 * report keeps the worse status, so a failing dependency is never hidden.
 *
 * @param dependencies - The service's dependencies and clients.
 * @param options - Whether the service has started.
 * @returns The overall status and each dependency's status by name.
 *
 * @example
 * ```ts
 * const report = aggregateHealth([db, inventory], { started: true });
 * // { status: 'degraded', dependencies: { db: 'running', inventory: 'degraded' } }
 * const code = HEALTH_HTTP_STATUS[report.status]; // 200
 * ```
 */
export function aggregateHealth(
  dependencies: Iterable<Pick<Dependency, 'name' | 'status'>>,
  options: AggregateHealthOptions,
): HealthReport {
  let status: HealthStatus = 'ok';
  const byName = new Map<string, DependencyStatus>();

  for (const dependency of dependencies) {
    const health = healthOf(dependency.status, options.started);
    status = worse(status, health);

    const seen = byName.get(dependency.name);
    const keepSeen = seen !== undefined && RANK[healthOf(seen, options.started)] >= RANK[health];
    if (!keepSeen) byName.set(dependency.name, dependency.status);
  }

  return { status, dependencies: Object.fromEntries(byName) };
}
