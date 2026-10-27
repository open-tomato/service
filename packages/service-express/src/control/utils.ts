import type { Dependency } from '@open-tomato/service';

/**
 * Maps a dependency status string to its corresponding circuit-breaker state label.
 *
 * @param status - The dependency status: `'running'`, `'degraded'`, or `'error'`.
 * @returns `'closed'` for running, `'half-open'` for degraded, `'open'` for error,
 *   `'unknown'` for any unrecognised value.
 */
export function circuitBreakerState(status: string): string {
  if (status === 'running') return 'closed';
  if (status === 'degraded') return 'half-open';
  if (status === 'error') return 'open';
  return 'unknown';
}

/**
 * Computes an overall service status from the combined set of dependencies and clients.
 *
 * Priority (highest to lowest): `'error'` > `'degraded'` > `'running'`.
 *
 * @param deps - Registered dependency instances.
 * @param clients - Registered HTTP client instances.
 * @returns The worst status observed across all provided instances.
 */
export function aggregateStatus(deps: Dependency[], clients: Dependency[]): string {
  const all = [...deps, ...clients];
  if (all.some(d => d.status === 'error')) return 'error';
  if (all.some(d => d.status === 'degraded')) return 'degraded';
  return 'running';
}

/**
 * Extracts a human-readable error message from an unknown thrown value.
 *
 * @param err - The caught error value.
 * @returns `err.message` when `err` is an `Error` instance, `String(err)` otherwise.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : String(err);
}
