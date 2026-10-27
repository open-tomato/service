import type { ResolvedServiceConfig } from './schema.js';
import type { ServiceLogger } from '@open-tomato/service';

import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyMiddleware } from './middleware.js';

const SERVICE_ID = 'redaction-test';
const TOKEN = 'token-value-123';
const COOKIE = 'cookie-value-456';
const API_KEY = 'api-key-value-789';

const logger = { debug: vi.fn() } as unknown as ServiceLogger;

describe('applyMiddleware — request logging', () => {
  let written: string[];

  beforeEach(() => {
    written = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps credential headers out of the request log', async () => {
    const app = express();
    applyMiddleware(app, { serviceId: SERVICE_ID } as ResolvedServiceConfig, logger);
    app.get('/', (_req, res) => {
      res.json({ ok: true });
    });

    await request(app)
      .get('/')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('Cookie', `session=${COOKIE}`)
      .set('X-Api-Key', API_KEY);

    const log = written.join('');
    // Control: the request was logged, so the absences below are real.
    expect(log).toContain(SERVICE_ID);
    expect(log).toContain('[Redacted]');
    expect(log).not.toContain(TOKEN);
    expect(log).not.toContain(COOKIE);
    expect(log).not.toContain(API_KEY);
  });
});
