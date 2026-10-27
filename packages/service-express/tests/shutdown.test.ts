import { createDependency } from '@open-tomato/service';
import { describe, expect, it } from 'vitest';

import { createService } from '../src/create-service.js';

// Tests run in test mode — no process.exit, ephemeral port
process.env.NODE_ENV = 'test';

// ---------------------------------------------------------------------------
// Shutdown integration
// ---------------------------------------------------------------------------

describe('shutdown — stop() behaviour', () => {
  it('stop() calls dep.stop() in reverse order relative to the dependencies array', async () => {
    const stopOrder: string[] = [];

    const dep1 = createDependency({
      name: 'dep-1',
      async onStop() {
        stopOrder.push('dep-1');
      },
    });
    const dep2 = createDependency({
      name: 'dep-2',
      async onStop() {
        stopOrder.push('dep-2');
      },
    });

    const handle = await createService({
      serviceId: 'test-svc',
      dependencies: [dep1, dep2],
      register() {},
    });

    await handle.stop();

    // dep2 was registered second → stops first (reverse order)
    expect(stopOrder).toEqual(['dep-2', 'dep-1']);
  });

  it('stop() completes even if one dep.stop() throws (error is logged, not re-thrown)', async () => {
    const stopOrder: string[] = [];

    const dep1 = createDependency({
      name: 'dep-1',
      async onStop() {
        stopOrder.push('dep-1');
        throw new Error('dep-1 stop failed');
      },
    });
    const dep2 = createDependency({
      name: 'dep-2',
      async onStop() {
        stopOrder.push('dep-2');
      },
    });

    const handle = await createService({
      serviceId: 'test-svc',
      dependencies: [dep1, dep2],
      register() {},
    });

    // stop() must not throw even though dep-1.stop() rejects
    await expect(handle.stop()).resolves.toBeUndefined();

    // Both deps attempted a stop (dep2 first due to reverse order, then dep1)
    expect(stopOrder).toContain('dep-1');
    expect(stopOrder).toContain('dep-2');
  });
});
