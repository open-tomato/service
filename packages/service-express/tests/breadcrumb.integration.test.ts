import type { ResolvedServiceConfig } from '../src/schema.js';
import type { Logger } from '@open-tomato/service';

import { Writable } from 'node:stream';

import { scoped } from '@open-tomato/service';
import express from 'express';
import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { applyMiddleware, REQUEST_ID_HEADER } from '../src/middleware.js';

const SERVICE_ID = 'breadcrumb-test';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A real pino logger writing into memory, with a reader for its records. */
function captureLogger(): { logger: Logger, records: () => Record<string, unknown>[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const logger = pino({ level: 'debug', base: { service: SERVICE_ID } }, stream) as unknown as Logger;
  return { logger, records: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

/** An app whose route waits for a release gate, then logs through `scoped(req.log, ...)`. */
function buildApp(logger: Logger, gate?: Promise<void>): express.Application {
  const app = express();
  applyMiddleware(app, { serviceId: SERVICE_ID } as ResolvedServiceConfig, logger);
  app.post('/users', async (req, res) => {
    if (gate) await gate;
    scoped(req.log as unknown as Logger, 'Users', 'create').info({ marker: 'create' }, 'user created');
    res.status(201).json({ ok: true });
  });
  return app;
}

function createRecords(records: Record<string, unknown>[]): Record<string, unknown>[] {
  return records.filter((r) => r['marker'] === 'create');
}

describe('Express breadcrumbs (integration)', () => {
  it('logs the x-request-id header as traceId with the scope and answers with it', async () => {
    const { logger, records } = captureLogger();

    const res = await request(buildApp(logger)).post('/users').set(REQUEST_ID_HEADER, 'trace-abc');

    expect(res.status).toBe(201);
    expect(res.headers[REQUEST_ID_HEADER]).toBe('trace-abc');
    const [record, ...rest] = createRecords(records());
    expect(rest).toHaveLength(0);
    expect(record).toMatchObject({ traceId: 'trace-abc', scope: 'Users:create', msg: 'user created' });
  });

  it('generates a new UUID traceId when the request carries no id', async () => {
    const { logger, records } = captureLogger();

    const res = await request(buildApp(logger)).post('/users');

    const id = res.headers[REQUEST_ID_HEADER];
    expect(id).toMatch(UUID);
    const [record] = createRecords(records());
    expect(record).toMatchObject({ traceId: id, scope: 'Users:create' });
  });

  it('keeps each concurrent request on its own traceId', async () => {
    const { logger, records } = captureLogger();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = buildApp(logger, gate);

    const pending = Promise.all([
      request(app).post('/users').set(REQUEST_ID_HEADER, 'trace-one'),
      request(app).post('/users').set(REQUEST_ID_HEADER, 'trace-two'),
    ]);
    setTimeout(release, 50);
    const [one, two] = await pending;

    expect(one.headers[REQUEST_ID_HEADER]).toBe('trace-one');
    expect(two.headers[REQUEST_ID_HEADER]).toBe('trace-two');
    const ids = createRecords(records()).map((r) => r['traceId']).sort();
    expect(ids).toEqual(['trace-one', 'trace-two']);
  });
});
