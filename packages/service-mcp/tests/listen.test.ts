import type { PickedPort } from '@open-tomato/service';
import type { Server } from 'node:net';

import { createServer } from 'node:net';

import { PORT_FALLBACK_RANGE, PortInUseError } from '@open-tomato/service';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_HEALTH_PORT,
  DEFAULT_PORT,
  isPortFree,
  listenOnPickedPort,
  resolvePortConfig,
} from '../src/listen.js';

/** Every server a test opened, closed after it. */
const open: Server[] = [];

/** A server the test owns, closed after the test. */
function track(server: Server): Server {
  open.push(server);
  return server;
}

/** Listens a real `node:net` server on `port` (`0` for any) and answers the port it holds. */
function hold(port = 0): Promise<number> {
  const server = track(createServer());
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      const address = server.address();
      if (typeof address === 'object' && address !== null) {
        resolve(address.port);
        return;
      }
      reject(new Error('the held server has no TCP address'));
    });
  });
}

/** Closes `server` when it listens; resolves at once when it does not. */
function close(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((err) => (err
      ? reject(err)
      : resolve()));
  });
}

/** The port `server` is bound to. */
function portOf(server: Server): number | undefined {
  const address = server.address();
  return typeof address === 'object' && address !== null
    ? address.port
    : undefined;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map(close));
});

describe('isPortFree', () => {
  it('probes a held port as taken, and the same port as free once released', async () => {
    const port = await hold();

    expect(await isPortFree(port)).toBe(false);

    await Promise.all(open.splice(0).map(close));
    expect(await isPortFree(port)).toBe(true);
  });

  it('leaves a free port free after probing it', async () => {
    const port = await hold();
    await Promise.all(open.splice(0).map(close));

    expect(await isPortFree(port)).toBe(true);
    expect(await isPortFree(port)).toBe(true);
    await expect(hold(port)).resolves.toBe(port);
  });
});

