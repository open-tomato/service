/**
 * Public entry point for `@open-tomato/service-errors`.
 * Re-exports all types, error classes, handler utilities, and client utilities.
 */

export type { FieldError, AppErrorShape } from './types.js';

export {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  ConflictError,
  BadRequestError,
  InternalError,
} from './errors.js';

export type { Logger } from './handler.js';
export { zodToValidationError, errorHandler } from './handler.js';

export { isAppError, parseApiError } from './client.js';
