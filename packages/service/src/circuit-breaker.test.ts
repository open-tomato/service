import { describe, expect, it, vi } from 'vitest';

import { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';

describe('CircuitBreaker', () => {
  describe('positive cases', () => {
    it('starts in closed state with status "running"', () => {
      const breaker = new CircuitBreaker();
      expect(breaker.state).toBe('closed');
      expect(breaker.status).toBe('running');
    });

    it('returns the resolved value when the call succeeds', async () => {
      const breaker = new CircuitBreaker();
      const result = await breaker.call(async () => 42);
      expect(result).toBe(42);
    });

    it('remains closed after failures below the threshold', async () => {
      const breaker = new CircuitBreaker({ threshold: 3 });
      const failing = vi.fn(async () => {
        throw new Error('transient');
      });

      for (let i = 0; i < 2; i++) {
        await expect(breaker.call(failing)).rejects.toThrow('transient');
      }

      expect(breaker.state).toBe('closed');
      expect(breaker.status).toBe('running');
    });

    it('transitions from open to half-open after timeout elapses', async () => {
      const breaker = new CircuitBreaker({ threshold: 1, timeout: 0 });
      await expect(breaker.call(async () => { throw new Error('fail'); })).rejects.toThrow();

      // timeout: 0 means it should immediately transition when checked
      expect(breaker.state).toBe('half-open');
      expect(breaker.status).toBe('degraded');
    });

    it('closes the circuit after a successful half-open probe', async () => {
      const breaker = new CircuitBreaker({ threshold: 1, timeout: 0 });
      await expect(breaker.call(async () => { throw new Error('fail'); })).rejects.toThrow();

      // Force half-open by checking state (timeout: 0)
      expect(breaker.state).toBe('half-open');

      // Probe succeeds — circuit should close
      await breaker.call(async () => 'ok');
      expect(breaker.state).toBe('closed');
      expect(breaker.status).toBe('running');
    });

    it('resets failure count after a successful call', async () => {
      const breaker = new CircuitBreaker({ threshold: 3 });

      await expect(breaker.call(async () => { throw new Error(); })).rejects.toThrow();
      await expect(breaker.call(async () => { throw new Error(); })).rejects.toThrow();
      await breaker.call(async () => 'ok'); // resets failures

      // Two more failures should not open the circuit (counter was reset)
      await expect(breaker.call(async () => { throw new Error(); })).rejects.toThrow();
      await expect(breaker.call(async () => { throw new Error(); })).rejects.toThrow();
      expect(breaker.state).toBe('closed');
    });
  });

  describe('negative cases', () => {
    it('opens after reaching the failure threshold', async () => {
      const breaker = new CircuitBreaker({ threshold: 3 });
      const failing = vi.fn(async () => {
        throw new Error('persistent');
      });

      for (let i = 0; i < 3; i++) {
        await expect(breaker.call(failing)).rejects.toThrow('persistent');
      }

      expect(breaker.state).toBe('open');
      expect(breaker.status).toBe('error');
    });

    it('throws CircuitOpenError when the circuit is open', async () => {
      const breaker = new CircuitBreaker({ threshold: 1 });
      await expect(breaker.call(async () => { throw new Error('fail'); })).rejects.toThrow();

      expect(breaker.state).toBe('open');
      await expect(breaker.call(async () => 'should not reach')).rejects.toBeInstanceOf(CircuitOpenError);
    });

    it('applies safe defaults: opens after 5 consecutive failures', async () => {
      const breaker = new CircuitBreaker(); // default threshold: 5
      const failing = vi.fn(async () => {
        throw new Error('persistent');
      });

      for (let i = 0; i < 4; i++) {
        await expect(breaker.call(failing)).rejects.toThrow();
        expect(breaker.state).toBe('closed');
      }

      await expect(breaker.call(failing)).rejects.toThrow();
      expect(breaker.state).toBe('open');
    });

    it('re-opens the circuit when a half-open probe fails', async () => {
      // Use a large timeout so state getter doesn't immediately re-transition
      const breaker = new CircuitBreaker({ threshold: 1, timeout: 60_000 });
      await expect(breaker.call(async () => { throw new Error('fail'); })).rejects.toThrow();

      expect(breaker.state).toBe('open');

      // Manually force half-open by backdating the openedAt timestamp
      // by accessing private state via casting
      (breaker as unknown as Record<string, unknown>)['_state'] = 'half-open';
      (breaker as unknown as Record<string, unknown>)['_openedAt'] = null;

      expect(breaker.state).toBe('half-open');

      // probe fails — should go back to open
      await expect(breaker.call(async () => { throw new Error('probe fail'); })).rejects.toThrow('probe fail');
      expect(breaker.state).toBe('open');
      expect(breaker.status).toBe('error');
    });

    it('CircuitOpenError has the correct name and message', () => {
      const err = new CircuitOpenError();
      expect(err.name).toBe('CircuitOpenError');
      expect(err.message).toBe('Circuit is open — call rejected');
      expect(err).toBeInstanceOf(Error);
    });
  });
});
