import { readEnv } from './env.js';

/**
 * One field that failed validation. `field` is the path to it in dot
 * notation, such as `"user.email"`.
 */
export interface FieldError {
  /** The path to the field, such as `"user.email"`. */
  readonly field: string;
  /** What is wrong with it. */
  readonly message: string;
  /** A machine-readable code for the failure, such as a zod issue code. */
  readonly code?: string;
}

/**
 * The body of an error response, the same under every adapter:
 * a machine-readable `code`, a `message`, and `details` when the error has
 * some.
 */
export interface ErrorBody {
  /** A machine-readable code, such as `"NOT_FOUND"`. */
  readonly code: string;
  /** What went wrong, safe to show the caller. */
  readonly message: string;
  /** Structured context, such as the fields that failed validation. */
  readonly details?: unknown;
}

/** The options every error class takes after its message and details. */
interface ErrorOptions {
  /** The error that caused this one, kept as `Error.cause`. */
  readonly cause?: unknown;
}

/**
 * An error a service throws on purpose, carrying the HTTP status, the code
 * and the details its response should have. The error handler answers with
 * `statusCode` and {@link AppError.toJSON}.
 *
 * @example
 * ```ts
 * throw new AppError({ message: 'quota used up', statusCode: 429, code: 'QUOTA_EXCEEDED' });
 * ```
 */
export class AppError extends Error {
  /** The HTTP status to answer with. */
  readonly statusCode: number;
  /** A machine-readable code, such as `"NOT_FOUND"`. */
  readonly code: string;
  /** Structured context for the caller; absent when there is none. */
  readonly details?: unknown;

  /**
   * @param opts.message - What went wrong, safe to show the caller.
   * @param opts.statusCode - The HTTP status to answer with.
   * @param opts.code - A machine-readable code.
   * @param opts.details - Structured context for the caller.
   * @param opts.cause - The error that caused this one.
   */
  constructor(opts: {
    message: string;
    statusCode: number;
    code: string;
    details?: unknown;
    cause?: unknown;
  }) {
    super(opts.message, { cause: opts.cause });
    this.name = new.target.name;
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.details = opts.details;
  }

  /** The response body: `code` and `message`, and `details` when there are some. */
  toJSON(): ErrorBody {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

/** A resource that does not exist. Answers 404 `NOT_FOUND`. */
export class NotFoundError extends AppError {
  constructor(message = 'Not found', details?: unknown, opts?: ErrorOptions) {
    super({ message, statusCode: 404, code: 'NOT_FOUND', details, cause: opts?.cause });
  }
}

/** A request without valid credentials. Answers 401 `UNAUTHORIZED`. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', details?: unknown, opts?: ErrorOptions) {
    super({ message, statusCode: 401, code: 'UNAUTHORIZED', details, cause: opts?.cause });
  }
}

/** A caller without permission for the action. Answers 403 `FORBIDDEN`. */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', details?: unknown, opts?: ErrorOptions) {
    super({ message, statusCode: 403, code: 'FORBIDDEN', details, cause: opts?.cause });
  }
}

/** Input that failed validation, field by field. Answers 422 `VALIDATION_ERROR`. */
export class ValidationError extends AppError {
  declare readonly details: readonly FieldError[] | undefined;

  constructor(message = 'Validation failed', details?: readonly FieldError[], opts?: ErrorOptions) {
    super({ message, statusCode: 422, code: 'VALIDATION_ERROR', details, cause: opts?.cause });
  }
}

/** A change that conflicts with existing state, such as a duplicate key. Answers 409 `CONFLICT`. */
export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown, opts?: ErrorOptions) {
    super({ message, statusCode: 409, code: 'CONFLICT', details, cause: opts?.cause });
  }
}

/** A malformed request. Answers 400 `BAD_REQUEST`. */
export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: unknown, opts?: ErrorOptions) {
    super({ message, statusCode: 400, code: 'BAD_REQUEST', details, cause: opts?.cause });
  }
}

/**
 * A failure inside the service. Answers 500 `INTERNAL_ERROR`. When
 * `NODE_ENV` is `production` as the error is made, its details are dropped,
 * so internal context never reaches a caller.
 */
export class InternalError extends AppError {
  constructor(message = 'Internal error', details?: unknown, opts?: ErrorOptions) {
    const safeDetails = readEnv('NODE_ENV') === 'production'
      ? undefined
      : details;
    super({ message, statusCode: 500, code: 'INTERNAL_ERROR', details: safeDetails, cause: opts?.cause });
  }
}
