/**
 * Configuration for the operator control plane.
 *
 * When `enabled` is `false`, all `/_control` routes respond with 404.
 * When `enabled` is `true`, routes are protected by `secret` via the
 * `x-control-token` request header.
 */
export interface ControlConfig {
  /** Whether the control plane routes are active. */
  enabled: boolean
  /** Shared secret required in the `x-control-token` header. */
  secret: string
}

/**
 * Runtime status of a single dependency as reported by the control plane.
 *
 * `detail` is populated from `dep.healthDetail()` when the dependency
 * implements the `HealthDetailProvider` interface — omitted otherwise.
 */
export type DependencyControlStatus = {
  status: string
  detail?: Record<string, unknown>
};

/**
 * Runtime status of an HTTP client as reported by the control plane.
 *
 * `failureRate` is included when the client tracks a circuit breaker failure
 * rate — omitted otherwise.
 */
export type ClientControlStatus = {
  status: string
  circuitBreaker: string
  failureRate?: number
};

/**
 * Optional extension interface for dependencies that support pause/resume.
 *
 * Use {@link isPausableDependency} to check whether a dependency implements
 * this interface before calling `pause` or `resume`.
 */
export interface PausableDependency {
  /** Temporarily halt the dependency without fully stopping it. */
  pause(): Promise<void>
  /** Resume normal operation after a previous {@link pause} call. */
  resume(): Promise<void>
}

/**
 * Type guard that checks whether `dep` implements {@link PausableDependency}.
 *
 * @param dep - Any value to test.
 * @returns `true` when `dep` has callable `pause` and `resume` methods.
 */
export function isPausableDependency(dep: unknown): dep is PausableDependency {
  return (
    typeof dep === 'object' &&
    dep !== null &&
    typeof (dep as Record<string, unknown>)['pause'] === 'function' &&
    typeof (dep as Record<string, unknown>)['resume'] === 'function'
  );
}

/**
 * Optional extension interface for dependencies that support restart.
 *
 * Use {@link isRestartableDependency} to check whether a dependency implements
 * this interface before calling `stop` or `start`.
 */
export interface RestartableDependency {
  /** Fully stop the dependency in preparation for a restart. */
  stop(): Promise<void>
  /** Start the dependency after a previous {@link stop} call. */
  start(): Promise<void>
}

/**
 * Type guard that checks whether `dep` implements {@link RestartableDependency}.
 *
 * @param dep - Any value to test.
 * @returns `true` when `dep` has callable `stop` and `start` methods.
 */
export function isRestartableDependency(dep: unknown): dep is RestartableDependency {
  return (
    typeof dep === 'object' &&
    dep !== null &&
    typeof (dep as Record<string, unknown>)['stop'] === 'function' &&
    typeof (dep as Record<string, unknown>)['start'] === 'function'
  );
}

/**
 * Optional extension interface for dependencies that can provide structured
 * health detail for operator inspection.
 *
 * Use {@link isHealthDetailProvider} to check whether a dependency implements
 * this interface before calling `healthDetail`.
 */
export interface HealthDetailProvider {
  /** Return a structured snapshot of internal health state (e.g. pool stats). */
  healthDetail(): Record<string, unknown>
}

/**
 * Type guard that checks whether `dep` implements {@link HealthDetailProvider}.
 *
 * @param dep - Any value to test.
 * @returns `true` when `dep` has a callable `healthDetail` method.
 */
export function isHealthDetailProvider(dep: unknown): dep is HealthDetailProvider {
  return (
    typeof dep === 'object' &&
    dep !== null &&
    typeof (dep as Record<string, unknown>)['healthDetail'] === 'function'
  );
}

/**
 * Full status response returned by `GET /_control/status`.
 *
 * Always responds with HTTP 200 regardless of dependency states — the payload
 * itself conveys health for operator and console consumers.
 */
export type ControlStatusResponse = {
  /** Unique identifier for this service instance. */
  serviceId: string
  /** Aggregate service status (e.g. `'running'`, `'degraded'`, `'error'`). */
  status: string
  /** Service uptime in seconds since the HTTP server started accepting requests. */
  uptime: number
  /** Service version read from `package.json` at startup. */
  version: string
  /** Per-dependency runtime status keyed by dependency name. */
  dependencies: Record<string, DependencyControlStatus>
  /** Per-client runtime status keyed by client name. */
  clients: Record<string, ClientControlStatus>
};
