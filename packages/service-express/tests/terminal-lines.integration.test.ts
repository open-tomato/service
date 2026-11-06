import type { ResolvedServiceConfig } from '../src/schema.js';
import type { Logger } from '@open-tomato/service';

import { inDomain, scoped } from '@open-tomato/service';
import { createLogger } from '@open-tomato/service-logger';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyMiddleware } from '../src/middleware.js';

const SERVICE_ID = 'terminal-lines-test';
const MAX_LINE_LENGTH = 200;
const COMPLETION_TAIL = /POST \/users → 201 \d+ms$/;

describe('Express terminal lines (integration)', () => {
  let written: string[];

  beforeEach(() => {
    vi.stubEnv('NO_COLOR', '1');
    written = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function lines(): string[] {
    return written.flatMap((chunk) => chunk.split('\n')).filter((line) => line.length > 0);
  }

  it('draws short lines with no req= or res= and one tail per request', async () => {
    const logger = createLogger(SERVICE_ID, { format: 'terminal', level: 'debug' });
    const app = express();
    applyMiddleware(app, { serviceId: SERVICE_ID } as ResolvedServiceConfig, logger);
    app.post('/users', (req, res) => {
      const log = scoped(inDomain(req.log as unknown as Logger, 'Users'), 'create');
      log.debug({ step: 'validate' }, 'user validated');
      log.info({ step: 'insert' }, 'user created');
      res.status(201).json({ ok: true });
    });

    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const res = await request(app).post('/users');
      expect(res.status).toBe(201);
      ids.push(String(res.headers['x-request-id']));
    }

    const all = lines();
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const line of all) {
      expect(line.length).toBeLessThan(MAX_LINE_LENGTH);
      expect(line).not.toContain('req=');
      expect(line).not.toContain('res=');
    }

    const completions = all.filter((line) => COMPLETION_TAIL.test(line));
    expect(completions).toHaveLength(2);
    const shortIds = ids.map((id) => id.slice(0, 8));
    expect(new Set(shortIds).size).toBe(2);
    completions.forEach((line, index) => {
      expect(line).toContain(shortIds[index]);
    });
  });
});
