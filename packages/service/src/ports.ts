/** The port rule: take the asked port, or fall back to the next free one. */
import { AppError } from './errors.js';

/** How many ports after the asked one a fallback tries. */
export const PORT_FALLBACK_RANGE = 20;

/** The highest TCP port. */
const MAX_PORT = 65_535;

/** The ports a fallback tried, first and last included. */
export interface PortRange {
  /** The first port tried, the one asked for. */
  readonly from: number;
  /** The last port tried. */
  readonly to: number;
}

/**
 * The port a service cannot bind. Answers 500 `PORT_IN_USE`. The message
 * names the port, says it is taken and names the config key that sets it;
 * with a `range`, it names the range, every port of which is taken.
 *
 * @example
 * ```ts
 * new PortInUseError({ port: 3000, configKey: 'port' }).message;
 * // 'port 3000 is taken; set port to a free port'
 * ```
 */
export class PortInUseError extends AppError {
  /** The port asked for. */
  readonly port: number;
  /** The config key that sets the port, such as `port` or `PORT`. */
  readonly configKey: string;
  /** The ports tried, when a fallback ran out of them. */
  readonly range?: PortRange;

  /**
   * @param opts.port - The port asked for.
   * @param opts.configKey - The config key that sets the port.
   * @param opts.range - The ports tried, when every one of them is taken.
   * @param opts.cause - The error that caused this one.
   */
  constructor(opts: {
    port: number;
    configKey: string;
    range?: PortRange;
    cause?: unknown;
  }) {
    const taken = opts.range === undefined
      ? `port ${opts.port} is taken`
      : `ports ${opts.range.from}-${opts.range.to} are all taken`;
    super({
      message: `${taken}; set ${opts.configKey} to a free port`,
      statusCode: 500,
      code: 'PORT_IN_USE',
      details: opts.range === undefined
        ? { port: opts.port, configKey: opts.configKey }
        : { port: opts.port, configKey: opts.configKey, range: opts.range },
      cause: opts.cause,
    });
    this.port = opts.port;
    this.configKey = opts.configKey;
    this.range = opts.range;
  }
}

/** What {@link pickPort} needs to choose a port. */
export interface PickPortOptions {
  /** The port asked for; `0` asks the system for any free port. */
  readonly port: number;
  /** When `true`, a taken port is an error rather than a fallback. */
  readonly strict: boolean;
  /** The config key that sets the port, named in the error. */
  readonly configKey: string;
  /** Answers whether a port can be bound; the adapter supplies it. */
  readonly isFree: (port: number) => Promise<boolean>;
  /** How many ports after `port` a fallback tries; defaults to {@link PORT_FALLBACK_RANGE}. */
  readonly range?: number;
}

/** The port {@link pickPort} chose. */
export interface PickedPort {
  /** The port to bind. */
  readonly port: number;
  /** The port asked for. */
  readonly requested: number;
  /** `true` when `port` is not the one asked for. */
  readonly fellBack: boolean;
}

/**
 * Chooses the port to bind: the asked one when it is free, else (unless
 * `strict`) the first free port of the next `range` ports.
 *
 * @param opts - The asked port, the strict flag, the config key and the probe.
 * @returns The chosen port, the asked one, and whether they differ.
 * @throws {RangeError} If `port` is not an integer from 0 to 65535, or `range` is not a positive integer.
 * @throws {PortInUseError} If the port is taken under `strict`, or every port of the range is taken.
 */
export async function pickPort(opts: PickPortOptions): Promise<PickedPort> {
  const { port, strict, configKey, isFree } = opts;
  const range = opts.range ?? PORT_FALLBACK_RANGE;
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
    throw new RangeError(`${configKey} must be an integer from 0 to ${MAX_PORT}, got ${port}`);
  }
  if (!Number.isInteger(range) || range < 1) {
    throw new RangeError(`the port fallback range must be a positive integer, got ${range}`);
  }
  if (port === 0 || await isFree(port)) {
    return { port, requested: port, fellBack: false };
  }
  if (strict) {
    throw new PortInUseError({ port, configKey });
  }
  const last = Math.min(port + range, MAX_PORT);
  for (let candidate = port + 1; candidate <= last; candidate += 1) {
    if (await isFree(candidate)) {
      return { port: candidate, requested: port, fellBack: true };
    }
  }
  throw new PortInUseError({ port, configKey, range: { from: port, to: last } });
}
