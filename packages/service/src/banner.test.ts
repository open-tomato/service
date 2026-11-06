import type { Logger } from './logger.js';

import { describe, expect, it } from 'vitest';

import { logStarted, STARTED_MESSAGE } from './banner.js';

interface Call { readonly level: string; readonly args: readonly unknown[] }

/** A logger that records every call it gets. */
function recordingLogger() {
  const calls: Call[] = [];
  const at = (level: string) => (...args: unknown[]): void => {
    calls.push({ level, args });
  };
  const logger: Logger = {
    trace: at('trace'),
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    fatal: at('fatal'),
    child: () => logger,
  };
  return { calls, logger };
}

const base = {
  service: 'users',
  version: '1.2.3',
  transport: 'http',
  url: 'http://localhost:3000',
  features: { auth: true, workers: 2 },
};

describe('logStarted', () => {
  it('leaves fallbackPort out when it is not set', () => {
    const { calls, logger } = recordingLogger();

    logStarted(logger, base);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[0]).not.toHaveProperty('fallbackPort');
  });

  it('keeps the named fields over extra fields of the same name', () => {
    const { calls, logger } = recordingLogger();

    logStarted(logger, { ...base, extra: { service: 'other', healthUrl: 'http://localhost:3001' } });

    expect(calls[0]?.args[0]).toStrictEqual({ ...base, healthUrl: 'http://localhost:3001' });
  });

  it('writes one info record with message started and the banner fields', () => {
    const { calls, logger } = recordingLogger();

    logStarted(logger, base);

    expect(STARTED_MESSAGE).toBe('started');
    expect(calls).toStrictEqual([{ level: 'info', args: [base, 'started'] }]);
  });

  it('adds fallbackPort when the service fell back', () => {
    const { calls, logger } = recordingLogger();

    logStarted(logger, { ...base, fallbackPort: 3000, url: 'http://localhost:3001' });

    expect(calls[0]?.args[0]).toStrictEqual({ ...base, url: 'http://localhost:3001', fallbackPort: 3000 });
  });
});
