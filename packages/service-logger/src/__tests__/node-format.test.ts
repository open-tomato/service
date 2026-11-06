import type { LoggerOptions } from '../types.js';

import { inDomain } from '@open-tomato/service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from '../node.js';

/** The descriptor `process.stdout.isTTY` had before a test faked it. */
const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

/** Fakes `process.stdout.isTTY`; `undefined` is a piped stdout, which has none. */
function fakeIsTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true, writable: true });
}

function restoreIsTTY(): void {
  if (originalIsTTY === undefined) {
    Reflect.deleteProperty(process.stdout, 'isTTY');
  } else {
    Object.defineProperty(process.stdout, 'isTTY', originalIsTTY);
  }
}

/** The env names these tests set, and their values before the file ran. */
const ENV_NAMES = ['NO_COLOR', 'LOG_FORMAT', 'NODE_ENV', 'LOG_LEVEL'] as const;
type EnvName = typeof ENV_NAMES[number];
const originalEnv = new Map(ENV_NAMES.map(name => [name, process.env[name]]));

/** Sets an env name, or removes it when `value` is `undefined`. */
function setEnv(name: EnvName, value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, name);
  else process.env[name] = value;
}

function restoreEnv(): void {
  for (const name of ENV_NAMES) setEnv(name, originalEnv.get(name));
}

function isJson(chunk: string): boolean {
  try {
    JSON.parse(chunk);
    return true;
  } catch {
    return false;
  }
}

/** The pick a test sets up: stdout's TTY flag, `LOG_FORMAT` and the options. */
interface Pick {
  isTTY: boolean | undefined
  logFormat?: string
  options?: LoggerOptions
}

describe('createLogger — format pick', () => {
  let chunks: string[];

  beforeEach(() => {
    chunks = [];
    setEnv('NO_COLOR', '1');
    setEnv('LOG_LEVEL', undefined);
    setEnv('LOG_FORMAT', undefined);
    setEnv('NODE_ENV', undefined);
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(typeof chunk === 'string'
        ? chunk
        : chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreEnv();
    restoreIsTTY();
  });

  /** Logs one record under `pick` and returns what reached stdout. */
  function logUnder(pick: Pick): string {
    fakeIsTTY(pick.isTTY);
    if (pick.logFormat !== undefined) setEnv('LOG_FORMAT', pick.logFormat);
    createLogger('orders', pick.options).info({ userId: 42 }, 'user created');
    expect(chunks).toHaveLength(1);
    return chunks[0] ?? '';
  }

  function expectTerminal(chunk: string): void {
    expect(isJson(chunk)).toBe(false);
    expect(chunk).toMatch(/^\d\d:\d\d:\d\d\.\d{3} INFO {2}orders {2}user created {2}userId=42\n$/);
  }

  function expectJson(chunk: string): void {
    expect(isJson(chunk)).toBe(true);
    const record = JSON.parse(chunk) as Record<string, unknown>;
    expect(record['service']).toBe('orders');
    expect(record['msg']).toBe('user created');
    expect(record['userId']).toBe(42);
  }

  it('draws terminal lines when stdout is a TTY and nothing else is set', () => {
    expectTerminal(logUnder({ isTTY: true }));
  });

  it('writes JSON when stdout is not a TTY', () => {
    expectJson(logUnder({ isTTY: false }));
  });

  it('writes JSON when stdout is piped and has no isTTY', () => {
    expectJson(logUnder({ isTTY: undefined }));
  });

  it('takes pretty over the TTY check', () => {
    expectTerminal(logUnder({ isTTY: false, options: { pretty: true } }));
    chunks.length = 0;
    expectJson(logUnder({ isTTY: true, options: { pretty: false } }));
  });

  it('takes LOG_FORMAT over pretty and the TTY check', () => {
    expectJson(logUnder({ isTTY: true, logFormat: 'json', options: { pretty: true } }));
    chunks.length = 0;
    expectTerminal(logUnder({ isTTY: false, logFormat: 'terminal', options: { pretty: false } }));
  });

  it('ignores a LOG_FORMAT that is neither terminal nor json', () => {
    expectTerminal(logUnder({ isTTY: true, logFormat: 'pretty' }));
    chunks.length = 0;
    expectJson(logUnder({ isTTY: true, logFormat: 'JSON', options: { pretty: false } }));
  });

  it('takes the format option over LOG_FORMAT, pretty and the TTY check', () => {
    expectJson(logUnder({
      isTTY: true,
      logFormat: 'terminal',
      options: { format: 'json', pretty: true },
    }));
    chunks.length = 0;
    expectTerminal(logUnder({
      isTTY: false,
      logFormat: 'json',
      options: { format: 'terminal', pretty: false },
    }));
  });

  it('no longer reads NODE_ENV', () => {
    setEnv('NODE_ENV', 'development');

    expectJson(logUnder({ isTTY: false }));
  });

  it('keeps the terminal channel for a child and writes before the call returns', () => {
    fakeIsTTY(true);
    const child = createLogger('orders').child({ traceId: '3f2a9c1e5d6b4a', domain: 'Users', scope: 'create' });

    child.warn('slow');

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatch(/^\d\d:\d\d:\d\d\.\d{3} WARN {2}orders {2}3f2a9c1e {2}Users:create {2}slow\n$/);
  });

  it('draws the step in the signature for one call and drops it on the next', () => {
    fakeIsTTY(true);
    const child = inDomain(createLogger('orders'), 'Users')
      .child({ traceId: '3f2a9c1e5d6b4a', scope: 'create' });

    child.info({ step: 'insert' }, 'user created');
    child.info('next');

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatch(/ {2}Users:create:insert {2}user created\n$/);
    expect(chunks[1]).toMatch(/ {2}Users:create {2}next\n$/);
    expect(chunks[1]).not.toContain('step');
  });
});

describe('createLogger — err serializer', () => {
  let chunks: string[];

  beforeEach(() => {
    chunks = [];
    setEnv('NO_COLOR', '1');
    setEnv('LOG_LEVEL', undefined);
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(typeof chunk === 'string'
        ? chunk
        : chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreEnv();
  });

  const failure = new Error('order failed', { cause: new TypeError('bad total') });

  it('keeps the cause chain as nested objects in the json record', () => {
    createLogger('orders', { format: 'json' }).error({ err: failure }, 'could not create order');

    expect(chunks).toHaveLength(1);
    const record = JSON.parse(chunks[0] ?? '') as { err: Record<string, unknown> };
    expect(record.err['type']).toBe('Error');
    expect(record.err['message']).toBe('order failed');
    expect(record.err['cause']).toMatchObject({ type: 'TypeError', message: 'bad total' });
  });

  it('draws one line per link of the chain on the terminal channel', () => {
    createLogger('orders', { format: 'terminal' }).error({ err: failure }, 'could not create order');

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.split('\n').slice(1)).toEqual([
      '  Error: order failed',
      '  TypeError: bad total',
      '',
    ]);
  });
});
