import type { HealthReport } from './health.js';
import type { Logger } from './logger.js';
import type { Dependency } from './types.js';

import { aggregateHealth } from './health.js';
import { createConsoleLogger } from './logger.js';

/** Per-dependency stop timeout by default: the Express adapter's drain default. */
const DEFAULT_STOP_TIMEOUT_MS = 10_000;

/**
 * Where a runtime is in its lifecycle.
 *
 * - `"idle"` — never started, or the last start failed and was rolled back
 * - `"starting"` — starting its dependencies, then its clients
 * - `"running"` — every dependency and client started
 * - `"stopping"` — stopping them, in reverse
 * - `"stopped"` — stopped; {@link Runtime.ensureStarted} starts it again
 */
export type RuntimeState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped';

/** A record of dependencies or clients, keyed by how the service reaches them. */
export type DependencyRecord = Readonly<Record<string, Dependency>>;

/** Options for {@link createRuntime}. */
export interface RuntimeOptions<D extends DependencyRecord, C extends DependencyRecord> {
  /** The service's identifier; non-empty. Names the default logger. */
  readonly serviceId: string;
  /** Dependencies, started in key order before the clients. */
  readonly dependencies?: D;
  /** Clients, such as those from `createHttpClient`, started after the dependencies. */
  readonly clients?: C;
  /** Where the runtime logs; defaults to `createConsoleLogger(serviceId)`. */
  readonly logger?: Logger;
  /** Milliseconds each dependency's `stop()` gets before it is reported as timed out; default 10 000. */
  readonly stopTimeoutMs?: number;
}

/** What {@link Runtime.stop} did, by dependency name, in stop order. */
export interface StopResult {
  /** Stopped within the timeout. */
  readonly stopped: readonly string[];
  /** Their `stop()` rejected. */
  readonly failed: readonly string[];
  /** Their `stop()` outlasted the timeout; it may still settle later. */
  readonly timedOut: readonly string[];
}

/** A service's dependencies and clients, started and stopped as one. */
export interface Runtime<D extends DependencyRecord, C extends DependencyRecord> {
  /** The service's identifier. */
  readonly serviceId: string;
  /** The dependencies, by key, with their own types. */
  readonly deps: D;
  /** The clients, by key, with their own types. */
  readonly clients: C;
  /** The logger the runtime writes through. */
  readonly logger: Logger;
  /** The current lifecycle state. */
  readonly state: RuntimeState;
  /**
   * Starts every dependency, then every client, in key order, once: calls
   * made while a start is in progress share it, and a call once running
   * resolves at once. When one fails, those already started are stopped in
   * reverse, the call rejects with that error, and the next call tries again.
   *
   * @throws The failing dependency's error; or an `Error` while stopping.
   */
  ensureStarted(): Promise<void>;
  /**
   * Stops the clients, then the dependencies, in reverse start order. Waits
   * for a start in progress first; does nothing when not started. Never
   * rejects: a failed or slow stop is reported, and the rest still stop.
   */
  stop(): Promise<StopResult>;
  /** The health report over every dependency and client; see `aggregateHealth`. */
  health(): HealthReport;
}

type StopOutcome =
  | { readonly kind: 'stopped' }
  | { readonly kind: 'timedOut' }
  | { readonly kind: 'failed'; readonly error: unknown };

const NOT_STOPPED: StopResult = { stopped: [], failed: [], timedOut: [] };

const STARTED_STATES: ReadonlySet<RuntimeState> = new Set(['running', 'stopping', 'stopped']);

/**
 * Runs `entry.stop()` against a timer, so one hung dependency cannot hold
 * up the rest.
 */
