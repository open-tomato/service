import { logStarted, scoped } from '@open-tomato/service';
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
});

describe('terminal', () => {
  const originalNoColor = process.env['NO_COLOR'];

  beforeEach(() => {
    setNoColor('1');
  });

  afterEach(() => {
    setNoColor(originalNoColor);
  });

  it('draws the slots in order with the short trace id, the scope and the fields', () => {
    const input = line({
      pid: 7,
      hostname: 'localhost',
      service: 'orders',
      traceId: '3f2a9c1e5d6b4a',
      scope: 'Users:create',
      msg: 'user created',
      userId: 42,
    });

    expect(terminal(input))
      .toBe(`${CLOCK} INFO  orders  3f2a9c1e  Users:create  user created  userId=42\n`);
  });

  it('drops the trace id and scope slots when the record has neither', () => {
    const input = line({ service: 'orders', msg: 'user created', userId: 42 });

    expect(terminal(input)).toBe(`${CLOCK} INFO  orders  user created  userId=42\n`);
  });

  it('reads the breadcrumbs a scoped pino child writes', () => {
    const lines: string[] = [];
    const logger = capturingPino(lines);

    scoped(logger.child({ traceId: 'abcdef0123456789' }), 'Users', 'create').warn('slow');

    expect(lines).toHaveLength(1);
    expect(terminal(lines[0] ?? '')).toMatch(/^\d\d:\d\d:\d\d\.\d{3} WARN {2}orders {2}abcdef01 {2}Users:create {2}slow\n$/);
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
    const input = line({ service: 'orders', traceId: '3f2a9c1e5d', scope: 'Users:create', msg: 'm' });

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

  it('draws a started message with no url as an ordinary line', () => {
    const input = line({ service: 'worker', msg: 'started', jobs: 3 });

    expect(terminal(input)).toBe(`${CLOCK} INFO  worker  started  jobs=3\n`);
  });

  it('passes a line that is not a JSON object through', () => {
    expect(terminal('not json')).toBe('not json\n');
    expect(terminal('[1,2]\n')).toBe('[1,2]\n');
  });
});
