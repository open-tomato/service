/**
 * Browser-safe client utilities for `@open-tomato/service-errors`.
 * No Node.js imports — safe to use in React and other browser contexts.
 */

import type { AppErrorShape } from './types.js';

/**
 * Type guard that checks whether an unknown value conforms to `AppErrorShape`.
 *
 * @param value - The value to test.
 * @returns `true` if `value` has a string `code` and a string `message`.
 *
 * @example
 * ```ts
 * const body = await res.json()
 * if (isAppError(body)) {
 *   console.error(body.code, body.message)
 * }
 * ```
 */
export function isAppError(value: unknown): value is AppErrorShape {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).code === 'string' &&
    typeof (value as Record<string, unknown>).message === 'string'
  );
}

/**
 * Parses a failed `Response` into an `AppErrorShape`.
 *
 * Attempts to read the response body as JSON and validate it with `isAppError`.
 * Falls back to a `NETWORK_ERROR` shape for non-JSON or malformed bodies.
 *
 * **This function must always be awaited.**
 *
 * @param response - A `Response` object from a failed `fetch` call.
 * @returns A Promise resolving to an `AppErrorShape`.
 *
 * @example
 * ```ts
 * const res = await fetch('/api/agents')
 * if (!res.ok) {
 *   const err = await parseApiError(res)
 *   if (err.code === 'UNAUTHORIZED') router.push('/login')
 *   throw err
 * }
 * ```
 */
export async function parseApiError(response: Response): Promise<AppErrorShape> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      const body = (await response.json()) as unknown;
      if (isAppError(body)) return body;
    } catch {
      // fall through to default
    }
  }
  return {
    code: 'NETWORK_ERROR',
    message: response.statusText,
    statusCode: response.status,
  };
}
