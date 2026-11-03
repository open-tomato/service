import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { CircuitOpenError } from './circuit-breaker.js';
import { toErrorResponse, zodToValidationError } from './error-response.js';
import { NotFoundError, ValidationError } from './errors.js';

const GENERIC = { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };

/** A ZodError from a real parse, so its issues have the shape zod gives them. */
function zodError(input: unknown): z.ZodError {
  const result = z.object({ user: z.object({ email: z.string() }), name: z.string() }).safeParse(input);
  if (result.success) throw new Error('expected the parse to fail');
  return result.error;
}

/** An error carrying an HTTP status, as body-parser and http-errors throw them. */
function httpError(message: string, fields: Record<string, unknown>): Error {
  return Object.assign(new Error(message), fields);
}

describe('zodToValidationError', () => {
  it('maps each issue to a field error, its path joined with dots', () => {
    const result = zodToValidationError(zodError({ user: {} }));

    expect(result).toBeInstanceOf(ValidationError);
    expect(result.details).toEqual([
      { field: 'user.email', message: expect.any(String), code: 'invalid_type' },
      { field: 'name', message: expect.any(String), code: 'invalid_type' },
    ]);
  });
});

describe('toErrorResponse', () => {
  it('answers an AppError with its own status and body', () => {
    expect(toErrorResponse(new NotFoundError('order not found', { orderId: 'o-1' }))).toStrictEqual({
      status: 404,
      body: { code: 'NOT_FOUND', message: 'order not found', details: { orderId: 'o-1' } },
    });
  });

  it('answers a ZodError with 422 and a field error per issue', () => {
    const { status, body } = toErrorResponse(zodError({ user: { email: 'a@b.c' } }));

    expect(status).toBe(422);
    expect(body).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Validation failed', details: [{ field: 'name' }] });
  });

  it('answers an open circuit with 503 and no word of the breaker', () => {
    expect(toErrorResponse(new CircuitOpenError())).toStrictEqual({
      status: 503,
      body: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable' },
    });
  });

  it('answers a 4xx error with its status, its message, and a code from the status', () => {
    const tooLarge = httpError('request entity too large', { status: 413, type: 'entity.too.large' });

    expect(toErrorResponse(tooLarge)).toStrictEqual({
      status: 413,
      body: { code: 'PAYLOAD_TOO_LARGE', message: 'request entity too large' },
    });
  });

  it('uses a 4xx error\'s own string code and details when it has them', () => {
    const taken = httpError('email taken', { statusCode: 409, code: 'EMAIL_TAKEN', details: { field: 'email' } });

    expect(toErrorResponse(taken)).toStrictEqual({
      status: 409,
      body: { code: 'EMAIL_TAKEN', message: 'email taken', details: { field: 'email' } },
    });
  });

  it.each([
    [418, 'CLIENT_ERROR', 'Request failed'],
    [404, 'NOT_FOUND', 'Not found'],
  ])('falls back to the status\'s code and message for a bare %i', (status, code, message) => {
    expect(toErrorResponse(httpError('', { status }))).toStrictEqual({ status, body: { code, message } });
  });

  it('answers a 5xx error with a generic body for its status, keeping its own code and message out', () => {
    const upstream = httpError('db at db-primary.internal refused', { status: 502, code: 'ECONNREFUSED', details: { host: 'db-primary.internal' } });

    expect(toErrorResponse(upstream)).toStrictEqual({ status: 502, body: { code: 'BAD_GATEWAY', message: 'Bad gateway' } });
  });

  it('answers an unknown error with the generic 500, keeping its code out', () => {
    expect(toErrorResponse(httpError('secret path /etc/x', { code: 'SOME_TYPED_FAILURE' }))).toStrictEqual({
      status: 500,
      body: GENERIC,
    });
  });

  it.each([
    ['a string', 'boom'],
    ['null', null],
    ['a status out of range', httpError('weird', { status: 200 })],
    ['a status that is not a number', httpError('weird', { status: '404' })],
  ])('answers %s with the generic 500', (_label, thrown) => {
    expect(toErrorResponse(thrown)).toStrictEqual({ status: 500, body: GENERIC });
  });

  it('answers the generic 500 when reading the error throws', () => {
    const hostile = new Error('hostile');
    Object.defineProperty(hostile, 'status', { get: () => { throw new Error('getter threw'); } });

    expect(toErrorResponse(hostile)).toStrictEqual({ status: 500, body: GENERIC });
  });
});
