import type { Logger, PickedPort, PickPortOptions } from '@open-tomato/service';
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

/** The config key and environment variable that make a taken port an error instead of a fallback. */
export interface StrictNames {
  /** The config key, such as `strictPort` or `health.strictPort`. */
  readonly strictKey: string;
  /** The environment variable, such as `PORT_STRICT` or `HEALTH_PORT_STRICT`. */
  readonly strictEnv: string;
}

/**
 * Logs a `warn` record when `pick` fell back from the asked port, naming the
 * taken port, the port bound instead, and the config key and variable that
 * turn the fallback into an error. A pick that did not fall back logs nothing.
 *
 * @param logger - The logger to write the record to.
 * @param pick - The pick `listenOnPickedPort` made.
 * @param names - The strict config key and environment variable to name.
 */
export function warnOnFallback(logger: Logger, pick: PickedPort, names: StrictNames): void {
  if (!pick.fellBack) return;
  const { strictKey, strictEnv } = names;
  logger.warn(
    { takenPort: pick.requested, port: pick.port, strictKey, strictEnv },
    `port ${pick.requested} is taken, falling back to ${pick.port}; set ${strictKey} or ${strictEnv}=true to fail instead`,
  );
}

/** The port the HTTP transport listens on when neither the config nor `PORT` names one. */
export const DEFAULT_PORT = 8080;

/** The port the health server listens on when neither the config nor `HEALTH_PORT` names one. */
export const DEFAULT_HEALTH_PORT = 3001;

/** The port fields of the MCP config that {@link resolvePortConfig} reads. */
export interface PortConfigInput {
  /** The configured transport port, read before `PORT`. */
  readonly port?: number | undefined;
  /** The configured transport strict flag, read before `PORT_STRICT`. */
  readonly strictPort?: boolean | undefined;
  /** The configured health port and strict flag, read before `HEALTH_PORT` and `HEALTH_PORT_STRICT`. */
  readonly health?: {
    readonly port?: number | undefined;
    readonly strictPort?: boolean | undefined;
  } | undefined;
}

/** One port and its strict flag, as {@link resolvePortConfig} settled them. */
export interface ResolvedPort {
  /** The port to ask for. */
  readonly port: number;
  /** Whether a taken port rejects instead of falling back. */
  readonly strict: boolean;
  /**
   * What a `PortInUseError` tells the operator to set: the environment
   * variable when it gave the port, else the config key (for the default too).
   */
  readonly configKey: string;
}

/** The names one port is set by: its config key, its two variables and its default. */
interface PortNames {
  /** The config key, such as `port` or `health.port`. */
  readonly configKey: string;
  /** The variable that names the port, such as `PORT`. */
  readonly portEnv: string;
  /** The variable that names the strict flag, such as `PORT_STRICT`. */
  readonly strictEnv: string;
  /** The port when neither the config nor the variable names one. */
  readonly defaultPort: number;
}

/** The names of the transport port. */
const TRANSPORT_PORT_NAMES: PortNames = {
  configKey: 'port', portEnv: 'PORT', strictEnv: 'PORT_STRICT', defaultPort: DEFAULT_PORT,
};

/** The names of the health server's port. */
const HEALTH_PORT_NAMES: PortNames = {
  configKey: 'health.port', portEnv: 'HEALTH_PORT', strictEnv: 'HEALTH_PORT_STRICT', defaultPort: DEFAULT_HEALTH_PORT,
};

/** The transport and health ports {@link resolvePortConfig} settled on. */
export interface ResolvedPortConfig extends ResolvedPort {
  /** The health server's port and strict flag. */
  readonly health: ResolvedPort;
}

/** The environment {@link resolvePortConfig} reads, `process.env` by default. */
export type PortEnv = Readonly<Record<string, string | undefined>>;

/** Reads the variable `name` as a whole number, `undefined` when unset or empty. */
function readPortEnv(env: PortEnv, name: string): number | undefined {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port)) {
    throw new RangeError(`${name} must be a whole number, got "${raw}"`);
  }
  return port;
}

/** Reads the variable `name` as a strict flag: `true` only for `true` or `1`, `undefined` when unset. */
function readStrictEnv(env: PortEnv, name: string): boolean | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const value = raw.trim().toLowerCase();
  return value === 'true' || value === '1';
}

/**
 * Settles one port: the config field when set, else the variable, else the
 * default; the strict flag the same way. `configKey` names the variable
 * only when the variable gave the port.
 */
function resolvePort(
  given: { readonly port?: number | undefined; readonly strictPort?: boolean | undefined } | undefined,
  names: PortNames,
  env: PortEnv,
): ResolvedPort {
  const fromEnv = given?.port === undefined
    ? readPortEnv(env, names.portEnv)
    : undefined;
  return {
    port: given?.port ?? fromEnv ?? names.defaultPort,
    strict: given?.strictPort ?? readStrictEnv(env, names.strictEnv) ?? false,
    configKey: fromEnv === undefined
      ? names.configKey
      : names.portEnv,
  };
}

/**
 * Settles the transport and health ports and their strict flags for the MCP
 * adapter: each comes from the config field when set, else from its
 * environment variable (`PORT`, `PORT_STRICT`, `HEALTH_PORT`,
 * `HEALTH_PORT_STRICT`), else from the default (8080, 3001, `false`). Each
 * port carries the `configKey` a `PortInUseError` should name: the variable
 * when it gave the port (`PORT`, `HEALTH_PORT`), else the config key
 * (`port`, `health.port`).
 *
 * @param config - The `port`, `strictPort` and `health` fields of the MCP config.
 * @param env - The environment to read; defaults to `process.env`.
 * @returns The transport port, strict flag and config key, and the health server's.
 * @throws {RangeError} If `PORT` or `HEALTH_PORT` is read and set to something other than a whole number.
 */
export function resolvePortConfig(
  config: PortConfigInput,
  env: PortEnv = process.env,
): ResolvedPortConfig {
  const transport = resolvePort(config, TRANSPORT_PORT_NAMES, env);
  return { ...transport, health: resolvePort(config.health, HEALTH_PORT_NAMES, env) };
}
