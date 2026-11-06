import type { LogSink } from './logger.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createConsoleLogger, SCOPE_FIELD, scoped, TRACE_ID_FIELD } from './logger.js';

/** A sink that records every call, one array per console method. */
function recordingSink() {
  const calls: Record<keyof LogSink, unknown[][]> = { debug: [], info: [], warn: [], error: [] };
  const sink: LogSink = {
    debug: (...data) => { calls.debug.push(data); },
    info: (...data) => { calls.info.push(data); },
    warn: (...data) => { calls.warn.push(data); },
    error: (...data) => { calls.error.push(data); },
  };
  return { sink, calls };
}

describe('createConsoleLogger', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('writes the message first and the fields second, with the service and level', () => {
    const { sink, calls } = recordingSink();
    const logger = createConsoleLogger('orders', { sink });

    logger.info({ orderId: 'o-1' }, 'order created');

    expect(calls.info).toEqual([['order created', { level: 'info', service: 'orders', orderId: 'o-1' }]]);
  });

  it('writes a message on its own with the service and level as fields', () => {
    const { sink, calls } = recordingSink();
    createConsoleLogger('orders', { sink }).warn('slow upstream');

    expect(calls.warn).toEqual([['slow upstream', { level: 'warn', service: 'orders' }]]);
  });

  it('writes only the fields when no message is given', () => {
    const { sink, calls } = recordingSink();
    createConsoleLogger('orders', { sink }).info({ count: 3 });

    expect(calls.info).toEqual([[{ level: 'info', service: 'orders', count: 3 }]]);
  });

  it('puts an Error passed as the object under err, so its message and stack survive', () => {
    const { sink, calls } = recordingSink();
    const failure = new Error('connection refused');

    createConsoleLogger('orders', { sink }).error(failure, 'payment call failed');

    expect(calls.error).toEqual([['payment call failed', { level: 'error', service: 'orders', err: failure }]]);
  });

  it('drops records below the level, and maps trace and fatal onto debug and error', () => {
    const { sink, calls } = recordingSink();
    const logger = createConsoleLogger('orders', { sink, level: 'trace' });
    const quiet = createConsoleLogger('orders', { sink, level: 'warn' });

    logger.trace('tracing');
    logger.fatal('going down');
    quiet.info('not written');
    quiet.debug('not written');

    expect(calls.debug).toEqual([['tracing', { level: 'trace', service: 'orders' }]]);
    expect(calls.error).toEqual([['going down', { level: 'fatal', service: 'orders' }]]);
    expect(calls.info).toEqual([]);
  });

  it('writes nothing at the silent level', () => {
    const { sink, calls } = recordingSink();
    const logger = createConsoleLogger('orders', { sink, level: 'silent' });

    logger.fatal('not written');
    logger.error('not written');

    expect(calls.error).toEqual([]);
  });

  it('returns a child with merged bindings and leaves the parent as it was', () => {
    const { sink, calls } = recordingSink();
    const parent = createConsoleLogger('orders', { sink, bindings: { region: 'eu' } });
    const child = parent.child({ requestId: 'r-9' });

    child.info('in the child');
    parent.info('in the parent');

    expect(calls.info).toEqual([
      ['in the child', { level: 'info', service: 'orders', region: 'eu', requestId: 'r-9' }],
      ['in the parent', { level: 'info', service: 'orders', region: 'eu' }],
    ]);
  });

  it('reads the level from LOG_LEVEL when the options give none', () => {
    vi.stubEnv('LOG_LEVEL', 'error');
    const { sink, calls } = recordingSink();
    const logger = createConsoleLogger('orders', { sink });

    logger.warn('not written');
    logger.error('written');

    expect(calls.warn).toEqual([]);
    expect(calls.error).toHaveLength(1);
  });

  it('falls back to info when LOG_LEVEL holds no known level', () => {
    vi.stubEnv('LOG_LEVEL', 'loud');
    const { sink, calls } = recordingSink();
    const logger = createConsoleLogger('orders', { sink });

    logger.debug('not written');
    logger.info('written');

    expect(calls.debug).toEqual([]);
    expect(calls.info).toHaveLength(1);
  });

  it('writes to the global console when no sink is given', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    createConsoleLogger('orders', { level: 'info' }).info('to the console');

    expect(info).toHaveBeenCalledWith('to the console', { level: 'info', service: 'orders' });
  });
});

describe('scoped', () => {
  it('does not add a scope to the logger it was given', () => {
    const { sink, calls } = recordingSink();
    const logger = createConsoleLogger('users', { sink });

    scoped(logger, 'Users', 'create');
    logger.info('plain');

    expect(calls.info).toEqual([['plain', { level: 'info', service: 'users' }]]);
  });

  it('writes records that carry scope as <Module>:<action>', () => {
    const { sink, calls } = recordingSink();

    scoped(createConsoleLogger('users', { sink }), 'Users', 'create').info('user created');

    expect(calls.info).toEqual([['user created', { level: 'info', service: 'users', scope: 'Users:create' }]]);
  });

  it('replaces the scope when a scoped logger is scoped again', () => {
    const { sink, calls } = recordingSink();
    const outer = scoped(createConsoleLogger('users', { sink }), 'Users', 'create');

    scoped(outer, 'Mailer', 'send').info('mail sent');

    expect(calls.info).toEqual([['mail sent', { level: 'info', service: 'users', scope: 'Mailer:send' }]]);
  });

  it('gives a child the traceId and scope and no fields of earlier calls', () => {
    const { sink, calls } = recordingSink();
    const logger = createConsoleLogger('users', { sink });
    logger.info({ userId: 'u-1' }, 'earlier');

    const child = scoped(logger.child({ [TRACE_ID_FIELD]: 't-1' }), 'Users', 'create');
    child.info('later');

    expect(calls.info[1]).toEqual(['later', { level: 'info', service: 'users', traceId: 't-1', scope: 'Users:create' }]);
    expect(calls.info[1]?.[1]).not.toHaveProperty('userId');
  });

  it('names the breadcrumb fields traceId and scope', () => {
    expect(TRACE_ID_FIELD).toBe('traceId');
    expect(SCOPE_FIELD).toBe('scope');
  });
});
