/**
 * AppError base class and all application-level error subclasses for `@open-tomato/service-errors`.
 * Safe to import in both Node.js and browser contexts.
 */

import type { FieldError } from './types.js';

import process from 'node:process';

/**
 * Base class for all application errors.
 * Extends the native `Error` with HTTP status code, machine-readable code,
 * and optional structured details.
 *
 * @example
 * ```ts
 * throw new AppError({ message: 'Something went wrong', statusCode: 500, code: 'INTERNAL_ERROR' })
 * ```
 */
export class AppError extends Error {
  /** HTTP status code to send in the response. */
  readonly statusCode: number;
  /** Machine-readable error code (e.g. `"NOT_FOUND"`). */
  readonly code: string;
  /** Optional structured details about the error. */
  readonly details?: unknown;

  /**
   * @param opts.message - Human-readable error message.
   * @param opts.statusCode - HTTP status code to send in the response.
   * @param opts.code - Machine-readable error code (e.g. `"NOT_FOUND"`).
   * @param opts.details - Optional structured details about the error.
   * @param opts.cause - The original error that caused this one, forwarded to `Error.cause`.
   */
  constructor(opts: {
    message: string
    statusCode: number
    code: string
    details?: unknown
    cause?: unknown
  }) {
    super(opts.message, { cause: opts.cause });
    this.name = this.constructor.name;
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.details = opts.details;
  }

  /**
   * Returns a plain object safe to serialise as a JSON response body.
   * The `details` property is included only when it is not `undefined`.
   */
  toJSON(): { code: string; message: string; details?: unknown } {
    return {
      code: this.code,
      message: this.message,
      ...(this.details !== undefined
        ? { details: this.details }
        : {}),
    };
  }
}

/**
 * Thrown when a requested resource cannot be found.
 * Responds with HTTP 404.
 */
export class NotFoundError extends AppError {
  /**
   * @param message - Human-readable error message. Defaults to `"Not found"`.
   * @param details - Optional structured details about the missing resource.
   * @param opts.cause - The original error that caused this one.
   */
  constructor(message = 'Not found', details?: unknown, opts?: { cause?: unknown }) {
    super({ message, statusCode: 404, code: 'NOT_FOUND', details, cause: opts?.cause });
  }
}

/**
 * Thrown when the request lacks valid authentication credentials.
 * Responds with HTTP 401.
 */
export class UnauthorizedError extends AppError {
  /**
   * @param message - Human-readable error message. Defaults to `"Unauthorized"`.
   * @param details - Optional structured details.
   * @param opts.cause - The original error that caused this one.
   */
  constructor(message = 'Unauthorized', details?: unknown, opts?: { cause?: unknown }) {
    super({ message, statusCode: 401, code: 'UNAUTHORIZED', details, cause: opts?.cause });
  }
}

/**
 * Thrown when the authenticated user does not have permission to perform the action.
 * Responds with HTTP 403.
 */
export class ForbiddenError extends AppError {
  /**
   * @param message - Human-readable error message. Defaults to `"Forbidden"`.
   * @param details - Optional structured details.
   * @param opts.cause - The original error that caused this one.
   */
  constructor(message = 'Forbidden', details?: unknown, opts?: { cause?: unknown }) {
    super({ message, statusCode: 403, code: 'FORBIDDEN', details, cause: opts?.cause });
  }
}

/**
 * Thrown when input data fails validation.
 * Responds with HTTP 422. The `details` property is typed as `FieldError[]`
 * for structured field-level error reporting.
 */
export class ValidationError extends AppError {
  declare readonly details: FieldError[] | undefined;

  /**
   * @param message - Human-readable error message. Defaults to `"Validation failed"`.
   * @param details - Array of field-level errors describing what failed.
   * @param opts.cause - The original error that caused this one.
   */
  constructor(message = 'Validation failed', details?: FieldError[], opts?: { cause?: unknown }) {
    super({ message, statusCode: 422, code: 'VALIDATION_ERROR', details, cause: opts?.cause });
  }
}

/**
 * Thrown when a create or update operation conflicts with existing state (e.g. duplicate key).
 * Responds with HTTP 409.
 */
export class ConflictError extends AppError {
  /**
   * @param message - Human-readable error message. Defaults to `"Conflict"`.
   * @param details - Optional structured details about the conflicting state.
   * @param opts.cause - The original error that caused this one.
   */
  constructor(message = 'Conflict', details?: unknown, opts?: { cause?: unknown }) {
    super({ message, statusCode: 409, code: 'CONFLICT', details, cause: opts?.cause });
  }
}

/**
 * Thrown when the request is malformed or contains invalid parameters.
 * Responds with HTTP 400.
 */
export class BadRequestError extends AppError {
  /**
   * @param message - Human-readable error message. Defaults to `"Bad request"`.
   * @param details - Optional structured details.
   * @param opts.cause - The original error that caused this one.
   */
  constructor(message = 'Bad request', details?: unknown, opts?: { cause?: unknown }) {
    super({ message, statusCode: 400, code: 'BAD_REQUEST', details, cause: opts?.cause });
  }
}

/**
 * Thrown when an unexpected server-side error occurs.
 * Responds with HTTP 500.
 *
 * In production (`NODE_ENV === 'production'`), the `details` property is stripped
 * to avoid leaking internal implementation details to clients.
 */
export class InternalError extends AppError {
  /**
   * @param message - Human-readable error message. Defaults to `"Internal error"`.
   * @param details - Optional structured details. Stripped in production to avoid leaking internals.
   * @param opts.cause - The original error that caused this one.
   */
  constructor(message = 'Internal error', details?: unknown, opts?: { cause?: unknown }) {
    const safeDetails = process.env['NODE_ENV'] === 'production'
      ? undefined
      : details;
    super({ message, statusCode: 500, code: 'INTERNAL_ERROR', details: safeDetails, cause: opts?.cause });
  }
}
