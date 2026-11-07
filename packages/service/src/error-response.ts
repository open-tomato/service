import type { ErrorBody, FieldError } from './errors.js';

import { ZodError } from 'zod';

import { CircuitOpenError } from './circuit-breaker.js';
import { AppError, ValidationError } from './errors.js';
import { GENERIC_SERVER_MESSAGE, isErrorStatus, SERVER_ERROR_STATUS, statusText } from './status-codes.js';

/** An error turned into what a transport answers with: an HTTP status and a body. */
export interface ErrorResponse {
  /** The HTTP status to answer with. */
  readonly status: number;
  /** The response body. */
  readonly body: ErrorBody;
}

/**
 * Turns anything thrown into an {@link ErrorResponse}. {@link toErrorResponse}
 * is the default; an adapter takes another to change what callers see.
 */
export type ErrorFormatter = (error: unknown) => ErrorResponse;

const GENERIC_500: ErrorResponse = { status: 500, body: { code: 'INTERNAL_ERROR', message: GENERIC_SERVER_MESSAGE } };
const UNAVAILABLE: ErrorResponse = { status: 503, body: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable' } };

/**
 * Converts a `ZodError` into a {@link ValidationError}, one field error per
 * issue, its path joined with dots.
 */
export function zodToValidationError(err: ZodError): ValidationError {
  const fields: FieldError[] = err.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));
  return new ValidationError('Validation failed', fields, { cause: err });
}

/** The fields an error from a library such as body-parser or http-errors may carry. */
interface StatusCarrier {
  readonly status?: unknown;
  readonly statusCode?: unknown;
  readonly message?: unknown;
  readonly code?: unknown;
  readonly details?: unknown;
}

/** The response for an error that carries its own HTTP status. */
function fromStatus(error: StatusCarrier, status: number): ErrorResponse {
  const fallback = statusText(status);
  if (status >= SERVER_ERROR_STATUS) {
    return { status, body: { code: fallback.code, message: fallback.message } };
  }
  const code = typeof error.code === 'string' && error.code !== ''
    ? error.code
    : fallback.code;
  const message = typeof error.message === 'string' && error.message !== ''
    ? error.message
    : fallback.message;
  return error.details === undefined
    ? { status, body: { code, message } }
    : { status, body: { code, message, details: error.details } };
}

/** {@link toErrorResponse} without its guard against an error that throws when read. */
function respond(error: unknown): ErrorResponse {
  if (error instanceof AppError) return { status: error.statusCode, body: error.toJSON() };
  if (error instanceof ZodError) return respond(zodToValidationError(error));
  if (error instanceof CircuitOpenError) return UNAVAILABLE;
  if (typeof error !== 'object' || error === null) return GENERIC_500;

  const carrier = error as StatusCarrier;
  const status = isErrorStatus(carrier.status)
    ? carrier.status
    : carrier.statusCode;
  return isErrorStatus(status)
    ? fromStatus(carrier, status)
    : GENERIC_500;
}

/**
 * The default {@link ErrorFormatter}: turns anything thrown into a status
 * and an {@link ErrorBody}, using what the error carries and falling back
 * where it carries nothing.
 *
 * - An {@link AppError} answers with its own status and `toJSON()`.
 * - A `ZodError` answers 422 `VALIDATION_ERROR`, one field error per issue.
 * - A `CircuitOpenError` answers 503 `SERVICE_UNAVAILABLE`.
 * - An error with a 4xx `status` or `statusCode` answers with it, its own
 *   string `code`, `message` and `details` when it has them, and the
 *   status's code and message when it does not.
 * - An error with a 5xx status answers with that status's generic code and
 *   message, and anything else answers 500 `INTERNAL_ERROR`. Neither sends
 *   the error's own message, code or details, which can carry internal
 *   context; log the error for those.
 *
 * It never throws: an error whose fields throw when read answers the
 * generic 500.
 */
export function toErrorResponse(error: unknown): ErrorResponse {
  try {
    return respond(error);
  } catch {
    return GENERIC_500;
  }
}