describe('listenOnPickedPort', () => {
  it('rejects a held port under strict with PortInUseError, and does not listen', async () => {
    const port = await hold();
    const server = track(createServer());

    const result = listenOnPickedPort(server, { port, strict: true, configKey: 'health.strictPort' });

    await expect(result).rejects.toBeInstanceOf(PortInUseError);
    await expect(result).rejects.toThrow(`port ${port} is taken; set health.strictPort to a free port`);
    expect(server.listening).toBe(false);
  });

  it('falls back past a held port to a later one and listens there', async () => {
    const port = await hold();
    const server = track(createServer());
    const picks: PickedPort[] = [];

    const picked = await listenOnPickedPort(server, {
      port,
      strict: false,
      configKey: 'port',
      onPicked: (pick) => {
        expect(server.listening).toBe(false);
        picks.push(pick);
      },
    });

    expect(picked.requested).toBe(port);
    expect(picked.fellBack).toBe(true);
    expect(picked.port).toBeGreaterThan(port);
    expect(picked.port).toBeLessThanOrEqual(port + PORT_FALLBACK_RANGE);
    expect(server.listening).toBe(true);
    expect(portOf(server)).toBe(picked.port);
    expect(picks).toStrictEqual([picked]);
  });

  it('listens on a free port as asked', async () => {
    const port = await hold();
    await Promise.all(open.splice(0).map(close));
    const server = track(createServer());

    const picked = await listenOnPickedPort(server, { port, strict: true, configKey: 'port' });

    expect(picked).toStrictEqual({ port, requested: port, fellBack: false });
    expect(portOf(server)).toBe(port);
  });

  it('answers the port the system bound for port 0', async () => {
    const server = track(createServer());

    const picked = await listenOnPickedPort(server, { port: 0, strict: false, configKey: 'port' });

    expect(picked.requested).toBe(0);
    expect(picked.fellBack).toBe(false);
    expect(picked.port).toBeGreaterThan(0);
    expect(portOf(server)).toBe(picked.port);
  });

  it('picks once more when the listen hits EADDRINUSE after the probe called the port free', async () => {
    const port = await hold();
    const server = track(createServer());
    const probed: number[] = [];
    let lied = false;
    // The first probe of the held port lies, as a probe does when another
    // socket takes the port between the probe and the listen.
    const isFree = async (candidate: number): Promise<boolean> => {
      probed.push(candidate);
      if (candidate === port && !lied) {
        lied = true;
        return true;
      }
      return isPortFree(candidate);
    };
    const picks: PickedPort[] = [];

    const picked = await listenOnPickedPort(server, {
      port,
      strict: false,
      configKey: 'port',
      isFree,
      onPicked: (pick) => picks.push(pick),
    });

    expect(picks[0]).toStrictEqual({ port, requested: port, fellBack: false });
    expect(picks).toHaveLength(2);
    expect(probed.filter((candidate) => candidate === port)).toHaveLength(2);
    expect(picked.fellBack).toBe(true);
    expect(picked.port).toBeGreaterThan(port);
    expect(portOf(server)).toBe(picked.port);
  });

  it('rejects with PortInUseError when the listen hits EADDRINUSE a second time', async () => {
    const port = await hold();
    const server = track(createServer());
    const picks: PickedPort[] = [];

    const result = listenOnPickedPort(server, {
      port,
      strict: false,
      configKey: 'PORT',
      isFree: () => Promise.resolve(true),
      onPicked: (pick) => picks.push(pick),
    });

    await expect(result).rejects.toBeInstanceOf(PortInUseError);
    await expect(result).rejects.toThrow(`port ${port} is taken; set PORT to a free port`);
    await expect(result).rejects.toMatchObject({ cause: { code: 'EADDRINUSE' } });
    expect(picks).toHaveLength(2);
    expect(server.listening).toBe(false);
  });

  it('passes on a probe that fails, without listening', async () => {
    const boom = new Error('probe failed');
    const server = track(createServer());

    const result = listenOnPickedPort(server, {
      port: 3000,
      strict: false,
      configKey: 'port',
      isFree: () => Promise.reject(boom),
    });

    await expect(result).rejects.toBe(boom);
    expect(server.listening).toBe(false);
  });
});

