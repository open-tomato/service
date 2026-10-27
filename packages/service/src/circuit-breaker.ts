import type { CircuitBreakerConfig, DependencyStatus } from './types.js';

const DEFAULT_THRESHOLD = 5;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The three states of a circuit breaker.
 *
 * - `"closed"` — requests flow normally; maps to `DependencyStatus` `"running"`
 * - `"open"` — requests are immediately rejected; maps to `DependencyStatus` `"error"`
 * - `"half-open"` — a single probe request is allowed through to test recovery;
 *   maps to `DependencyStatus` `"degraded"`
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Thrown when a call is attempted while the circuit breaker is in the `"open"` state.
 *
 * @example
 * ```ts
 * try {
 *   await breaker.call(() => fetchData());
 * } catch (err) {
 *   if (err instanceof CircuitOpenError) {
 *     console.warn('Circuit is open — request rejected without upstream call');
 *   }
 * }
 * ```
 */
export class CircuitOpenError extends Error {
  constructor() {
    super('Circuit is open — call rejected');
    this.name = 'CircuitOpenError';
  }
}

/**
 * A configurable circuit breaker that tracks consecutive failures and
 * transitions between `closed`, `open`, and `half-open` states.
 *
 * Safe defaults are applied when `config` is omitted or fields are absent:
 * - `threshold`: 5 consecutive failures before opening the circuit
 * - `timeout`: 30 000 ms before the circuit transitions from open to half-open
 *
 * ### State transitions
 *
 * ```
 * closed  --[threshold failures]--> open
 * open    --[timeout elapsed]------> half-open
 * half-open --[probe success]------> closed
 * half-open --[probe failure]------> open
 * ```
 *
 * ### DependencyStatus mapping
 *
 * | CircuitState | DependencyStatus |
 * |--------------|-----------------|
 * | closed       | running         |
 * | open         | error           |
 * | half-open    | degraded        |
 *
 * @example
 * ```ts
 * const breaker = new CircuitBreaker({ threshold: 3, timeout: 10_000 });
 *
 * try {
 *   const result = await breaker.call(() => myApiSdk.fetchData());
 * } catch (err) {
 *   if (err instanceof CircuitOpenError) {
 *     console.warn('Upstream unavailable — circuit is open');
 *   }
 * }
 * ```
 */
export class CircuitBreaker {
  private _state: CircuitState = 'closed';
  private _failures = 0;
  private _openedAt: number | null = null;

  private readonly threshold: number;
  private readonly timeout: number;

  /**
   * @param config - Optional circuit-breaker configuration. Safe defaults are
   *   applied for any omitted fields.
   */
  constructor(config?: CircuitBreakerConfig) {
    this.threshold = config?.threshold ?? DEFAULT_THRESHOLD;
    this.timeout = config?.timeout ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * The current circuit state (`"closed"`, `"open"`, or `"half-open"`).
   */
  get state(): CircuitState {
    this._checkTimeout();
    return this._state;
  }

  /**
   * The current lifecycle status mapped from the circuit state.
   *
   * | CircuitState | DependencyStatus |
   * |--------------|-----------------|
   * | closed       | running         |
   * | open         | error           |
   * | half-open    | degraded        |
   */
  get status(): DependencyStatus {
    const state = this.state;
    if (state === 'closed') return 'running';
    if (state === 'open') return 'error';
    return 'degraded';
  }

  /**
   * Executes `fn` through the circuit breaker.
   *
   * - If the circuit is `open`, throws {@link CircuitOpenError} immediately
   *   without calling `fn`.
   * - If the circuit is `half-open` or `closed`, calls `fn` and records the
   *   outcome to drive state transitions.
   *
   * @typeParam T - The resolved value type of the wrapped async function.
   * @param fn - The async operation to protect.
   * @returns The resolved value of `fn` on success.
   * @throws {@link CircuitOpenError} when the circuit is open.
   * @throws The error from `fn` on failure (after updating circuit state).
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    this._checkTimeout();

    if (this._state === 'open') {
      throw new CircuitOpenError();
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();
      throw err;
    }
  }

  private _checkTimeout(): void {
    if (this._state === 'open' && this._openedAt !== null) {
      if (Date.now() - this._openedAt >= this.timeout) {
        this._state = 'half-open';
        this._openedAt = null;
      }
    }
  }

  private _onSuccess(): void {
    this._failures = 0;
    this._state = 'closed';
    this._openedAt = null;
  }

  private _onFailure(): void {
    this._failures++;
    if (this._state === 'half-open' || this._failures >= this.threshold) {
      this._state = 'open';
      this._openedAt = Date.now();
      this._failures = 0;
    }
  }
}
