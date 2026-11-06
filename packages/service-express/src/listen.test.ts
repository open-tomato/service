import type { PickedPort } from '@open-tomato/service';
import type { Server } from 'node:net';

import { createServer } from 'node:net';

import { PORT_FALLBACK_RANGE, PortInUseError } from '@open-tomato/service';
import { afterEach, describe, expect, it } from 'vitest';

import { isPortFree, listenOnPickedPort } from './listen.js';

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

    const result = listenOnPickedPort(server, { port, strict: true, configKey: 'strictPort' });

    await expect(result).rejects.toBeInstanceOf(PortInUseError);
    await expect(result).rejects.toThrow(`port ${port} is taken; set strictPort to a free port`);
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
