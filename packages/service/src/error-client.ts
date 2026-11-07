import type { ErrorBody } from './errors.js';

import { statusText } from './status-codes.js';

/** An error response as {@link parseApiError} reads it: the body, with its HTTP status. */
export interface ApiError extends ErrorBody {
  /** The response's HTTP status. */
  readonly statusCode: number;
}

/** Whether `value` is an {@link ErrorBody}: an object with a string `code` and a string `message`. */
export function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['code'] === 'string' && typeof candidate['message'] === 'string';
}

/** The body of a 1.x Express service's error response. */
function legacyMessage(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const message = (value as Record<string, unknown>)['error'];
  return typeof message === 'string'
    ? message
    : undefined;
}

/** The response's JSON body, or `undefined` when it is not JSON or does not parse. */
async function readJson(response: Response): Promise<unknown> {
  if (!(response.headers.get('content-type') ?? '').includes('json')) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Reads a failed `Response` into an {@link ApiError}, whatever the server
 * sent:
 *
 * - an {@link ErrorBody} is taken as it is;
 * - a 1.x `{ error }` body gives the message, and the status gives the code;
 * - anything else gives the status's code, with the status text as the
 *   message, or the status's own message when there is no text.
 *
 * @example
 * ```ts
 * const res = await fetch('http://orders:3000/orders/o-1');
 * if (!res.ok) {
 *   const err = await parseApiError(res);
 *   if (err.code === 'NOT_FOUND') console.log('no such order');
 * }
 * ```
 */
export async function parseApiError(response: Response): Promise<ApiError> {
  const statusCode = response.status;
  const fallback = statusText(statusCode);
  const body = await readJson(response);

  if (isErrorBody(body)) {
    return body.details === undefined
      ? { code: body.code, message: body.message, statusCode }
      : { code: body.code, message: body.message, details: body.details, statusCode };
  }
  const message = legacyMessage(body) ?? (response.statusText || fallback.message);
  return { code: fallback.code, message, statusCode };
}
