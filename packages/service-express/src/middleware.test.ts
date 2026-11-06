import type { ResolvedServiceConfig } from './schema.js';
import type { Logger } from '@open-tomato/service';

import { Writable } from 'node:stream';

import express from 'express';
import pino from 'pino';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyMiddleware, REQUEST_ID_HEADER } from './middleware.js';

const SERVICE_ID = 'middleware-test';
const TOKEN = 'token-value-123';
const COOKIE = 'cookie-value-456';
const API_KEY = 'api-key-value-789';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface Captured {
  logger: Logger
  lines: string[]
  records: () => Record<string, unknown>[]
}

/** A real pino logger bound like the service logger, writing into memory. */
function captureLogger(): Captured {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const logger = pino({ level: 'debug', base: { service: SERVICE_ID } }, stream) as unknown as Logger;
  return {
    logger,
    lines,
    records: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

function buildApp(logger: Logger): express.Application {
  const app = express();
  applyMiddleware(app, { serviceId: SERVICE_ID } as ResolvedServiceConfig, logger);
  app.get('/', (req, res) => {
    req.log.info({ marker: 'route' }, 'in route');
    res.json({ ok: true });
  });
  return app;
}

function routeRecord(records: Record<string, unknown>[]): Record<string, unknown> | undefined {
  return records.find((r) => r['marker'] === 'route');
}

function completedRecord(records: Record<string, unknown>[]): Record<string, unknown> | undefined {
  return records.find((r) => r['msg'] === 'request completed');
}

describe('applyMiddleware — request logging', () => {
  let captured: Captured;

  beforeEach(() => {
    captured = captureLogger();
  });

  it('writes request logs through the logger it is given', async () => {
    await request(buildApp(captured.logger)).get('/');

    const completed = completedRecord(captured.records());
    expect(completed).toBeDefined();
    expect(completed?.['service']).toBe(SERVICE_ID);
  });

  it('keeps credential headers out of the request log', async () => {
    await request(buildApp(captured.logger))
      .get('/')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('Cookie', `session=${COOKIE}`)
      .set('X-Api-Key', API_KEY);

    const log = captured.lines.join('');
    // Control: the request was logged, so the absences below are real.
    expect(log).toContain(SERVICE_ID);
    expect(log).toContain('[Redacted]');
    expect(log).not.toContain(TOKEN);
    expect(log).not.toContain(COOKIE);
    expect(log).not.toContain(API_KEY);
  });

  it('takes the request id from x-request-id, binds it as traceId and answers with it', async () => {
    const res = await request(buildApp(captured.logger)).get('/')
      .set(REQUEST_ID_HEADER, 'trace-abc');

    expect(res.headers[REQUEST_ID_HEADER]).toBe('trace-abc');
    const records = captured.records();
    expect(routeRecord(records)?.['traceId']).toBe('trace-abc');
    expect(completedRecord(records)?.['traceId']).toBe('trace-abc');
  });

  it('makes a new UUID when x-request-id is absent, and answers and logs that one', async () => {
    const res = await request(buildApp(captured.logger)).get('/');

    const id = res.headers[REQUEST_ID_HEADER] as string | undefined;
    expect(id).toMatch(UUID);
    expect(routeRecord(captured.records())?.['traceId']).toBe(id);
  });

  it('makes a new UUID when x-request-id is empty', async () => {
    const res = await request(buildApp(captured.logger)).get('/')
      .set(REQUEST_ID_HEADER, '');

    expect(res.headers[REQUEST_ID_HEADER]).toMatch(UUID);
  });

  it.each([
    ['holds a space', 'trace abc'],
    ['is 65 characters long', 'a'.repeat(65)],
  ])('replaces an x-request-id that %s with a UUID the response echoes', async (_case, given) => {
    const res = await request(buildApp(captured.logger)).get('/')
      .set(REQUEST_ID_HEADER, given);

    const id = res.headers[REQUEST_ID_HEADER] as string | undefined;
    expect(id).toMatch(UUID);
    expect(id).not.toBe(given);
    const records = captured.records();
    expect(routeRecord(records)?.['traceId']).toBe(id);
    expect(completedRecord(records)?.['traceId']).toBe(id);
  });

  it('keeps a 64-character x-request-id, the control for the 65-character case', async () => {
    const given = 'a'.repeat(64);
    const res = await request(buildApp(captured.logger)).get('/')
      .set(REQUEST_ID_HEADER, given);

    expect(res.headers[REQUEST_ID_HEADER]).toBe(given);
  });

  it('binds only traceId on req.log, so a crumb carries no req', async () => {
    const res = await request(buildApp(captured.logger)).get('/')
      .set(REQUEST_ID_HEADER, 'trace-abc');

    expect(res.status).toBe(200);
    const crumb = routeRecord(captured.records());
    expect(crumb).toMatchObject({ traceId: 'trace-abc', msg: 'in route' });
    expect(crumb).not.toHaveProperty('req');
    expect(crumb).not.toHaveProperty('res');
  });

  it('writes req, res and responseTime on the request completed record, with traceId once', async () => {
    await request(buildApp(captured.logger)).get('/')
      .set(REQUEST_ID_HEADER, 'trace-abc');

    const completed = completedRecord(captured.records());
    expect(completed).toMatchObject({ traceId: 'trace-abc', req: { method: 'GET', url: '/' }, res: { statusCode: 200 } });
    expect(typeof completed?.['responseTime']).toBe('number');
    const line = captured.lines.find((l) => l.includes('"request completed"'));
    expect(line).toBeDefined();
    expect(line?.split('"traceId"')).toHaveLength(2);
  });

  it('gives each request without x-request-id its own id', async () => {
    const app = buildApp(captured.logger);
    const first = await request(app).get('/');
    const second = await request(app).get('/');

    expect(first.headers[REQUEST_ID_HEADER]).not.toBe(second.headers[REQUEST_ID_HEADER]);
  });
});
