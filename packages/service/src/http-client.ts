import type { Dependency, DependencyStatus, HttpClientOpts, TypedClient } from './types.js';

import { CircuitBreaker } from './circuit-breaker.js';
import { withRetry } from './retry.js';

/**
 * Wraps an HTTP client (or any SDK instance) of type `T` in a `Proxy` that
 * transparently applies retry logic and circuit-breaker protection to every
 * method call, and exposes the standard {@link Dependency} lifecycle surface
 * (`status`, `start`, `stop`) so the client can be managed alongside other
 * dependencies uniformly.
 *
 * ### Resilience order
 *
 * For each intercepted method call the execution order is:
 * ```
 * CircuitBreaker.call → withRetry → underlying client method
 * ```
 * Retries are exhausted **before** the circuit breaker records a failure.
 * If the circuit is already open, {@link CircuitOpenError} is thrown
 * immediately without spending any retry budget.
 *
 * ### Safe defaults
 *
 * When `opts` fields are omitted:
 * - `retry`: 3 attempts, exponential backoff, no jitter
 * - `circuitBreaker`: threshold 5 consecutive failures, 30 s open timeout
 *
 * ### DependencyStatus mapping
 *
 * | CircuitState | DependencyStatus |
 * |--------------|-----------------|
 * | closed       | running         |
 * | open         | error           |
 * | half-open    | degraded        |
 *
 * Calling `stop()` overrides the status to `"stopped"` regardless of circuit
 * state. Calling `start()` clears the stopped flag and returns the status
 * to circuit-breaker control.
 *
 * @typeParam T - The type of the underlying HTTP client or SDK instance whose
 *   methods are being proxied. Must be an object type.
 *
 * @param client - The underlying client instance to wrap.
 * @param opts - Optional retry and circuit-breaker configuration.
 * @returns A `Proxy`-wrapped `TypedClient<T>` combining the client's own
 *   method surface with the {@link Dependency} lifecycle interface.
 *
 * @example
 * ```ts
 * const apiClient = createHttpClient(new MyApiSdk(), {
 *   retry: { attempts: 5, backoff: 'exponential', jitter: true },
 *   circuitBreaker: { threshold: 3, timeout: 10_000 },
 * });
 *
 * await apiClient.start();
 * console.log(apiClient.status); // "running"
 *
 * // Retry + circuit-breaker applied automatically:
 * const result = await apiClient.someMethod();
 *
 * await apiClient.stop();
 * console.log(apiClient.status); // "stopped"
 * ```
 */
export function createHttpClient<T extends object>(
  client: T,
  opts?: HttpClientOpts,
): TypedClient<T> {
  const breaker = new CircuitBreaker(opts?.circuitBreaker);
  let stopped = false;

  /**
   * The Dependency lifecycle surface exposed on every `TypedClient<T>`.
   *
   * `status` is a getter that delegates to the circuit breaker unless the
   * client has been explicitly stopped via `stop()`.
   */
  const dependency: Dependency = {
    name: 'http-client',

    get status(): DependencyStatus {
      if (stopped) return 'stopped';
      return breaker.status;
    },

    async start(): Promise<void> {
      stopped = false;
    },

    async stop(): Promise<void> {
      stopped = true;
    },
  };

  return new Proxy(client, {
    /**
     * Intercepts property access on the wrapped client.
     *
     * - Properties that exist on the `Dependency` surface (`name`, `status`,
     *   `start`, `stop`, `healthCheck`, `metadata`) are served from the
     *   internal `dependency` object so the lifecycle contract is always
     *   available regardless of whether the underlying client defines the
     *   same properties.
     * - Non-function properties on the underlying client are forwarded as-is.
     * - Function properties are wrapped so each invocation passes through
     *   `CircuitBreaker.call → withRetry` before reaching the real method.
     */
    get(target, prop, receiver) {
      if (prop in dependency) {
        const val = (dependency as unknown as Record<string | symbol, unknown>)[prop as string];
        return typeof val === 'function'
          ? (val as (...args: unknown[]) => unknown).bind(dependency)
          : val;
      }

      const value = Reflect.get(target, prop, receiver);

      if (typeof value !== 'function') {
        return value;
      }

      return function (...args: unknown[]): Promise<unknown> {
        return breaker.call(() => withRetry(
          () => (value as (...a: unknown[]) => Promise<unknown>).apply(target, args),
          opts?.retry,
        ));
      };
    },
  }) as TypedClient<T>;
}
