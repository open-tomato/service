import { describe, expect, it } from 'vitest';

import { createServiceLogger } from './logger.js';

describe('createServiceLogger', () => {
  it('returns a logger with standard log methods', () => {
    const logger = createServiceLogger('payments-api');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('returns distinct logger instances for different serviceIds', () => {
    const loggerA = createServiceLogger('service-a');
    const loggerB = createServiceLogger('service-b');
    expect(loggerA).not.toBe(loggerB);
  });

  it('returns a logger that supports child loggers', () => {
    const logger = createServiceLogger('order-service');
    const child = logger.child({ requestId: 'abc' });
    expect(typeof child.info).toBe('function');
  });

  it('returned logger has a configurable level', () => {
    const logger = createServiceLogger('auth-service');
    expect(typeof logger.level).toBe('string');
  });
});
