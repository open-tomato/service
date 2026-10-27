/**
 * Shared type definitions for `@open-tomato/service-errors`.
 * Safe to import in both Node.js and browser contexts.
 */

/**
 * Represents a single field-level validation error.
 * The `field` property uses dot-notation to indicate the path
 * to the offending field (e.g. `"user.email"`).
 */
export interface FieldError {
  /** Dot-notation path to the field that failed validation (e.g. `"user.email"`). */
  field: string
  /** Human-readable description of the validation failure. */
  message: string
  /** Optional machine-readable error code (e.g. a Zod issue code). */
  code?: string
}

/**
 * Serialisable shape of an application error, safe to send over the wire
 * and to import in browser contexts. Used by `isAppError` and `parseApiError`
 * on the client side.
 */
export interface AppErrorShape {
  /** Machine-readable error code (e.g. `"NOT_FOUND"`, `"VALIDATION_ERROR"`). */
  code: string
  /** Human-readable error message. */
  message: string
  /** Optional structured details (e.g. an array of `FieldError` objects). */
  details?: unknown
  /** HTTP status code associated with the error. */
  statusCode?: number
}
