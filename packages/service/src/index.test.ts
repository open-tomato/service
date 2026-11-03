import type { CircuitState } from './index.js';

import { describe, expect, expectTypeOf, it } from 'vitest';

import { CircuitBreaker } from './circuit-breaker.js';
import { withRetry } from './retry.js';

import * as core from './index.js';

describe('public exports', () => {
  it('exports withRetry', () => {
    expect(core.withRetry).toBe(withRetry);
  });

  it('exports CircuitBreaker', () => {
    expect(core.CircuitBreaker).toBe(CircuitBreaker);
  });

  it('exports the CircuitState type', () => {
    expectTypeOf<CircuitState>().toEqualTypeOf<'closed' | 'open' | 'half-open'>();
  });
});
