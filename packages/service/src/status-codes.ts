/** A status's code and the message to send when the error gives none. */
interface StatusText {
  readonly code: string;
  readonly message: string;
}

/** The generic message for a server error, which never carries the error's own text. */
export const GENERIC_SERVER_MESSAGE = 'An unexpected error occurred';

const KNOWN: Readonly<Record<number, StatusText>> = {
  400: { code: 'BAD_REQUEST', message: 'Bad request' },
  401: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
  403: { code: 'FORBIDDEN', message: 'Forbidden' },
  404: { code: 'NOT_FOUND', message: 'Not found' },
  405: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' },
  408: { code: 'REQUEST_TIMEOUT', message: 'Request timeout' },
  409: { code: 'CONFLICT', message: 'Conflict' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload too large' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported media type' },
  422: { code: 'VALIDATION_ERROR', message: 'Validation failed' },
  429: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests' },
  500: { code: 'INTERNAL_ERROR', message: GENERIC_SERVER_MESSAGE },
  502: { code: 'BAD_GATEWAY', message: 'Bad gateway' },
  503: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable' },
  504: { code: 'GATEWAY_TIMEOUT', message: 'Gateway timeout' },
};

const CLIENT_ERROR: StatusText = { code: 'CLIENT_ERROR', message: 'Request failed' };
const SERVER_ERROR: StatusText = { code: 'SERVER_ERROR', message: GENERIC_SERVER_MESSAGE };
const UNEXPECTED: StatusText = { code: 'UNEXPECTED_STATUS', message: 'Unexpected response status' };

/** The first status of the client-error range. */
export const CLIENT_ERROR_STATUS = 400;
/** The first status of the server-error range. */
export const SERVER_ERROR_STATUS = 500;
/** The first status past the server-error range. */
const PAST_SERVER_ERRORS = 600;

/**
 * The code and default message for an HTTP status: the named ones for
 * common statuses, then `CLIENT_ERROR` or `SERVER_ERROR` for the rest of
 * each range, and `UNEXPECTED_STATUS` outside them.
 */
export function statusText(status: number): StatusText {
  const known = KNOWN[status];
  if (known !== undefined) return known;
  if (status >= CLIENT_ERROR_STATUS && status < SERVER_ERROR_STATUS) return CLIENT_ERROR;
  if (status >= SERVER_ERROR_STATUS && status < PAST_SERVER_ERRORS) return SERVER_ERROR;
  return UNEXPECTED;
}

/** Whether `value` is an integer status in the 4xx or 5xx range. */
export function isErrorStatus(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= CLIENT_ERROR_STATUS
    && value < PAST_SERVER_ERRORS;
}
