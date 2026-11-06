import type { CircuitState } from './index.js';

import { describe, expect, expectTypeOf, it } from 'vitest';

import { logStarted, STARTED_MESSAGE } from './banner.js';
import { CircuitBreaker } from './circuit-breaker.js';
import * as control from './control.js';
import * as errorClient from './error-client.js';
import * as errorResponse from './error-response.js';
import * as errors from './errors.js';
import { aggregateHealth, HEALTH_HTTP_STATUS } from './health.js';
import { DOMAIN_FIELD, inDomain, SCOPE_FIELD, scoped, STEP_FIELD, TRACE_ID_FIELD } from './logger.js';
import { pickPort, PORT_FALLBACK_RANGE, PortInUseError } from './ports.js';
import { withRetry } from './retry.js';
import { createRuntime } from './runtime.js';
import { BaseServiceConfigSchema, ControlConfigSchema } from './schema.js';

import * as core from './index.js';

describe('public exports', () => {
  it('exports withRetry', () => {
    expect(core.withRetry).toBe(withRetry);
  });

  it('exports CircuitBreaker', () => {
    expect(core.CircuitBreaker).toBe(CircuitBreaker);
  });

  it('exports aggregateHealth and HEALTH_HTTP_STATUS', () => {
    expect(core.aggregateHealth).toBe(aggregateHealth);
    expect(core.HEALTH_HTTP_STATUS).toBe(HEALTH_HTTP_STATUS);
  });

  it('exports createRuntime', () => {
    expect(core.createRuntime).toBe(createRuntime);
  });

  it('exports the control operations', () => {
    expect(core.controlStatus).toBe(control.controlStatus);
    expect(core.listDependencies).toBe(control.listDependencies);
    expect(core.pauseDependency).toBe(control.pauseDependency);
    expect(core.resumeDependency).toBe(control.resumeDependency);
    expect(core.restartDependency).toBe(control.restartDependency);
    expect(core.resetClient).toBe(control.resetClient);
    expect(core.verifyControlToken).toBe(control.verifyControlToken);
  });

  it('exports the base config schema and the control config schema', () => {
    expect(core.BaseServiceConfigSchema).toBe(BaseServiceConfigSchema);
    expect(core.ControlConfigSchema).toBe(ControlConfigSchema);
  });

  it('exports the error classes, the default formatter and the client helpers', () => {
    const coreExports: Record<string, unknown> = core;
    const classes = Object.entries(errors);
    for (const [name, value] of classes) {
      expect(coreExports[name]).toBe(value);
    }
    expect(classes).toHaveLength(8);
    expect(core.toErrorResponse).toBe(errorResponse.toErrorResponse);
    expect(core.zodToValidationError).toBe(errorResponse.zodToValidationError);
    expect(core.isErrorBody).toBe(errorClient.isErrorBody);
    expect(core.parseApiError).toBe(errorClient.parseApiError);
  });

  it('exports the port rule and its error', () => {
    expect(core.pickPort).toBe(pickPort);
    expect(core.PORT_FALLBACK_RANGE).toBe(PORT_FALLBACK_RANGE);
    expect(core.PortInUseError).toBe(PortInUseError);
  });

  it('exports the startup banner', () => {
    expect(core.logStarted).toBe(logStarted);
    expect(core.STARTED_MESSAGE).toBe(STARTED_MESSAGE);
  });

  it('exports the log breadcrumbs', () => {
    expect(core.scoped).toBe(scoped);
    expect(core.SCOPE_FIELD).toBe(SCOPE_FIELD);
    expect(core.TRACE_ID_FIELD).toBe(TRACE_ID_FIELD);
    expect(core.inDomain).toBe(inDomain);
    expect(core.DOMAIN_FIELD).toBe(DOMAIN_FIELD);
    expect(core.STEP_FIELD).toBe(STEP_FIELD);
  });

  it('exports the CircuitState type', () => {
    expectTypeOf<CircuitState>().toEqualTypeOf<'closed' | 'open' | 'half-open'>();
  });
});
