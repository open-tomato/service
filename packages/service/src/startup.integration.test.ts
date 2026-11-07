import { describe, expect, it } from 'vitest';

import { logStarted } from './banner.js';
import { toErrorResponse } from './error-response.js';
import { createConsoleLogger, inDomain, scoped } from './logger.js';
import { PortInUseError } from './ports.js';

describe('PortInUseError through toErrorResponse', () => {
  it('answers 500 PORT_IN_USE with a message naming the config key', () => {
    const response = toErrorResponse(new PortInUseError({ port: 3000, configKey: 'PORT' }));

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('PORT_IN_USE');
    expect(response.body.message).toContain('PORT');
    expect(response.body.message).toContain('3000');
  });
});

describe('started record from a scoped child', () => {
  it('reaches the sink carrying the domain, the scope and the banner fields', () => {
    const calls: unknown[][] = [];
    const sink = {
      debug: (...d: unknown[]) => void calls.push(d),
      info: (...d: unknown[]) => void calls.push(d),
      warn: (...d: unknown[]) => void calls.push(d),
      error: (...d: unknown[]) => void calls.push(d),
    };
    const logger = scoped(inDomain(createConsoleLogger('svc', { sink }), 'Server'), 'start');

    logStarted(logger, {
      version: '1.0.0', transport: 'http', url: 'http://localhost:3000', features: {},
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('started');
    expect(calls[0]![1]).toMatchObject({
      level: 'info', service: 'svc', domain: 'Server', scope: 'start', url: 'http://localhost:3000',
    });
  });
});
