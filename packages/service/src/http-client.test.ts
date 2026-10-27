import { describe, expect, it, vi } from 'vitest';

import { CircuitOpenError } from './circuit-breaker.js';
import { createHttpClient } from './http-client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class FakeClient {
  fetchData = vi.fn(async (): Promise<string> => 'ok');
  getUser = vi.fn(async (id: number): Promise<{ id: number }> => ({ id }));
  readonly baseUrl = 'https://api.example.com';
}

// ---------------------------------------------------------------------------
// Positive tests
// ---------------------------------------------------------------------------

describe('createHttpClient — positive', () => {
  it('returns the underlying client resolved value through the Proxy', async () => {
    const sdk = new FakeClient();
    const client = createHttpClient(sdk);

    const result = await client.fetchData();

    expect(result).toBe('ok');
    expect(sdk.fetchData).toHaveBeenCalledTimes(1);
  });

  it('forwards arguments to the underlying method', async () => {
    const sdk = new FakeClient();
    const client = createHttpClient(sdk);

    const result = await client.getUser(42);

    expect(result).toEqual({ id: 42 });
    expect(sdk.getUser).toHaveBeenCalledWith(42);
  });

  it('exposes non-function properties from the underlying client', () => {
    const sdk = new FakeClient();
    const client = createHttpClient(sdk);

    expect(client.baseUrl).toBe('https://api.example.com');
  });

  it('starts with status "running" (circuit closed)', async () => {
    const sdk = new FakeClient();
    const client = createHttpClient(sdk);

    expect(client.status).toBe('running');
  });

  it('start() clears stopped state', async () => {
    const sdk = new FakeClient();
    const client = createHttpClient(sdk);

    await client.stop();
    expect(client.status).toBe('stopped');

    await client.start();
    expect(client.status).toBe('running');
  });

  it('stop() sets status to "stopped"', async () => {
    const sdk = new FakeClient();
    const client = createHttpClient(sdk);

    await client.stop();

    expect(client.status).toBe('stopped');
  });

  it('succeeds on a retry attempt after transient failure', async () => {
    let calls = 0;
    const sdk = {
      fetch: async () => {
        calls++;
        if (calls < 3) throw new Error('transient');
        return 'recovered';
      },
    };

    const client = createHttpClient(sdk, {
      retry: { attempts: 5, backoff: 'linear', jitter: false },
    });

    const result = await client.fetch();

    expect(result).toBe('recovered');
    expect(calls).toBe(3);
  });

  it('status transitions to "running" after a successful call resets the circuit', async () => {
    let failCount = 0;
    const sdk = {
      action: async () => {
        if (failCount < 4) {
          failCount++;
          throw new Error('fail');
        }
        return 'ok';
      },
    };

    // threshold 5 so 4 failures keep circuit closed
    const client = createHttpClient(sdk, {
      retry: { attempts: 1 },
      circuitBreaker: { threshold: 5, timeout: 30_000 },
    });

    // 4 failures — circuit still closed
    for (let i = 0; i < 4; i++) {
      await expect(client.action()).rejects.toThrow('fail');
    }

    expect(client.status).toBe('running');

    // success — resets failure counter
    const result = await client.action();
    expect(result).toBe('ok');
    expect(client.status).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// Negative tests
// ---------------------------------------------------------------------------

describe('createHttpClient — negative', () => {
  it('surfaces CircuitOpenError when the circuit is open (retry budget not involved)', async () => {
    const sdk = {
      action: vi.fn(async () => {
        throw new Error('upstream error');
      }),
    };

    // threshold 1 so the first failure opens the circuit
    const client = createHttpClient(sdk, {
      retry: { attempts: 1 },
      circuitBreaker: { threshold: 1, timeout: 60_000 },
    });

    // First call fails and opens the circuit
    await expect(client.action()).rejects.toThrow('upstream error');
    expect(client.status).toBe('error');

    // Second call should be rejected by the open circuit without calling the sdk
    const callsBefore = (sdk.action as ReturnType<typeof vi.fn>).mock.calls.length;
    await expect(client.action()).rejects.toBeInstanceOf(CircuitOpenError);
    expect((sdk.action as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
  });

  it('exhausts retry attempts and propagates the last error', async () => {
    const sdk = {
      fetch: vi.fn(async () => {
        throw new Error('persistent failure');
      }),
    };

    const client = createHttpClient(sdk, {
      retry: { attempts: 3, backoff: 'linear', jitter: false },
      circuitBreaker: { threshold: 10 }, // high threshold so circuit stays closed
    });

    await expect(client.fetch()).rejects.toThrow('persistent failure');
    expect((sdk.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
  });

  it('records a single circuit-breaker failure after all retries are exhausted', async () => {
    let failures = 0;
    const sdk = {
      action: async () => {
        failures++;
        throw new Error('fail');
      },
    };

    // threshold 2: circuit opens after 2 circuit-breaker failures
    // Each call does 3 retry attempts but counts as 1 circuit-breaker failure
    const client = createHttpClient(sdk, {
      retry: { attempts: 3, backoff: 'linear', jitter: false },
      circuitBreaker: { threshold: 2, timeout: 60_000 },
    });

    // First call: 3 retries, 1 circuit-breaker failure recorded — circuit still closed
    await expect(client.action()).rejects.toThrow('fail');
    expect(client.status).toBe('running');
    expect(failures).toBe(3);

    // Second call: 3 retries, 2nd circuit-breaker failure — circuit opens
    await expect(client.action()).rejects.toThrow('fail');
    expect(client.status).toBe('error');
    expect(failures).toBe(6);

    // Third call: circuit is open, no sdk call
    await expect(client.action()).rejects.toBeInstanceOf(CircuitOpenError);
    expect(failures).toBe(6); // unchanged
  });
});
