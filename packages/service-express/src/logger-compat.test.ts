import type { Logger } from '@open-tomato/service';

import { createLogger } from '@open-tomato/service-logger';
import pino from 'pino';
import { describe, expectTypeOf, it } from 'vitest';

// The core owns the `Logger` type now, and the adapter hands the core's
// consumers a logger from service-logger, so both pino and service-logger
// must keep fitting it. `check-types` fails here if either drifts.
describe('the core Logger type', () => {
  it('fits a logger from service-logger', () => {
    expectTypeOf(createLogger('orders')).toExtend<Logger>();
  });

  it('fits a plain pino logger', () => {
    expectTypeOf(pino()).toExtend<Logger>();
  });
});
