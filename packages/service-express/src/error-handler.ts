import type { ErrorFormatter, ErrorResponse, Logger } from '@open-tomato/service';
import type { ErrorRequestHandler } from 'express';

import { toErrorResponse } from '@open-tomato/service';

/** The first status of the server-error range. */
const SERVER_ERROR_STATUS = 500;

/** The fields of a thrown value worth a log line, and its message. */
function describeFailure(err: unknown): { readonly fields: Record<string, unknown>; readonly message: string } {
  if (typeof err !== 'object' || err === null) return { fields: {}, message: String(err) };
  const { name, code, reason, stack, message } = err as Record<string, unknown>;
  return {
    // `errorName`, not `name`: on the same stream pino's `name` is the service id.
    fields: { errorName: name, code, reason, stack },
    message: typeof message === 'string'
      ? message
      : 'Unknown error',
  };
}

/**
 * Writes one line for the failure. A server error logs what its response
 * hides: the error's own name, code, reason, stack and message. A client
 * error logs the status, code and message it answered with.
 */
function logFailure(logger: Logger, err: unknown, response: ErrorResponse): void {
  try {
    if (response.status >= SERVER_ERROR_STATUS) {
      const { fields, message } = describeFailure(err);
      logger.error({ status: response.status, ...fields }, message);
    } else {
      logger.warn({ status: response.status, code: response.body.code }, response.body.message);
    }
  } catch {
    // The response is the guarantee that must hold, not the log line.
  }
}

/** The formatter's response, or the default rule's when the formatter throws. */
function formatSafely(format: ErrorFormatter, err: unknown): ErrorResponse {
  try {
    return format(err);
  } catch {
    return toErrorResponse(err);
  }
}

/**
 * The error handler `createService` mounts after every route. It answers
 * with `format(err)`: by default the core's `toErrorResponse`, which sends
 * `{ code, message, details? }` and keeps a server error's own text out of
 * the body. A formatter that throws falls back to that default.
 *
 * Each error gets one log line through `logger`, and a logger that throws
 * never costs the caller the response. Once the response has started, the
 * error goes to Express's own handler, which closes the connection.
 *
 * @param logger - The service logger.
 * @param format - Turns the thrown value into `{ status, body }`.
 */
export function createErrorHandler(logger: Logger, format: ErrorFormatter = toErrorResponse): ErrorRequestHandler {
  return (err, _req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const response = formatSafely(format, err);
    logFailure(logger, err, response);
    res.status(response.status).json(response.body);
  };
}
