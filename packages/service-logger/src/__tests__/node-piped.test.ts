import type { IncomingMessage, ServerResponse } from 'node:http';

import { EventEmitter } from 'node:events';

import { inDomain } from '@open-tomato/service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHttpLogger, createLogger } from '../node.js';

const TRACE_ID = '3f2a9c1e-aaaa-bbbb-cccc-000000000000';
const DOMAIN = 'Users';
const SCOPE = 'create';

const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

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

const ENV_NAMES = ['NO_COLOR', 'LOG_FORMAT', 'LOG_LEVEL'] as const;
const originalEnv = new Map(ENV_NAMES.map(name => [name, process.env[name]]));

function setEnv(name: typeof ENV_NAMES[number], value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, name);
  else process.env[name] = value;
}

describe('stdout channel by TTY — createLogger and createHttpLogger', () => {
  let chunks: string[];

  beforeEach(() => {
    chunks = [];
    setEnv('NO_COLOR', '1');
    setEnv('LOG_FORMAT', undefined);
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
    for (const name of ENV_NAMES) setEnv(name, originalEnv.get(name));
    restoreIsTTY();
  });

  function logOnce(): void {
    inDomain(createLogger('orders'), DOMAIN).child({ traceId: TRACE_ID, scope: SCOPE })
      .info({ step: 'insert', userId: 42 }, 'user created');
  }

  function logRequest(): void {
    const logger = createLogger('orders').child({ domain: DOMAIN, scope: SCOPE });
    const middleware = createHttpLogger({ logger });
    const req = Object.assign(Object.create(null), {
      headers: { 'x-request-id': TRACE_ID },
      method: 'GET',
      url: '/api/test',
      socket: { remoteAddress: '127.0.0.1' },
    }) as unknown as IncomingMessage;
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      setHeader: vi.fn(),
      getHeader: vi.fn(),
    }) as unknown as ServerResponse;
    middleware(req, res, vi.fn());
    res.emit('finish');
  }

  function expectJsonRecord(chunk: string | undefined): Record<string, unknown> {
    expect(chunk).toBeDefined();
    const parsed = JSON.parse(chunk!) as Record<string, unknown>;
    expect(parsed['service']).toBe('orders');
    expect(parsed['traceId']).toBe(TRACE_ID);
    expect(parsed['domain']).toBe(DOMAIN);
    expect(parsed['scope']).toBe(SCOPE);
    return parsed;
  }

  it('writes JSON with traceId, domain and scope as plain fields on a piped stdout', () => {
    fakeIsTTY(false);
    logOnce();

    expect(chunks).toHaveLength(1);
    const parsed = expectJsonRecord(chunks[0]);
    expect(parsed['msg']).toBe('user created');
    expect(parsed['userId']).toBe(42);
  });

  it('keeps traceId, domain, scope and step as four plain fields on a piped stdout', () => {
    fakeIsTTY(false);
    logOnce();

    const parsed = expectJsonRecord(chunks[0]);
    expect(parsed['step']).toBe('insert');
    expect(parsed['domain']).toBe('Users');
    expect(parsed['scope']).toBe('create');
    expect(chunks[0]).not.toContain('Users:create');
  });

  it('writes JSON with traceId, domain and scope through createHttpLogger on a piped stdout', () => {
    fakeIsTTY(false);
    logRequest();

    expect(chunks).toHaveLength(1);
    expectJsonRecord(chunks[0]);
  });

  it('writes a decorated line on a TTY', () => {
    fakeIsTTY(true);
    logOnce();

    expect(chunks).toHaveLength(1);
    expect(() => JSON.parse(chunks[0]!)).toThrow();
    expect(chunks[0]).toContain('INFO');
    expect(chunks[0]).toContain('3f2a9c1e');
    expect(chunks[0]).toContain(`${DOMAIN}:${SCOPE}:insert`);
    expect(chunks[0]).toContain('user created');
    expect(chunks[0]).toContain('userId=42');
  });

  it('writes JSON on a TTY when LOG_FORMAT is json', () => {
    fakeIsTTY(true);
    setEnv('LOG_FORMAT', 'json');
    logOnce();

    expect(chunks).toHaveLength(1);
    expectJsonRecord(chunks[0]);
  });
});
