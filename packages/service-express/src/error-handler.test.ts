import type { ErrorFormatter, Logger } from '@open-tomato/service';
import type { Request, Response } from 'express';

import { NotFoundError } from '@open-tomato/service';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createErrorHandler } from './error-handler.js';

/** A logger whose calls a test can read. */
function spyLogger(): Logger & { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() } as never;
}

/** A logger that throws on every call. */
function throwingLogger(): Logger {
  const fail = (): never => {
    throw new Error('logger down');
  };
  return { debug: fail, info: fail, warn: fail, error: fail, child: fail } as unknown as Logger;
}

/** An app whose one route throws `error`, with the handler under test last. */
function appThrowing(error: unknown, logger: Logger = spyLogger(), format?: ErrorFormatter): express.Application {
  const app = express();
  app.use(express.json());
  app.all('/', () => {
    throw error;
  });
  app.use(createErrorHandler(logger, format));
  return app;
}

describe('createErrorHandler', () => {
  it('answers an unexpected error with the generic 500 and logs what it hides', async () => {
    const logger = spyLogger();
    const failure = Object.assign(new Error('connection to db-internal:5432 failed'), { code: 'ECONNREFUSED' });

    const res = await request(appThrowing(failure, logger)).get('/');

    expect(res.status).toBe(500);
    expect(res.body).toStrictEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ status: 500, errorName: 'Error', code: 'ECONNREFUSED', stack: expect.any(String) }),
      'connection to db-internal:5432 failed',
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('answers an AppError with its status and body, logged as a warning', async () => {
    const logger = spyLogger();

    const res = await request(appThrowing(new NotFoundError('order not found', { orderId: 'o-1' }), logger)).get('/');

    expect(res.status).toBe(404);
    expect(res.body).toStrictEqual({ code: 'NOT_FOUND', message: 'order not found', details: { orderId: 'o-1' } });
    expect(logger.warn).toHaveBeenCalledWith({ status: 404, code: 'NOT_FOUND' }, 'order not found');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('answers a ZodError with 422 and its field errors', async () => {
    const parsed = z.object({ email: z.string() }).safeParse({});

    const res = await request(appThrowing(parsed.error)).get('/');

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ field: 'email', code: 'invalid_type' }] });
  });

  it('answers a malformed JSON body with body-parser\'s 400', async () => {
    const res = await request(appThrowing(new Error('unreached')))
      .post('/')
      .set('content-type', 'application/json')
      .send('{"broken');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'BAD_REQUEST', message: expect.any(String) });
  });

  it('still answers when the logger throws', async () => {
    const notFound = await request(appThrowing(new NotFoundError('order not found'), throwingLogger())).get('/');
    const unexpected = await request(appThrowing(new Error('boom'), throwingLogger())).get('/');

    expect(notFound.status).toBe(404);
    expect(notFound.body).toStrictEqual({ code: 'NOT_FOUND', message: 'order not found' });
    expect(unexpected.status).toBe(500);
  });

  it('answers with what a formatter of the service\'s own returns', async () => {
    const format: ErrorFormatter = () => ({ status: 418, body: { code: 'TEAPOT', message: 'short and stout' } });

    const res = await request(appThrowing(new Error('boom'), spyLogger(), format)).get('/');

    expect(res.status).toBe(418);
    expect(res.body).toStrictEqual({ code: 'TEAPOT', message: 'short and stout' });
  });

  it('falls back to the default rule when that formatter throws', async () => {
    const format: ErrorFormatter = () => {
      throw new Error('formatter broke');
    };

    const res = await request(appThrowing(new NotFoundError('order not found'), spyLogger(), format)).get('/');

    expect(res.status).toBe(404);
    expect(res.body).toStrictEqual({ code: 'NOT_FOUND', message: 'order not found' });
  });

  it('hands the error to Express once the response has started', () => {
    const next = vi.fn();
    const status = vi.fn();
    const res = { headersSent: true, status } as unknown as Response;
    const failure = new Error('late');

    createErrorHandler(spyLogger())(failure, {} as Request, res, next);

    expect(next).toHaveBeenCalledWith(failure);
    expect(status).not.toHaveBeenCalled();
  });
});
