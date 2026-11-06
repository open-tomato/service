import type { Logger } from '../node.js';
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
    const logger = createLogger('x', { format: 'json' });
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
    const parent = createLogger('my-service', { format: 'json' });
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
    const logger = createLogger('test-service', { format: 'json' });
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

/** A version-4 UUID, the shape `randomUUID()` returns. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A request with the given headers, for the middleware under test. */
function fakeRequest(headers: Record<string, string>, url = '/api/test'): IncomingMessage {
  return Object.assign(Object.create(null), {
    headers,
    method: 'GET',
    url,
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as IncomingMessage;
}

/** A response that can emit `finish`, for the completion line. */
function fakeResponse(): ServerResponse {
  return Object.assign(new EventEmitter(), {
    statusCode: 200,
    setHeader: vi.fn(),
    getHeader: vi.fn(),
  }) as unknown as ServerResponse;
}

/** The id the middleware gave a request with the given headers. */
function idFor(headers: Record<string, string>): string | undefined {
  const req = fakeRequest(headers);
  createHttpLogger()(req, fakeResponse(), vi.fn());
  return (req as IncomingMessage & { id?: string }).id;
}

describe('createHttpLogger — the request id', () => {
  it('generates a UUID when the x-request-id header is absent', () => {
    expect(idFor({})).toMatch(UUID_V4);
  });

  it('keeps an x-request-id that isTraceId accepts', () => {
    expect(idFor({ 'x-request-id': 'my-trace-id-123' })).toBe('my-trace-id-123');
  });

  it('keeps an x-request-id of 64 characters, the longest accepted', () => {
    const longest = 'a'.repeat(64);
    expect(idFor({ 'x-request-id': longest })).toBe(longest);
  });

  it('replaces an x-request-id with a space by a UUID', () => {
    expect(idFor({ 'x-request-id': 'has space' })).toMatch(UUID_V4);
  });

  it('replaces an x-request-id of 65 characters by a UUID', () => {
    expect(idFor({ 'x-request-id': 'a'.repeat(65) })).toMatch(UUID_V4);
  });

  it('replaces an empty x-request-id by a UUID', () => {
    expect(idFor({ 'x-request-id': '' })).toMatch(UUID_V4);
  });
});

describe('createHttpLogger — the trace id on the lines it writes', () => {
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

  /** Runs one request through the middleware, logging a crumb through `req.log`. */
  function runRequest(): { crumb: string; completion: string } {
    const middleware = createHttpLogger({ logger: createLogger('svc', { format: 'json' }) });
    const req = fakeRequest({ 'x-request-id': 'trace-abc' });
    const res = fakeResponse();
    middleware(req, res, vi.fn());
    (req as IncomingMessage & { log: Logger }).log.info({}, 'crumb');
    res.emit('finish');
    expect(stdoutChunks).toHaveLength(2);
    return { crumb: stdoutChunks[0]!, completion: stdoutChunks[1]! };
  }

  it('gives a crumb through req.log a traceId and no req or requestId', () => {
    const crumb = JSON.parse(runRequest().crumb) as Record<string, unknown>;

    expect(crumb['msg']).toBe('crumb');
    expect(crumb['traceId']).toBe('trace-abc');
    expect(crumb).not.toHaveProperty('req');
    expect(crumb).not.toHaveProperty('requestId');
  });

  it('writes the "traceId" key once on the completion line, beside req, res and responseTime', () => {
    const { completion } = runRequest();
    const record = JSON.parse(completion) as Record<string, unknown>;

    expect(completion.split('"traceId"')).toHaveLength(2);
    expect(record['traceId']).toBe('trace-abc');
    expect(record).toHaveProperty('req');
    expect(record).toHaveProperty('res');
    expect(record).toHaveProperty('responseTime');
    expect(record).not.toHaveProperty('requestId');
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
    const logger = createLogger('svc', { level: 'warn', format: 'json' });

    logger.trace({}, 'trace msg');
    logger.debug({}, 'debug msg');
    logger.info({}, 'info msg');

    expect(stdoutChunks.length).toBe(0);
  });

  it('emits log lines at or above the configured level', () => {
    const logger = createLogger('svc', { level: 'warn', format: 'json' });

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
    const logger = createLoggerFresh('svc', { format: 'json' });

    logger.info({}, 'this should be suppressed');
    expect(stdoutChunks.length).toBe(0);

    logger.warn({}, 'this should appear');
    expect(stdoutChunks.length).toBeGreaterThan(0);
    const parsed = JSON.parse(stdoutChunks[0]!) as Record<string, unknown>;
    expect(parsed['msg']).toBe('this should appear');
  });
});
