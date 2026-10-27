/**
 * Express error-handling middleware and Zod-to-ValidationError conversion utility
 * for `@open-tomato/service-errors`. Node.js only — do not import in browser contexts.
 */

import type { FieldError } from './types.js';
import type { ErrorRequestHandler } from 'express';

import { ZodError } from 'zod';

import { AppError, ValidationError } from './errors.js';

/**
 * Minimal logger interface accepted by `errorHandler`.
 * Compatible with `@open-tomato/service-logger` and any pino-shaped logger,
 * without requiring a direct dependency on either.
 */
export interface Logger {
  warn(obj: object, msg: string): void
  error(obj: object, msg: string): void
}

/**
 * Converts a `ZodError` into a `ValidationError` with structured `FieldError[]` details.
 * Each Zod issue's `path` is joined with `.` to produce dot-notation field names
 * (e.g. `"user.email"`). Top-level fields produce a name without a dot.
 *
 * @param err - The `ZodError` to convert.
 * @returns A `ValidationError` ready to be thrown or returned.
 */
export function zodToValidationError(err: ZodError): ValidationError {
  const fields: FieldError[] = err.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));
  return new ValidationError('Validation failed', fields);
}

/**
 * Factory that returns an Express 4-argument error-handling middleware.
 *
 * Behaviour:
 * - `ZodError` → delegates to `zodToValidationError`, responds 422 with `VALIDATION_ERROR`.
 * - `AppError` subclass → logs with `warn`, responds with the error's own `statusCode` and `toJSON()` body.
 * - Unknown `Error` or thrown value → logs with `error` (including `errorName`/`code`/`reason` when present), responds 500 with `{ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }`.
 *
 * The response is unconditional for EVERY branch above — even if reading a
 * logged field or the logging call itself throws, that failure is caught so
 * the branch's response still goes out with the same body it would have sent
 * had logging succeeded.
 *
 * **Note:** This handler is registered automatically by `createService` in
 * `@open-tomato/service`. Do **not** add it manually inside a service's
 * `register()` function, or it will be mounted twice.
 *
 * @param logger - A logger instance with `warn` and `error` methods.
 * @returns An Express `ErrorRequestHandler` to be passed to `app.use()`.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err, _req, res, _next) => {
    if (err instanceof ZodError) {
      const validationError = zodToValidationError(err);
      // The logging call is guarded, same as the AppError and unknown-error
      // branches below: a throwing logger must not cost the caller their
      // typed 422 body.
      try {
        logger.warn({ code: validationError.code }, validationError.message);
      } catch {
        // Swallow — the response below is the guarantee that must hold, not
        // the log line.
      }
      res.status(422).json(validationError.toJSON());
      return;
    }
    if (err instanceof AppError) {
      // Same guarantee as the ZodError branch: a throwing logger must not cost
      // the caller their typed body and status.
      try {
        logger.warn({ code: err.code, cause: err.cause }, err.message);
      } catch {
        // Swallow — the response below is the guarantee that must hold, not
        // the log line.
      }
      res.status(err.statusCode).json(err.toJSON());
      return;
    }
    // `errorName`, `code`, and `reason` are logged alongside the stack so a typed
    // non-AppError is alertable on a FIELD rather than by regex-matching a log
    // message. All three are optional and absent on a plain `Error` or a thrown
    // non-error, which is why they are read defensively rather than asserted.
    //
    // Logged as `errorName`, not `name`: the pino-http instance in
    // `packages/service/express/src/middleware.ts` is built as
    // `pino({ name: serviceId })`, and both loggers write to the same stdout
    // stream, so a bare `name` field on this line would read as "error class"
    // right next to lines where it means "service id".
    //
    // This whole read-and-log step is wrapped in try/catch, not because any
    // reachable error object needs it today, but because this handler is the
    // last line of defence: if `name`/`code`/`reason`/`stack`/`message` were ever
    // accessor properties that throw, the response below must still go out
    // rather than the handler itself throwing and leaving the request unanswered.
    try {
      const unknown = err as {
        message?: string;
        stack?: string;
        name?: string;
        code?: unknown;
        reason?: unknown;
      };
      logger.error(
        {
          errorName: unknown.name,
          code: unknown.code,
          reason: unknown.reason,
          stack: unknown.stack,
        },
        unknown.message ?? 'Unknown error',
      );
    } catch {
      // Reading a field (or the logging call itself) threw. Swallow it — the
      // generic 500 below is the guarantee that must hold, not the log line.
    }
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  };
}
