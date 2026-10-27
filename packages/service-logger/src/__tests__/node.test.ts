import type { IncomingMessage, ServerResponse } from 'node:http';

import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHttpLogger, createLogger } from '../node.js';

describe('createLogger — node entry', () => {
  let stdoutChunks: string[];

  beforeEach(() => {
    stdoutChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string'
        ? chunk
        : chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes service binding in log output', () => {
    const logger = createLogger('x');
    logger.info({}, 'msg');

    expect(stdoutChunks.length).toBeGreaterThan(0);
    const parsed = JSON.parse(stdoutChunks[0]!) as Record<string, unknown>;
    expect(parsed['service']).toBe('x');
    expect(parsed['msg']).toBe('msg');
  });
});

describe('createLogger — child logger', () => {
  let stdoutChunks: string[];

  beforeEach(() => {
    stdoutChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string'
        ? chunk
        : chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inherits service binding from parent', () => {
    const parent = createLogger('my-service');
    const child = parent.child({ requestId: 'abc' });

    child.info({}, 'child msg');

    expect(stdoutChunks.length).toBeGreaterThan(0);
    const parsed = JSON.parse(stdoutChunks[0]!) as Record<string, unknown>;
    expect(parsed['service']).toBe('my-service');
    expect(parsed['requestId']).toBe('abc');
    expect(parsed['msg']).toBe('child msg');
  });
});

describe('createHttpLogger — req.log attachment', () => {
  it('attaches req.log as a child logger on each request', () => {
    const logger = createLogger('test-service');
    const middleware = createHttpLogger({ logger });

    const req = Object.assign(Object.create(null), {
      headers: {},
      method: 'GET',
      url: '/test',
      socket: { remoteAddress: '127.0.0.1' },
    }) as unknown as IncomingMessage;

    const res = Object.assign(Object.create(null), {
      statusCode: 200,
      setHeader: vi.fn(),
      getHeader: vi.fn(),
      on: vi.fn(),
    }) as unknown as ServerResponse;

    const next = vi.fn();
    middleware(req, res, next);

    const reqWithLog = req as IncomingMessage & { log?: unknown };
    expect(reqWithLog.log).toBeDefined();
    expect(typeof (reqWithLog.log as unknown as Record<string, unknown>)['info']).toBe('function');
    expect(typeof (reqWithLog.log as unknown as Record<string, unknown>)['child']).toBe('function');
  });
});

describe('createHttpLogger — authorization header redaction', () => {
  let stdoutChunks: string[];

  beforeEach(() => {
    stdoutChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string'
        ? chunk
        : chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redacts the authorization header value in log output', () => {
    const middleware = createHttpLogger();

    const req = Object.assign(Object.create(null), {
      headers: { authorization: 'Bearer secret-token' },
      method: 'GET',
      url: '/api/data',
      socket: { remoteAddress: '127.0.0.1' },
    }) as unknown as IncomingMessage;

    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      setHeader: vi.fn(),
      getHeader: vi.fn(),
    }) as unknown as ServerResponse;

    const next = vi.fn();
    middleware(req, res, next);
    res.emit('finish');

    expect(stdoutChunks.length).toBeGreaterThan(0);
    const parsed = JSON.parse(stdoutChunks[0]!) as Record<string, unknown>;
    const reqField = parsed['req'] as Record<string, unknown> | undefined;
    const headers = reqField?.['headers'] as Record<string, unknown> | undefined;
    expect(headers?.['authorization']).toBe('[Redacted]');
  });
});

describe('createHttpLogger — health route ignore', () => {
  let stdoutChunks: string[];

  beforeEach(() => {
    stdoutChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string'
        ? chunk
        : chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips logging entirely for requests to /_health', () => {
    const middleware = createHttpLogger();

    const req = Object.assign(Object.create(null), {
      headers: {},
      method: 'GET',
      url: '/_health',
      socket: { remoteAddress: '127.0.0.1' },
    }) as unknown as IncomingMessage;

    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      setHeader: vi.fn(),
      getHeader: vi.fn(),
    }) as unknown as ServerResponse;

    const next = vi.fn();
    middleware(req, res, next);
    res.emit('finish');

    expect(stdoutChunks.length).toBe(0);
  });
});

describe('createHttpLogger — requestId from crypto.randomUUID()', () => {
  it('generates requestId via crypto.randomUUID() when x-request-id header is absent', () => {
    const middleware = createHttpLogger();

    const req = Object.assign(Object.create(null), {
      headers: {},
      method: 'GET',
      url: '/api/test',
      socket: { remoteAddress: '127.0.0.1' },
    }) as unknown as IncomingMessage;

    const res = Object.assign(Object.create(null), {
      statusCode: 200,
      setHeader: vi.fn(),
      getHeader: vi.fn(),
      on: vi.fn(),
    }) as unknown as ServerResponse;

    middleware(req, res, vi.fn());

    const reqWithId = req as IncomingMessage & { id?: string };
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(reqWithId.id).toMatch(uuidV4Regex);
  });
});

describe('createHttpLogger — requestId from x-request-id header', () => {
  it('uses the x-request-id header value as requestId when present', () => {
    const middleware = createHttpLogger();

    const req = Object.assign(Object.create(null), {
      headers: { 'x-request-id': 'my-trace-id-123' },
      method: 'GET',
      url: '/api/test',
      socket: { remoteAddress: '127.0.0.1' },
    }) as unknown as IncomingMessage;

    const res = Object.assign(Object.create(null), {
      statusCode: 200,
      setHeader: vi.fn(),
      getHeader: vi.fn(),
      on: vi.fn(),
    }) as unknown as ServerResponse;

    middleware(req, res, vi.fn());

    const reqWithId = req as IncomingMessage & { id?: string };
    expect(reqWithId.id).toBe('my-trace-id-123');
  });
});

describe('createLogger — level option suppression', () => {
  let stdoutChunks: string[];

  beforeEach(() => {
    stdoutChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string'
        ? chunk
        : chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not emit log lines below the configured level', () => {
    const logger = createLogger('svc', { level: 'warn' });

    logger.trace({}, 'trace msg');
    logger.debug({}, 'debug msg');
    logger.info({}, 'info msg');

    expect(stdoutChunks.length).toBe(0);
  });

  it('emits log lines at or above the configured level', () => {
    const logger = createLogger('svc', { level: 'warn' });

    logger.warn({}, 'warn msg');

    expect(stdoutChunks.length).toBeGreaterThan(0);
    const parsed = JSON.parse(stdoutChunks[0]!) as Record<string, unknown>;
    expect(parsed['msg']).toBe('warn msg');
  });
});

describe('createLogger — LOG_LEVEL env var', () => {
  let stdoutChunks: string[];
  const originalLogLevel = process.env['LOG_LEVEL'];

  beforeEach(() => {
    stdoutChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string'
        ? chunk
        : chunk.toString());
      return true;
    });
  });

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
    process.env['LOG_LEVEL'] = 'warn';
    vi.resetModules();

    const { createLogger: createLoggerFresh } = await import('../node.js');
    const logger = createLoggerFresh('svc');

    logger.info({}, 'this should be suppressed');
    expect(stdoutChunks.length).toBe(0);

    logger.warn({}, 'this should appear');
    expect(stdoutChunks.length).toBeGreaterThan(0);
    const parsed = JSON.parse(stdoutChunks[0]!) as Record<string, unknown>;
    expect(parsed['msg']).toBe('this should appear');
  });
});