async function stopWithin(entry: Dependency, timeoutMs: number): Promise<StopOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<StopOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timedOut' }), timeoutMs);
  });
  const stopping = entry.stop().then(
    (): StopOutcome => ({ kind: 'stopped' }),
    (error: unknown): StopOutcome => ({ kind: 'failed', error }),
  );
  try {
    return await Promise.race([stopping, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Stops `entries` one at a time, in the order given, and reports each outcome. */
async function stopEach(entries: readonly Dependency[], timeoutMs: number, logger: Logger): Promise<StopResult> {
  const stopped: string[] = [];
  const failed: string[] = [];
  const timedOut: string[] = [];

  for (const entry of entries) {
    const outcome = await stopWithin(entry, timeoutMs);
    if (outcome.kind === 'stopped') {
      stopped.push(entry.name);
      logger.info({ dependency: entry.name }, 'dependency stopped');
    } else if (outcome.kind === 'timedOut') {
      timedOut.push(entry.name);
      logger.warn({ dependency: entry.name, timeoutMs }, 'dependency stop timed out');
    } else {
      failed.push(entry.name);
      logger.error({ dependency: entry.name, err: outcome.error }, 'dependency stop failed');
    }
  }

  return { stopped, failed, timedOut };
}

/**
 * Starts `entries` in order. When one fails, stops those already started,
 * in reverse, and rethrows; the failed one keeps its own `error` status.
 */
async function startAll(entries: readonly Dependency[], timeoutMs: number, logger: Logger): Promise<void> {
  const started: Dependency[] = [];

  for (const entry of entries) {
    try {
      await entry.start();
    } catch (err) {
      logger.error({ dependency: entry.name, err }, 'dependency failed to start; rolling back');
      await stopEach([...started].reverse(), timeoutMs, logger);
      throw err;
    }
    started.push(entry);
    logger.info({ dependency: entry.name }, 'dependency started');
  }
}

/** Checks the options that would make a runtime misbehave later. */
function validate(serviceId: string, entries: readonly Dependency[], stopTimeoutMs: number): void {
  if (typeof serviceId !== 'string' || serviceId.trim() === '') {
    throw new TypeError('createRuntime: serviceId must be a non-empty string');
  }
  if (!Number.isFinite(stopTimeoutMs) || stopTimeoutMs < 0) {
    throw new TypeError('createRuntime: stopTimeoutMs must be a finite number, 0 or more');
  }
  const names = new Set<string>();
  for (const { name } of entries) {
    if (names.has(name)) {
      throw new TypeError(`createRuntime: duplicate dependency or client name "${name}"`);
    }
    names.add(name);
  }
}

/**
 * Creates the runtime that starts and stops a service's dependencies and
 * clients as one: the lifecycle every adapter shares.
 *
 * Dependencies start in key order, then clients; they stop in reverse. A
 * service reaches each by its key (`runtime.deps.db`), and health reports
 * and logs use each one's own `name`, which must be unique across both
 * records. Pass dependencies that are not started yet.
 *
 * @param options - The service id, its dependencies and clients, a logger,
 *   and the per-dependency stop timeout.
 * @returns The runtime, in state `"idle"`.
 * @throws {TypeError} When `serviceId` is blank, `stopTimeoutMs` is negative
 *   or not finite, or two dependencies or clients share a name.
 *
 * @example
 * ```ts
 * const runtime = createRuntime({
 *   serviceId: 'orders',
 *   dependencies: { db: createDependency({ name: 'db', client: pool, onStart: () => pool.connect() }) },
 *   clients: { inventory: createHttpClient(new InventoryApi(), { name: 'inventory' }) },
 * });
 *
 * await runtime.ensureStarted();
 * const rows = await runtime.deps.db.client.query('select 1');
 * ```
 */
export function createRuntime<
  D extends DependencyRecord = Record<never, never>,
  C extends DependencyRecord = Record<never, never>,
>(options: RuntimeOptions<D, C>): Runtime<D, C> {
  const deps = Object.freeze({ ...options.dependencies }) as D;
  const clients = Object.freeze({ ...options.clients }) as C;
  const entries: readonly Dependency[] = [...Object.values(deps), ...Object.values(clients)];
  const stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  validate(options.serviceId, entries, stopTimeoutMs);
  const logger = options.logger ?? createConsoleLogger(options.serviceId);

  let state: RuntimeState = 'idle';
  let starting: Promise<void> | null = null;
  let stopping: Promise<StopResult> | null = null;

  async function begin(): Promise<void> {
    state = 'starting';
    try {
      await startAll(entries, stopTimeoutMs, logger);
      state = 'running';
    } catch (err) {
      state = 'idle';
      throw err;
    }
  }

  async function halt(): Promise<StopResult> {
    if (starting) await starting.catch(() => undefined);
    if (state !== 'running') return NOT_STOPPED;
    state = 'stopping';
    const result = await stopEach([...entries].reverse(), stopTimeoutMs, logger);
    state = 'stopped';
    return result;
  }

  return {
    serviceId: options.serviceId,
    deps,
    clients,
    logger,
    get state(): RuntimeState {
      return state;
    },
    ensureStarted(): Promise<void> {
      if (state === 'running') return Promise.resolve();
      if (state === 'stopping') {
        return Promise.reject(new Error(`createRuntime: "${options.serviceId}" is stopping`));
      }
      starting ??= begin().finally(() => { starting = null; });
      return starting;
    },
    stop(): Promise<StopResult> {
      stopping ??= halt().finally(() => { stopping = null; });
      return stopping;
    },
    health(): HealthReport {
      return aggregateHealth(entries, { started: STARTED_STATES.has(state) });
    },
  };
}
