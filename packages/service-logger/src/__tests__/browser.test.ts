import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from '../browser.js';

describe('browser entry — static import analysis', () => {
  const browserSrc = readFileSync(
    resolve(import.meta.dirname, '../browser.ts'),
    'utf-8',
  );

  it('contains no import from pino-http', () => {
    expect(browserSrc).not.toMatch('pino-http');
  });

  it('contains no import from pino-pretty', () => {
    expect(browserSrc).not.toMatch('pino-pretty');
  });

  it('contains no node:* built-in imports', () => {
    expect(browserSrc).not.toMatch(/['"]node:[a-z]/);
  });
});

describe('createLogger — browser entry', () => {
  let consoleCalls: unknown[][];

  beforeEach(() => {
    consoleCalls = [];
    vi.spyOn(console, 'info').mockImplementation((...args) => {
      consoleCalls.push(args);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes service binding in log output', () => {
    const logger = createLogger('x');
    logger.info({}, 'msg');

    expect(consoleCalls.length).toBeGreaterThan(0);
    const logObj = consoleCalls[0]![0] as Record<string, unknown>;
    expect(logObj['service']).toBe('x');
    expect(logObj['msg']).toBe('msg');
  });

  it('child logger inherits service binding', () => {
    const logger = createLogger('my-service');
    const child = logger.child({ requestId: 'abc-123' });
    child.info({}, 'child msg');

    expect(consoleCalls.length).toBeGreaterThan(0);
    const logObj = consoleCalls[0]![0] as Record<string, unknown>;
    expect(logObj['service']).toBe('my-service');
    expect(logObj['requestId']).toBe('abc-123');
    expect(logObj['msg']).toBe('child msg');
  });
});

describe('createLogger — browser entry LOG_LEVEL env var', () => {
  const originalLogLevel = process.env['LOG_LEVEL'];

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    if (originalLogLevel === undefined) {
      delete process.env['LOG_LEVEL'];
    } else {
      process.env['LOG_LEVEL'] = originalLogLevel;
    }
  });

  it('suppresses info-level output when LOG_LEVEL=warn', async () => {
    const infoCalls: unknown[][] = [];
    const warnCalls: unknown[][] = [];
    vi.spyOn(console, 'info').mockImplementation((...args) => {
      infoCalls.push(args);
    });
    vi.spyOn(console, 'warn').mockImplementation((...args) => {
      warnCalls.push(args);
    });

    process.env['LOG_LEVEL'] = 'warn';
    vi.resetModules();

    const { createLogger: createLoggerFresh } = await import('../browser.js');
    const logger = createLoggerFresh('svc');

    logger.info({}, 'this should be suppressed');
    expect(infoCalls.length).toBe(0);

    logger.warn({}, 'this should appear');
    expect(warnCalls.length).toBeGreaterThan(0);
    const logObj = warnCalls[0]![0] as Record<string, unknown>;
    expect(logObj['msg']).toBe('this should appear');
  });
});
