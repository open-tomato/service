import { inDomain, logStarted, scoped } from '@open-tomato/service';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { json, terminal } from './decorators.js';

/** A local time whose clock reads 12:04:31.250 in any time zone. */
const TIME = new Date(2026, 0, 2, 12, 4, 31, 250).getTime();
const CLOCK = '12:04:31.250';

const ESCAPE = '\u001B[';

/** Sets `NO_COLOR`, or removes it when `value` is `undefined`. */
function setNoColor(value: string | undefined): void {
  if (value === undefined) delete process.env['NO_COLOR'];
  else process.env['NO_COLOR'] = value;
}

function line(record: Record<string, unknown>): string {
  return `${JSON.stringify({ level: 30, time: TIME, ...record })}\n`;
}

/** A pino logger set up as `createLogger` will be, writing its lines to `lines`. */
function capturingPino(lines: string[]): pino.Logger {
  return pino(
    { base: { service: 'orders' }, serializers: { err: pino.stdSerializers.errWithCause } },
    { write: (chunk: string) => { lines.push(chunk); } },
  );
}

describe('json', () => {
  it('returns pino\'s line unchanged', () => {
    const input = line({ service: 'orders', traceId: '3f2a9c1e5d', msg: 'user created' });

    expect(json(input)).toBe(input);
  });

  it('returns a completion record unchanged, req and res included', () => {
    const input = line({ req: { method: 'POST', url: '/users' }, res: { statusCode: 201 }, responseTime: 3, msg: 'request completed' });

    expect(json(input)).toBe(input);
  });
});

