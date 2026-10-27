import { describe, expect, it, vi } from 'vitest';

import { withRetry } from './retry.js';

describe('withRetry', () => {
  describe('positive cases', () => {
    it('resolves immediately when the first call succeeds', async () => {
      const fn = vi.fn(async () => 42);
      const result = await withRetry(fn);
      expect(result).toBe(42);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('resolves on a subsequent attempt after transient failures', async () => {
      let calls = 0;
      const fn = vi.fn(async () => {
        calls++;
        if (calls < 3) throw new Error('transient');
        return 'ok';
      });

      const result = await withRetry(fn, { attempts: 3, backoff: 'linear' });
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('applies safe defaults (3 attempts) when no config is provided', async () => {
      let calls = 0;
      const fn = vi.fn(async () => {
        calls++;
        if (calls < 2) throw new Error('transient');
        return 'default-config';
      });

      const result = await withRetry(fn);
      expect(result).toBe('default-config');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('negative cases', () => {
    it('throws the last error after all attempts are exhausted', async () => {
      const sentinel = new Error('persistent failure');
      const fn = vi.fn(async () => {
        throw sentinel;
      });

      await expect(withRetry(fn, { attempts: 3, backoff: 'linear' })).rejects.toBe(sentinel);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('propagates the last error, not the first, when each attempt throws differently', async () => {
      let calls = 0;
      const errors = [new Error('first'), new Error('second'), new Error('last')];
      const fn = vi.fn(async () => {
        throw errors[calls++];
      });

      await expect(withRetry(fn, { attempts: 3, backoff: 'linear' })).rejects.toBe(errors[2]);
    });

    it('respects a single attempt and throws immediately on failure', async () => {
      const err = new Error('one-shot');
      const fn = vi.fn(async () => {
        throw err;
      });

      await expect(withRetry(fn, { attempts: 1 })).rejects.toBe(err);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
