import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from './errors.js';

describe('AppError', () => {
  it('is an Error named after its class', () => {
    const err = new AppError({ message: 'oops', statusCode: 500, code: 'TEST' });

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AppError');
  });

  it('keeps the status, code, message and cause it is given', () => {
    const cause = new Error('root cause');
    const err = new AppError({ message: 'bad', statusCode: 400, code: 'BAD', cause });

    expect(err).toMatchObject({ statusCode: 400, code: 'BAD', message: 'bad' });
    expect(err.cause).toBe(cause);
  });

  it('serialises to code and message, with details only when there are some', () => {
    const plain = new AppError({ message: 'oops', statusCode: 500, code: 'TEST' }).toJSON();
    const detailed = new AppError({ message: 'bad', statusCode: 400, code: 'BAD', details: { field: 'email' } }).toJSON();

    expect(plain).toStrictEqual({ code: 'TEST', message: 'oops' });
    expect(detailed).toStrictEqual({ code: 'BAD', message: 'bad', details: { field: 'email' } });
  });
});

describe('the error classes', () => {
  it.each([
    [NotFoundError, 404, 'NOT_FOUND', 'Not found'],
    [UnauthorizedError, 401, 'UNAUTHORIZED', 'Unauthorized'],
    [ForbiddenError, 403, 'FORBIDDEN', 'Forbidden'],
    [ValidationError, 422, 'VALIDATION_ERROR', 'Validation failed'],
    [ConflictError, 409, 'CONFLICT', 'Conflict'],
    [BadRequestError, 400, 'BAD_REQUEST', 'Bad request'],
    [InternalError, 500, 'INTERNAL_ERROR', 'Internal error'],
  ])('%o answers %i %s with a default message', (ErrorClass, statusCode, code, message) => {
    const err = new ErrorClass();

    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ statusCode, code, message, name: ErrorClass.name });
  });

  it('takes a message, details and a cause', () => {
    const cause = new Error('lookup failed');
    const err = new NotFoundError('order not found', { orderId: 'o-1' }, { cause });

    expect(err.toJSON()).toStrictEqual({ code: 'NOT_FOUND', message: 'order not found', details: { orderId: 'o-1' } });
    expect(err.cause).toBe(cause);
  });

  it('types ValidationError details as field errors', () => {
    const fields = [{ field: 'email', message: 'Must be valid', code: 'invalid_format' }];

    expect(new ValidationError('Validation failed', fields).toJSON().details).toEqual(fields);
  });
});

describe('InternalError details', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps its details outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect(new InternalError('boom', { trace: 'x' }).details).toEqual({ trace: 'x' });
  });

  it('drops its details in production, read when the error is made', () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect(new InternalError('boom', { trace: 'secret' }).toJSON()).toStrictEqual({ code: 'INTERNAL_ERROR', message: 'boom' });
  });
});
