import type { RetryConfig } from './types.js';

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 100;

function computeDelay(attempt: number, backoff: 'exponential' | 'linear', jitter: boolean): number {
  const base =
    backoff === 'exponential'
      ? DEFAULT_BASE_DELAY_MS * Math.pow(2, attempt - 1)
      : DEFAULT_BASE_DELAY_MS;

  return jitter
    ? base * Math.random()
    : base;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes `fn` with retry logic according to `config`.
 *
 * On each failure, waits for a computed delay before retrying.
 * After all attempts are exhausted, the last error is re-thrown.
 *
 * @typeParam T - The resolved value type of the wrapped async function.
 *
 * @param fn - The async operation to execute and potentially retry.
 * @param config - Optional retry configuration. Safe defaults are applied when
 *   omitted: 3 attempts, exponential backoff, no jitter.
 *
 * @returns A promise that resolves with the first successful result of `fn`.
 * @throws The last error thrown by `fn` if all attempts are exhausted.
 *
 * @example
 * ```ts
 * const result = await withRetry(() => fetch('https://api.example.com/data'), {
 *   attempts: 5,
 *   backoff: 'exponential',
 *   jitter: true,
 * });
 * ```
 */
export async function withRetry<T>(fn: () => Promise<T>, config?: RetryConfig): Promise<T> {
  const attempts = config?.attempts ?? DEFAULT_ATTEMPTS;
  const backoff = config?.backoff ?? 'exponential';
  const jitter = config?.jitter ?? false;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await sleep(computeDelay(attempt, backoff, jitter));
      }
    }
  }

  throw lastError;
}
