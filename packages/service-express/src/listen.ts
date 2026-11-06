import type { PickedPort, PickPortOptions } from '@open-tomato/service';
import type { Server } from 'node:net';

import { createServer } from 'node:net';

import { pickPort, PortInUseError } from '@open-tomato/service';

/** How many times {@link listenOnPickedPort} picks a port and listens on it. */
const LISTEN_ATTEMPTS = 2;

/** What {@link listenOnPickedPort} needs to pick a port and listen on it. */
export interface ListenOnPickedPortOptions extends Omit<PickPortOptions, 'isFree'> {
  /** Answers whether a port can be bound; defaults to {@link isPortFree}. */
  readonly isFree?: (port: number) => Promise<boolean>;
  /** Called with each pick, before the server listens on it. */
  readonly onPicked?: (picked: PickedPort) => void;
}

/** `true` when `err` is the error Node raises for a port another socket holds. */
function isAddressInUse(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'EADDRINUSE';
}

/**
 * Answers whether `port` can be bound, by listening on it with a throwaway
 * `node:net` server and closing it again.
 *
 * @param port - The port to probe.
 * @returns `true` when the probe could listen, `false` when the port is in use.
 * @throws {Error} Any listen error other than `EADDRINUSE`, such as `EACCES`.
 */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', (err) => {
      if (isAddressInUse(err)) {
        resolve(false);
        return;
      }
      reject(err);
    });
    probe.listen(port, () => {
      probe.close(() => resolve(true));
    });
  });
}

/** Listens on `port`, resolving once the server listens and rejecting with its error. */
function listenOn(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

/** The port `server` is bound to, or `fallback` when it has no TCP address. */
function boundPort(server: Server, fallback: number): number {
  const address = server.address();
  return typeof address === 'object' && address !== null
    ? address.port
    : fallback;
}

/**
 * Picks a port with the core's `pickPort` and listens on it. When the listen
 * fails with `EADDRINUSE`, because another socket took the port after the
 * probe, it picks once more and listens again; a second `EADDRINUSE` is a
 * `PortInUseError` naming the port and the config key.
 *
 * @param server - The server to listen with; it must not be listening yet.
 * @param options - The asked port, the strict flag, the config key, and the optional probe and pick hook.
 * @returns The pick, with `port` the port the server is bound to (the system's choice for port `0`).
 * @throws {PortInUseError} If the port is taken under `strict`, every port of the range is taken, or the listen hits `EADDRINUSE` twice.
 * @throws {RangeError} If the port or the range is out of bounds.
 * @throws {Error} Any listen error other than `EADDRINUSE`.
 */
export async function listenOnPickedPort(
  server: Server,
  options: ListenOnPickedPortOptions,
): Promise<PickedPort> {
  const { isFree = isPortFree, onPicked, ...rule } = options;
  let lastError: unknown;
  let lastPort = rule.port;
  for (let attempt = 0; attempt < LISTEN_ATTEMPTS; attempt += 1) {
    const picked = await pickPort({ ...rule, isFree });
    onPicked?.(picked);
    try {
      await listenOn(server, picked.port);
      return { ...picked, port: boundPort(server, picked.port) };
    } catch (err) {
      if (!isAddressInUse(err)) throw err;
      lastError = err;
      lastPort = picked.port;
    }
  }
  throw new PortInUseError({ port: lastPort, configKey: rule.configKey, cause: lastError });
}

/** The port Express listens on when neither the config nor `PORT` names one. */
export const DEFAULT_PORT = 3000;

/** The port fields of the service config that {@link resolvePortConfig} reads. */
export interface PortConfigInput {
  /** The configured port, read before `PORT`. */
  readonly port?: number | undefined;
  /** The configured strict flag, read before `PORT_STRICT`. */
  readonly strictPort?: boolean | undefined;
}

/** The port and strict flag {@link resolvePortConfig} settled on. */
export interface ResolvedPortConfig {
  /** The port to ask for. */
  readonly port: number;
  /** Whether a taken port rejects instead of falling back. */
  readonly strict: boolean;
  /** `true` when the config or `PORT` named the port, `false` for the default. */
  readonly portGiven: boolean;
}

/** The environment {@link resolvePortConfig} reads, `process.env` by default. */
export type PortEnv = Readonly<Record<string, string | undefined>>;

/** Reads `PORT` as a whole number, `undefined` when unset or empty. */
function readPortEnv(env: PortEnv): number | undefined {
  const raw = env.PORT?.trim();
  if (raw === undefined || raw === '') return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port)) {
    throw new RangeError(`PORT must be a whole number, got "${raw}"`);
  }
  return port;
}

/** Reads `PORT_STRICT`: `true` only for `true` or `1`, `undefined` when unset. */
function readStrictEnv(env: PortEnv): boolean | undefined {
  const raw = env.PORT_STRICT;
  if (raw === undefined) return undefined;
  const value = raw.trim().toLowerCase();
  return value === 'true' || value === '1';
}

/**
 * Settles the port and the strict flag for Express: each comes from the
 * config field when set, else from its environment variable (`PORT`,
 * `PORT_STRICT`), else from the default (3000, `false`).
 *
 * @param config - The `port` and `strictPort` fields of the service config.
 * @param env - The environment to read; defaults to `process.env`.
 * @returns The port, the strict flag, and whether the port was given.
 * @throws {RangeError} If `PORT` is set to something other than a whole number.
 */
export function resolvePortConfig(
  config: PortConfigInput,
  env: PortEnv = process.env,
): ResolvedPortConfig {
  const givenPort = config.port ?? readPortEnv(env);
  const strict = config.strictPort ?? readStrictEnv(env) ?? false;
  return givenPort === undefined
    ? { port: DEFAULT_PORT, strict, portGiven: false }
    : { port: givenPort, strict, portGiven: true };
}
