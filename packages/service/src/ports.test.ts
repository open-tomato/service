import { describe, expect, it } from 'vitest';

import { AppError } from './errors.js';
import { pickPort, PORT_FALLBACK_RANGE, PortInUseError } from './ports.js';

/** A probe that answers from a fixed set of taken ports and records each call. */
function fakeIsFree(taken: readonly number[]) {
  const calls: number[] = [];
  const isFree = (port: number): Promise<boolean> => {
    calls.push(port);
    return Promise.resolve(!taken.includes(port));
  };
  return { calls, isFree };
}

describe('pickPort', () => {
  it('rejects a taken port under strict, naming the port and the config key', async () => {
    const probe = fakeIsFree([3000]);

    const result = pickPort({ port: 3000, strict: true, configKey: 'PORT', isFree: probe.isFree });

    await expect(result).rejects.toBeInstanceOf(PortInUseError);
    await expect(result).rejects.toThrow('port 3000 is taken; set PORT to a free port');
    expect(probe.calls).toStrictEqual([3000]);
  });

  it('rejects when every port of the range is taken, naming the range', async () => {
    const taken = Array.from({ length: PORT_FALLBACK_RANGE + 1 }, (_, i) => 3000 + i);
    const probe = fakeIsFree(taken);

    const result = pickPort({ port: 3000, strict: false, configKey: 'port', isFree: probe.isFree });

    await expect(result).rejects.toThrow('ports 3000-3020 are all taken; set port to a free port');
    expect(probe.calls).toStrictEqual(taken);
  });

  it('stops the range at the highest port', async () => {
    const probe = fakeIsFree([65_534, 65_535]);

    const result = pickPort({ port: 65_534, strict: false, configKey: 'port', isFree: probe.isFree });

    await expect(result).rejects.toMatchObject({ range: { from: 65_534, to: 65_535 } });
    expect(probe.calls).toStrictEqual([65_534, 65_535]);
  });

  it.each([-1, 65_536, 3000.5, Number.NaN])('rejects the port %s before probing', async (port) => {
    const probe = fakeIsFree([]);

    await expect(pickPort({ port, strict: false, configKey: 'port', isFree: probe.isFree }))
      .rejects.toBeInstanceOf(RangeError);
    expect(probe.calls).toStrictEqual([]);
  });

  it.each([0, -1, 1.5])('rejects the range %s', async (range) => {
    const probe = fakeIsFree([]);

    await expect(pickPort({ port: 3000, strict: false, configKey: 'port', isFree: probe.isFree, range }))
      .rejects.toBeInstanceOf(RangeError);
  });

  it('passes on a probe that fails', async () => {
    const boom = new Error('probe failed');

    const result = pickPort({ port: 3000, strict: false, configKey: 'port', isFree: () => Promise.reject(boom) });

    await expect(result).rejects.toBe(boom);
  });

  it('takes a free port, under strict or not', async () => {
    for (const strict of [true, false]) {
      const probe = fakeIsFree([]);

      const picked = await pickPort({ port: 3000, strict, configKey: 'port', isFree: probe.isFree });

      expect(picked).toStrictEqual({ port: 3000, requested: 3000, fellBack: false });
      expect(probe.calls).toStrictEqual([3000]);
    }
  });

  it('falls back to the first free port after a taken one', async () => {
    const probe = fakeIsFree([3000, 3001]);

    const picked = await pickPort({ port: 3000, strict: false, configKey: 'port', isFree: probe.isFree });

    expect(picked).toStrictEqual({ port: 3002, requested: 3000, fellBack: true });
    expect(probe.calls).toStrictEqual([3000, 3001, 3002]);
  });

  it('falls back within a range it is given', async () => {
    const probe = fakeIsFree([3000, 3001, 3002]);

    const result = pickPort({ port: 3000, strict: false, configKey: 'port', isFree: probe.isFree, range: 2 });

    await expect(result).rejects.toMatchObject({ range: { from: 3000, to: 3002 } });
    expect(probe.calls).toStrictEqual([3000, 3001, 3002]);
  });

  it('takes port 0 without probing, since the system picks a free one', async () => {
    const probe = fakeIsFree([0]);

    const picked = await pickPort({ port: 0, strict: true, configKey: 'port', isFree: probe.isFree });

    expect(picked).toStrictEqual({ port: 0, requested: 0, fellBack: false });
    expect(probe.calls).toStrictEqual([]);
  });
});

describe('PortInUseError', () => {
  it('is an AppError answering 500 PORT_IN_USE', () => {
    const err = new PortInUseError({ port: 3000, configKey: 'port' });

    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ name: 'PortInUseError', statusCode: 500, code: 'PORT_IN_USE', port: 3000 });
  });

  it('names the port, that it is taken, and the config key', () => {
    const err = new PortInUseError({ port: 8080, configKey: 'HEALTH_PORT' });

    expect(err.message).toBe('port 8080 is taken; set HEALTH_PORT to a free port');
    expect(err.toJSON()).toStrictEqual({
      code: 'PORT_IN_USE',
      message: 'port 8080 is taken; set HEALTH_PORT to a free port',
      details: { port: 8080, configKey: 'HEALTH_PORT' },
    });
  });

  it('names the range when every port in it is taken', () => {
    const err = new PortInUseError({ port: 3000, configKey: 'port', range: { from: 3000, to: 3020 } });

    expect(err.message).toBe('ports 3000-3020 are all taken; set port to a free port');
    expect(err.range).toStrictEqual({ from: 3000, to: 3020 });
  });

  it('keeps its cause', () => {
    const cause = new Error('EADDRINUSE');

    expect(new PortInUseError({ port: 3000, configKey: 'port', cause }).cause).toBe(cause);
  });
});
