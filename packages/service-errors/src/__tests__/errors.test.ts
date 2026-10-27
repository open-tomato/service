import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../errors.js';

describe('AppError', () => {
  it('does not throw when a required field is missing at runtime; properties are undefined', () => {
    // TypeScript enforces required fields at compile time, but at runtime there is no
    // validation. This test documents that the constructor does not throw and that the
    // missing properties are simply undefined.
    const err = new AppError({} as unknown as { message: string; statusCode: number; code: string });
    expect(err).toBeInstanceOf(AppError);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((err as any).statusCode).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((err as any).code).toBeUndefined();
  });

  it('is an instance of Error', () => {
    const err = new AppError({ message: 'oops', statusCode: 500, code: 'TEST' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });

  it('sets name to constructor name', () => {
    const err = new AppError({ message: 'oops', statusCode: 500, code: 'TEST' });
    expect(err.name).toBe('AppError');
  });

  it('sets statusCode, code, and message', () => {
    const err = new AppError({ message: 'bad', statusCode: 400, code: 'BAD' });
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('BAD');
    expect(err.message).toBe('bad');
  });

  it('stores cause via error chaining', () => {
    const cause = new Error('root cause');
    const err = new AppError({ message: 'oops', statusCode: 500, code: 'TEST', cause });
    expect(err.cause).toBe(cause);
  });

  it('toJSON returns code and message without details when details is undefined', () => {
    const err = new AppError({ message: 'oops', statusCode: 500, code: 'TEST' });
    const json = err.toJSON();
    expect(json).toEqual({ code: 'TEST', message: 'oops' });
    expect('details' in json).toBe(false);
  });

  it('toJSON includes details when provided', () => {
    const details = { field: 'email', reason: 'invalid' };
    const err = new AppError({ message: 'bad', statusCode: 400, code: 'BAD', details });
    expect(err.toJSON()).toEqual({ code: 'BAD', message: 'bad', details });
  });
});

describe('NotFoundError', () => {
  it('has statusCode 404 and code NOT_FOUND', () => {
    const err = new NotFoundError();
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
  });

  it('uses default message', () => {
    expect(new NotFoundError().message).toBe('Not found');
  });

  it('accepts custom message and details', () => {
    const err = new NotFoundError('Agent not found', { agentId: '1' });
    expect(err.message).toBe('Agent not found');
    expect(err.details).toEqual({ agentId: '1' });
  });

  it('name is NotFoundError', () => {
    expect(new NotFoundError().name).toBe('NotFoundError');
  });
});

describe('UnauthorizedError', () => {
  it('has statusCode 401 and code UNAUTHORIZED', () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
  });
});

describe('ForbiddenError', () => {
  it('has statusCode 403 and code FORBIDDEN', () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });
});

describe('ValidationError', () => {
  it('has statusCode 422 and code VALIDATION_ERROR', () => {
    const err = new ValidationError();
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('serialises details as FieldError[]', () => {
    const fields = [{ field: 'email', message: 'Must be valid', code: 'invalid_string' }];
    const err = new ValidationError('Validation failed', fields);
    const json = err.toJSON();
    expect(json.details).toEqual(fields);
  });
});

describe('ConflictError', () => {
  it('has statusCode 409 and code CONFLICT', () => {
    const err = new ConflictError();
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('CONFLICT');
  });
});

describe('BadRequestError', () => {
  it('has statusCode 400 and code BAD_REQUEST', () => {
    const err = new BadRequestError();
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('BAD_REQUEST');
  });
});

describe('InternalError', () => {
  it('has statusCode 500 and code INTERNAL_ERROR', () => {
    const err = new InternalError();
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('INTERNAL_ERROR');
  });

  it('includes details in non-production', () => {
    const err = new InternalError('boom', { trace: 'x' });
    expect(err.details).toEqual({ trace: 'x' });
  });

  describe('production mode', () => {
    const originalEnv = process.env['NODE_ENV'];

    beforeEach(() => {
      process.env['NODE_ENV'] = 'production';
      vi.resetModules();
    });

    afterEach(() => {
      process.env['NODE_ENV'] = originalEnv;
      vi.resetModules();
    });

    it('strips details when NODE_ENV is production', async () => {
      const { InternalError: ProdInternalError } = await import('../errors.js');
      const err = new ProdInternalError('boom', { trace: 'secret' });
      expect(err.details).toBeUndefined();
    });
  });
});