describe('resolvePortConfig', () => {
  const defaults = {
    port: DEFAULT_PORT,
    strict: false,
    configKey: 'port',
    health: { port: DEFAULT_HEALTH_PORT, strict: false, configKey: 'health.port' },
  };

  it('answers the defaults when neither the config nor the env names a value', () => {
    expect(resolvePortConfig({}, {})).toEqual(defaults);
    expect(DEFAULT_PORT).toBe(8080);
    expect(DEFAULT_HEALTH_PORT).toBe(3001);
  });

  it('reads the config before PORT, PORT_STRICT, HEALTH_PORT and HEALTH_PORT_STRICT', () => {
    const env = { PORT: '4100', PORT_STRICT: 'true', HEALTH_PORT: '4101', HEALTH_PORT_STRICT: '1' };
    const config = { port: 4200, strictPort: false, health: { port: 4201, strictPort: false } };
    expect(resolvePortConfig(config, env)).toEqual({
      port: 4200, strict: false, configKey: 'port', health: { port: 4201, strict: false, configKey: 'health.port' },
    });
  });

  it('reads the four env names when the config leaves them out', () => {
    const env = { PORT: '4100', PORT_STRICT: 'true', HEALTH_PORT: '4101', HEALTH_PORT_STRICT: '1' };
    expect(resolvePortConfig({ health: {} }, env)).toEqual({
      port: 4100, strict: true, configKey: 'PORT', health: { port: 4101, strict: true, configKey: 'HEALTH_PORT' },
    });
  });

  it('settles each port and strict flag on its own', () => {
    const env = { PORT: '4100', PORT_STRICT: '1', HEALTH_PORT: '4101', HEALTH_PORT_STRICT: 'false' };
    expect(resolvePortConfig({ port: 4200, health: { strictPort: true } }, env)).toEqual({
      port: 4200, strict: true, configKey: 'port', health: { port: 4101, strict: true, configKey: 'HEALTH_PORT' },
    });
  });

  it('keeps the transport and health names apart', () => {
    expect(resolvePortConfig({}, { PORT: '4100', PORT_STRICT: '1' })).toEqual({
      ...defaults, port: 4100, strict: true, configKey: 'PORT',
    });
    expect(resolvePortConfig({}, { HEALTH_PORT: '4101', HEALTH_PORT_STRICT: '1' })).toEqual({
      ...defaults, health: { port: 4101, strict: true, configKey: 'HEALTH_PORT' },
    });
  });

  it('takes port 0 from the config as given, not as unset', () => {
    expect(resolvePortConfig({ port: 0, health: { port: 0 } }, { PORT: '4100', HEALTH_PORT: '4101' })).toEqual({
      port: 0, strict: false, configKey: 'port', health: { port: 0, strict: false, configKey: 'health.port' },
    });
  });

  it('names the config key for a port the config or the default gave, and the variable for one the env gave', () => {
    expect(resolvePortConfig({}, {})).toMatchObject({ configKey: 'port', health: { configKey: 'health.port' } });
    expect(resolvePortConfig({ port: 4200, health: { port: 4201 } }, { PORT: '4100', HEALTH_PORT: '4101' }))
      .toMatchObject({ configKey: 'port', health: { configKey: 'health.port' } });
    expect(resolvePortConfig({}, { PORT: '4100', HEALTH_PORT: '4101' }))
      .toMatchObject({ configKey: 'PORT', health: { configKey: 'HEALTH_PORT' } });
  });

  it('ignores a malformed variable when the config names that port', () => {
    expect(resolvePortConfig({ port: 4200, health: { port: 4201 } }, { PORT: 'abc', HEALTH_PORT: 'abc' }))
      .toMatchObject({ port: 4200, health: { port: 4201 } });
  });

  it.each(['true', '1', 'TRUE', ' 1 '])('reads a strict value of %j as strict', (value) => {
    const resolved = resolvePortConfig({}, { PORT_STRICT: value, HEALTH_PORT_STRICT: value });
    expect(resolved.strict).toBe(true);
    expect(resolved.health.strict).toBe(true);
  });

  it.each(['false', '0', '', 'yes', 'on'])('reads a strict value of %j as not strict', (value) => {
    const resolved = resolvePortConfig({}, { PORT_STRICT: value, HEALTH_PORT_STRICT: value });
    expect(resolved.strict).toBe(false);
    expect(resolved.health.strict).toBe(false);
  });

  it('treats an empty PORT and HEALTH_PORT as unset', () => {
    expect(resolvePortConfig({}, { PORT: '', HEALTH_PORT: ' ' })).toEqual(defaults);
  });

  it.each([
    ['PORT', 'abc'],
    ['PORT', '30.5'],
    ['HEALTH_PORT', 'abc'],
    ['HEALTH_PORT', '30.5'],
  ])('rejects %s=%j with a RangeError naming it', (name, value) => {
    const read = (): unknown => resolvePortConfig({}, { [name]: value });
    expect(read).toThrow(RangeError);
    expect(read).toThrow(new RegExp(`^${name} must be a whole number`));
  });

  it('reads process.env when no env is passed', () => {
    const names = ['PORT', 'PORT_STRICT', 'HEALTH_PORT', 'HEALTH_PORT_STRICT'] as const;
    const saved = names.map(name => [name, process.env[name]] as const);
    process.env['PORT'] = '4300';
    process.env['PORT_STRICT'] = '1';
    process.env['HEALTH_PORT'] = '4301';
    process.env['HEALTH_PORT_STRICT'] = 'true';
    try {
      expect(resolvePortConfig({})).toEqual({
        port: 4300, strict: true, configKey: 'PORT', health: { port: 4301, strict: true, configKey: 'HEALTH_PORT' },
      });
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