describe('terminal', () => {
  const originalNoColor = process.env['NO_COLOR'];

  beforeEach(() => {
    setNoColor('1');
  });

  afterEach(() => {
    setNoColor(originalNoColor);
  });

  it('draws the slots in order with the short trace id, the signature and the fields', () => {
    const input = line({
      pid: 7,
      hostname: 'localhost',
      service: 'orders',
      traceId: '3f2a9c1e5d6b4a',
      domain: 'Users',
      scope: 'create',
      msg: 'user created',
      userId: 42,
    });

    expect(terminal(input))
      .toBe(`${CLOCK} INFO  orders  3f2a9c1e  Users:create  user created  userId=42\n`);
  });

  it('drops the trace id and signature slots when the record has neither', () => {
    const input = line({ service: 'orders', msg: 'user created', userId: 42 });

    expect(terminal(input)).toBe(`${CLOCK} INFO  orders  user created  userId=42\n`);
  });

  it('reads the breadcrumbs a domain and scope pino child writes', () => {
    const lines: string[] = [];
    const logger = capturingPino(lines);

    scoped(inDomain(logger.child({ traceId: 'abcdef0123456789' }), 'Users'), 'create').warn('slow');

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ domain: 'Users', scope: 'create' });
    expect(terminal(lines[0] ?? '')).toMatch(/^\d\d:\d\d:\d\d\.\d{3} WARN {2}orders {2}abcdef01 {2}Users:create {2}slow\n$/);
  });

  it('joins domain, scope and step into one signature slot', () => {
    const input = line({ service: 'orders', domain: 'Users', scope: 'create', step: 'insert', msg: 'user created' });

    expect(terminal(input)).toBe(`${CLOCK} INFO  orders  Users:create:insert  user created\n`);
  });

  it('joins domain and scope with no step and no empty separator', () => {
    const input = line({ service: 'orders', domain: 'Users', scope: 'create', msg: 'user created' });

    expect(terminal(input)).toBe(`${CLOCK} INFO  orders  Users:create  user created\n`);
  });

  it('draws the domain alone as the signature', () => {
    const input = line({ service: 'orders', domain: 'Users', msg: 'user created' });

    expect(terminal(input)).toBe(`${CLOCK} INFO  orders  Users  user created\n`);
  });

  it('draws no signature slot when the record has no domain, scope or step', () => {
    const input = line({ service: 'orders', msg: 'user created' });

    expect(terminal(input)).toBe(`${CLOCK} INFO  orders  user created\n`);
  });

  it('repeats none of domain, scope and step as a key=value field', () => {
    const drawn = terminal(line({ domain: 'Users', scope: 'create', step: 'insert', msg: 'm', userId: 42 }));

    expect(drawn).toBe(`${CLOCK} INFO  Users:create:insert  m  userId=42\n`);
    expect(drawn).not.toMatch(/\b(domain|scope|step)=/);
  });

  it('quotes a string field with spaces and writes an object field as JSON', () => {
    const input = line({ msg: 'm', note: 'two words', meta: { a: 1 }, ok: true });

    expect(terminal(input)).toBe(`${CLOCK} INFO  m  note="two words"  meta={"a":1}  ok=true\n`);
  });

  it('draws the serialised error and each link of its cause chain as one line', () => {
    const lines: string[] = [];
    const logger = capturingPino(lines);
    const err = new Error('order failed', { cause: new TypeError('bad total', { cause: new RangeError('negative') }) });

    logger.error({ err, orderId: 'o-1' }, 'could not create order');
    const drawn = terminal(lines[0] ?? '').split('\n');

    expect(drawn[0]).toMatch(/ ERROR orders {2}could not create order {2}orderId=o-1$/);
    expect(drawn.slice(1)).toEqual([
      '  Error: order failed',
      '  TypeError: bad total',
      '  RangeError: negative',
      '',
    ]);
  });

  it('writes no colour under NO_COLOR, and colour when NO_COLOR is unset or empty', () => {
    const input = line({ service: 'orders', traceId: '3f2a9c1e5d', domain: 'Users', scope: 'create', msg: 'm' });

    expect(terminal(input)).not.toContain(ESCAPE);

    setNoColor('');
    expect(terminal(input)).toContain(ESCAPE);

    setNoColor(undefined);
    expect(terminal(input)).toContain(ESCAPE);
  });

  it('draws a started record as a short block', () => {
    const lines: string[] = [];

    logStarted(capturingPino(lines), {
      service: 'orders',
      version: '1.2.3',
      transport: 'http',
      url: 'http://localhost:3001',
      features: { auth: true, cache: 'redis' },
      fallbackPort: 3000,
      extra: { healthUrl: 'http://localhost:3002' },
    });
    const drawn = terminal(lines[0] ?? '').split('\n');

    expect(drawn[0]).toMatch(/^\d\d:\d\d:\d\d\.\d{3} INFO {2}orders {2}started$/);
    expect(drawn.slice(1)).toEqual([
      '  version       1.2.3',
      '  transport     http',
      '  url           http://localhost:3001',
      '  features      auth=true  cache=redis',
      '  fallbackPort  3000 (taken)',
      '  healthUrl     http://localhost:3002',
      '',
    ]);
  });

  it('says none for a banner with no features', () => {
    const input = line({ service: 'orders', msg: 'started', version: '1.0.0', transport: 'mcp', url: 'http://localhost:8080', features: {} });

    expect(terminal(input)).toBe([
      `${CLOCK} INFO  orders  started`,
      '  version    1.0.0',
      '  transport  mcp',
      '  url        http://localhost:8080',
      '  features   none',
      '',
    ].join('\n'));
  });

  it('draws a stdio started record with no url as a banner with no url row', () => {
    const lines: string[] = [];

    logStarted(capturingPino(lines), {
      service: 'orders',
      version: '1.2.3',
      transport: 'stdio',
      features: {},
    });
    const drawn = terminal(lines[0] ?? '').split('\n');

    expect(drawn[0]).toMatch(/^\d\d:\d\d:\d\d\.\d{3} INFO {2}orders {2}started$/);
    expect(drawn.slice(1)).toEqual([
      '  version    1.2.3',
      '  transport  stdio',
      '  features   none',
      '',
    ]);
  });

  it('draws a started message with no transport as an ordinary line', () => {
    const input = line({ service: 'worker', msg: 'started', url: 'http://localhost:3001', jobs: 3 });

    expect(terminal(input)).toBe(`${CLOCK} INFO  worker  started  url=http://localhost:3001  jobs=3\n`);
  });

  it('ends a completion record in the request tail with no req= or res= field', () => {
    const input = line({
      service: 'orders',
      traceId: '3f2a9c1e5d6b4a',
      req: { id: '3f2a9c1e5d6b4a', method: 'POST', url: '/users', headers: { host: 'localhost' } },
      res: { statusCode: 201, headers: {} },
      responseTime: 3,
      msg: 'request completed',
      userId: 42,
    });

    const drawn = terminal(input);

    expect(drawn).toBe(`${CLOCK} INFO  orders  3f2a9c1e  request completed  userId=42  POST /users → 201 3ms\n`);
    expect(drawn).not.toMatch(/\b(req|res|responseTime)=/);
  });

  it('ends a record with req and no res in the method and url', () => {
    const input = line({ service: 'orders', req: { method: 'POST', url: '/users' }, msg: 'request received' });

    expect(terminal(input)).toBe(`${CLOCK} INFO  orders  request received  POST /users\n`);
  });

  it('draws no req= for a crumb record that carries only the trace id', () => {
    const input = line({ service: 'orders', traceId: '3f2a9c1e5d6b4a', domain: 'Users', scope: 'create', step: 'validate', msg: 'validated' });

    const drawn = terminal(input);

    expect(drawn).toBe(`${CLOCK} INFO  orders  3f2a9c1e  Users:create:validate  validated\n`);
    expect(drawn).not.toContain('req=');
  });

  it('keeps req as a field when it has no method', () => {
    const input = line({ msg: 'm', req: { url: '/users' }, res: { statusCode: 201 }, responseTime: 3 });

    expect(terminal(input))
      .toBe(`${CLOCK} INFO  m  req={"url":"/users"}  res={"statusCode":201}  responseTime=3\n`);
  });

  it('passes a line that is not a JSON object through', () => {
    expect(terminal('not json')).toBe('not json\n');
    expect(terminal('[1,2]\n')).toBe('[1,2]\n');
  });
});
