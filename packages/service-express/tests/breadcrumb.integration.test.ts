import type { ResolvedServiceConfig } from '../src/schema.js';
import type { Logger } from '@open-tomato/service';

import { Writable } from 'node:stream';

import { inDomain, scoped } from '@open-tomato/service';
import express from 'express';
import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { applyMiddleware, REQUEST_ID_HEADER } from '../src/middleware.js';

const SERVICE_ID = 'breadcrumb-test';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A real pino logger writing into memory, with a reader for its records. */
function captureLogger(): { logger: Logger, lines: string[], records: () => Record<string, unknown>[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const logger = pino({ level: 'debug', base: { service: SERVICE_ID } }, stream) as unknown as Logger;
  return { logger, lines, records: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

/** An app whose route waits for a release gate, then logs through `scoped(inDomain(req.log, 'Users'), 'create')`. */
function buildApp(
  logger: Logger,
  gate?: Promise<void>,
  boundFields?: Record<string, unknown>[],
): express.Application {
  const app = express();
  applyMiddleware(app, { serviceId: SERVICE_ID } as ResolvedServiceConfig, logger);
  app.post('/users', async (req, res) => {
    const log = scoped(inDomain(req.log as unknown as Logger, 'Users'), 'create');
    log.debug({ step: 'validate' }, 'user validated');
    if (gate) await gate;
    log.info({ step: 'insert' }, 'user created');
    boundFields?.push((req.log as unknown as { bindings: () => Record<string, unknown> }).bindings());
    res.status(201).json({ ok: true });
  });
  return app;
}

function completedRecords(records: Record<string, unknown>[]): Record<string, unknown>[] {
  return records.filter((r) => r['msg'] === 'request completed');
}

function createRecords(records: Record<string, unknown>[]): Record<string, unknown>[] {
  return records.filter((r) => r['domain'] === 'Users');
}

describe('Express breadcrumbs (integration)', () => {
  it('logs the x-request-id header as traceId with the domain and scope and answers with it', async () => {
    const { logger, records } = captureLogger();

    const res = await request(buildApp(logger)).post('/users')
      .set(REQUEST_ID_HEADER, 'trace-abc');

    expect(res.status).toBe(201);
    expect(res.headers[REQUEST_ID_HEADER]).toBe('trace-abc');
    const [validate, insert, ...rest] = createRecords(records());
    expect(rest).toHaveLength(0);
    expect(validate).toMatchObject({
      traceId: 'trace-abc', domain: 'Users', scope: 'create', step: 'validate', level: 20, msg: 'user validated',
    });
    expect(insert).toMatchObject({
      traceId: 'trace-abc', domain: 'Users', scope: 'create', step: 'insert', level: 30, msg: 'user created',
    });
    for (const crumb of [validate, insert]) {
      expect(crumb).not.toHaveProperty('req');
      expect(crumb).not.toHaveProperty('res');
    }
  });

  it('writes req, res and responseTime on the completion line, with traceId once', async () => {
    const { logger, lines, records } = captureLogger();

    await request(buildApp(logger)).post('/users')
      .set(REQUEST_ID_HEADER, 'trace-abc');

    const [completed, ...rest] = completedRecords(records());
    expect(rest).toHaveLength(0);
    expect(completed).toMatchObject({
      traceId: 'trace-abc', req: { method: 'POST', url: '/users' }, res: { statusCode: 201 },
    });
    expect(typeof completed?.['responseTime']).toBe('number');
    const line = lines.find((l) => l.includes('"request completed"'));
    expect(line?.split('"traceId"')).toHaveLength(2);
  });

  it('replaces a refused x-request-id with a UUID the response echoes', async () => {
    const { logger, records } = captureLogger();

    const res = await request(buildApp(logger)).post('/users')
      .set(REQUEST_ID_HEADER, 'trace abc');

    const id = res.headers[REQUEST_ID_HEADER];
    expect(id).toMatch(UUID);
    for (const record of [...createRecords(records()), ...completedRecords(records())]) {
      expect(record['traceId']).toBe(id);
    }
  });

  it('generates a new UUID traceId when the request carries no id', async () => {
    const { logger, records } = captureLogger();

    const res = await request(buildApp(logger)).post('/users');

    const id = res.headers[REQUEST_ID_HEADER];
    expect(id).toMatch(UUID);
    const created = createRecords(records());
    expect(created).toHaveLength(2);
    for (const record of created) {
      expect(record).toMatchObject({ traceId: id, domain: 'Users', scope: 'create' });
    }
  });

  it('keeps each concurrent request on its own traceId', async () => {
    const { logger, records } = captureLogger();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bound: Record<string, unknown>[] = [];
    const app = buildApp(logger, gate, bound);

    const pending = Promise.all([
      request(app).post('/users')
        .set(REQUEST_ID_HEADER, 'trace-one'),
      request(app).post('/users')
        .set(REQUEST_ID_HEADER, 'trace-two'),
    ]);
    setTimeout(release, 50);
    const [one, two] = await pending;

    expect(one.headers[REQUEST_ID_HEADER]).toBe('trace-one');
    expect(two.headers[REQUEST_ID_HEADER]).toBe('trace-two');
    const created = createRecords(records());
    expect(created).toHaveLength(4);
    for (const traceId of ['trace-one', 'trace-two']) {
      const own = created.filter((r) => r['traceId'] === traceId);
      expect(own.map((r) => r['step'])).toEqual(['validate', 'insert']);
      for (const record of own) {
        expect(record).toMatchObject({ domain: 'Users', scope: 'create' });
      }
    }
    expect(bound).toHaveLength(2);
    for (const fields of bound) {
      expect(fields).not.toHaveProperty('step');
    }
  });
});
