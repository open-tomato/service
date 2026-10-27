import type { Logger } from '../handler.js';

import { describe, expect, it, vi } from 'vitest';
import { ZodError, ZodIssueCode } from 'zod';

import { NotFoundError, ValidationError } from '../errors.js';
import { errorHandler, zodToValidationError } from '../handler.js';

function makeRes() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function makeLogger(): Logger {
  return {
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// Minimal Express req and next stubs
const req = {} as Parameters<ReturnType<typeof errorHandler>>[1];
const next = vi.fn() as Parameters<ReturnType<typeof errorHandler>>[3];

describe('zodToValidationError', () => {
  it('maps a nested path to dot-notation field', () => {
    const zodErr = new ZodError([
      {
        code: ZodIssueCode.invalid_type,
        expected: 'string',
        path: ['user', 'email'],
        message: 'Required',
      },
    ]);

    const result = zodToValidationError(zodErr);
    expect(result).toBeInstanceOf(ValidationError);
    expect(result.details).toEqual([
      { field: 'user.email', message: 'Required', code: ZodIssueCode.invalid_type },
    ]);
  });

  it('maps a top-level field (single-element path) without a dot', () => {
    const zodErr = new ZodError([
      {
        code: ZodIssueCode.invalid_type,
        expected: 'string',
        path: ['name'],
        message: 'Required',
      },
    ]);

    const result = zodToValidationError(zodErr);
    expect(result.details?.[0]?.field).toBe('name');
    expect(result.details?.[0]?.field).not.toContain('.');
  });

  it('maps multiple issues to multiple FieldErrors', () => {
    const zodErr = new ZodError([
      {
        code: ZodIssueCode.invalid_type,
        expected: 'string',
        path: ['a'],
        message: 'Required',
      },
      {
        code: ZodIssueCode.too_small,
        origin: 'string',
        minimum: 1,
        inclusive: true,
        path: ['b', 'c'],
        message: 'Too short',
      },
    ]);

    const result = zodToValidationError(zodErr);
    expect(result.details).toHaveLength(2);
    expect(result.details?.[0]?.field).toBe('a');
    expect(result.details?.[1]?.field).toBe('b.c');
  });
});

describe('errorHandler', () => {
  it('responds 500 with INTERNAL_ERROR for unknown errors; calls logger.error', () => {
    const logger = makeLogger();
    const handler = errorHandler(logger);
    const res = makeRes();
    const err = new Error('something broke');

    handler(err, req, res as never, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('responds with AppError statusCode and code; calls logger.warn', () => {
    const logger = makeLogger();
    const handler = errorHandler(logger);
    const res = makeRes();
    const err = new NotFoundError('Agent not found');

    handler(err, req, res as never, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'NOT_FOUND', message: 'Agent not found' }),
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('responds 422 VALIDATION_ERROR for ZodError with nested path', () => {
    const logger = makeLogger();
    const handler = errorHandler(logger);
    const res = makeRes();

    const zodErr = new ZodError([
      {
        code: ZodIssueCode.invalid_type,
        expected: 'string',
        path: ['user', 'email'],
        message: 'Required',
      },
    ]);

    handler(zodErr, req, res as never, next);

    expect(res.status).toHaveBeenCalledWith(422);

    const body = (res.json.mock.calls[0] as [{ code: string; details: Array<{ field: string }> }])[0];
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details[0]?.field).toBe('user.email');
  });

  it('calls logger.warn (not error) for ZodError', () => {
    const logger = makeLogger();
    const handler = errorHandler(logger);
    const res = makeRes();

    const zodErr = new ZodError([
      {
        code: ZodIssueCode.invalid_type,
        expected: 'string',
        path: ['x'],
        message: 'Required',
      },
    ]);

    handler(zodErr, req, res as never, next);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs errorName and code for an unknown typed error so it is alertable by field', () => {
    const logged: Array<{ obj: object; msg: string }> = [];
    const logger = {
      warn: (): void => {},
      error: (obj: object, msg: string): void => { logged.push({ obj, msg }); },
    };

    class TypedFailure extends Error {
      readonly code = 'SOME_TYPED_FAILURE';
      constructor() {
        super('typed failure');
        this.name = 'TypedFailure';
      }
    }

    const res = makeRes();
    errorHandler(logger)(new TypedFailure(), req, res as never, next);

    expect(logged).toHaveLength(1);
    // `errorName`, not `name` — `name` on this same log stream already means
    // "service id" (see packages/service/express's pino({ name: serviceId })).
    expect(logged[0]?.obj).toMatchObject({ errorName: 'TypedFailure', code: 'SOME_TYPED_FAILURE' });
    // The response stays generic — the code must NOT reach the client.
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  });

  it('logs reason alongside code when the thrown error carries one', () => {
    const logged: Array<{ obj: object; msg: string }> = [];
    const logger = {
      warn: (): void => {},
      error: (obj: object, msg: string): void => { logged.push({ obj, msg }); },
    };

    class TypedFailureWithReason extends Error {
      readonly code = 'SOME_TYPED_FAILURE';
      readonly reason = 'some_reason';
      constructor() {
        super('typed failure');
        this.name = 'TypedFailureWithReason';
      }
    }

    const res = makeRes();
    errorHandler(logger)(new TypedFailureWithReason(), req, res as never, next);

    expect(logged[0]?.obj).toMatchObject({
      errorName: 'TypedFailureWithReason',
      code: 'SOME_TYPED_FAILURE',
      reason: 'some_reason',
    });
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  });

  it('still responds 500 with the generic body when a field is a throwing getter', () => {
    const logger = makeLogger();
    const handler = errorHandler(logger);
    const res = makeRes();

    class HostileFailure extends Error {
      constructor() {
        super('hostile');
        this.name = 'HostileFailure';
      }

      get code(): string {
        throw new Error('boom: code getter threw');
      }
    }

    // The error handler itself must never be the thing that fails to respond.
    expect(() => handler(new HostileFailure(), req, res as never, next)).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  });

  it('still responds with the typed AppError body when logger.warn throws', () => {
    // The same guarantee as the unknown-error branch's "throwing getter" test
    // above, but for the AppError branch: a hostile/throwing logger must not
    // cost the caller their typed status and body.
    const logger: Logger = {
      warn: () => { throw new Error('boom: warn threw'); },
      error: vi.fn(),
    };
    const handler = errorHandler(logger);
    const res = makeRes();
    const err = new NotFoundError('Agent not found');

    expect(() => handler(err, req, res as never, next)).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'NOT_FOUND', message: 'Agent not found' }),
    );
  });

  it('still responds with the 422 VALIDATION_ERROR body when logger.warn throws', () => {
    const logger: Logger = {
      warn: () => { throw new Error('boom: warn threw'); },
      error: vi.fn(),
    };
    const handler = errorHandler(logger);
    const res = makeRes();

    const zodErr = new ZodError([
      {
        code: ZodIssueCode.invalid_type,
        expected: 'string',
        path: ['user', 'email'],
        message: 'Required',
      },
    ]);

    expect(() => handler(zodErr, req, res as never, next)).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(422);
    const body = (res.json.mock.calls[0] as [{ code: string; details: Array<{ field: string }> }])[0];
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details[0]?.field).toBe('user.email');
  });

  it('always responds via res.json (Content-Type: application/json implied)', () => {
    const logger = makeLogger();
    const handler = errorHandler(logger);

    for (const err of [
      new Error('unknown'),
      new NotFoundError(),
      new ZodError([
        {
          code: ZodIssueCode.invalid_type,
          expected: 'string',
          path: ['f'],
          message: 'Required',
        },
      ]),
    ]) {
      const res = makeRes();
      handler(err, req, res as never, next);
      expect(res.json).toHaveBeenCalledTimes(1);
    }
  });
});
