import type { Dependency, DependencyStatus, TypedDependency } from './types.js';

/**
 * Base options for `createDependency`.
 *
 * Provide lifecycle hooks to integrate any custom resource into the standard
 * {@link Dependency} state machine without coupling it to a specific transport
 * or SDK.
 */
export interface CreateDependencyOpts {
  /**
   * Human-readable name for this dependency, used in logs and health reports.
   */
  name: string;

  /**
   * Called during `start()` after the status transitions to `"starting"`.
   * Resolve to signal a successful initialisation; reject to transition to `"error"`.
   */
  onStart?(): Promise<void> | void;

  /**
   * Called during `stop()` to release any resources held by the dependency.
   * The status transitions through `"stopping"` and then `"stopped"` once this settles.
   */
  onStop?(): Promise<void> | void;

  /**
   * Called during `pause()` when the dependency transitions from `"running"` to `"paused"`.
   * Resolve to confirm the dependency has been suspended; reject to leave it in `"error"`.
   */
  onPause?(): Promise<void> | void;

  /**
   * Called during `resume()` when the dependency transitions from `"paused"` back to `"running"`.
   * Resolve to confirm the dependency is operational again; reject to leave it in `"error"`.
   */
  onResume?(): Promise<void> | void;

  /**
   * Optional structured health detail probe.
   * Returns a key/value record describing the dependency's current health
   * (e.g. connection status, latency, pool size).
   * Implementations may omit this; callers must treat its absence as unknown health.
   *
   * @example
   * ```ts
   * dep.healthDetail?.() // → { connected: true, latencyMs: 12, poolSize: 5 }
   * ```
   */
  healthDetail?(): Record<string, unknown>;

  /**
   * Arbitrary diagnostic metadata attached to the dependency instance.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Options for `createDependency` when a strongly-typed client instance should
 * be exposed on the returned object.
 *
 * @typeParam T - The type of the client or resource instance to attach.
 */
export interface CreateTypedDependencyOpts<T> extends CreateDependencyOpts {
  /**
   * The typed client instance to expose as `dependency.client`.
   */
  client: T;
}

/**
 * Creates a {@link TypedDependency} wrapping the provided `client` and
 * lifecycle hooks.
 *
 * @typeParam T - The type of the client instance.
 * @param opts - Options including the required `client` field.
 * @returns A `TypedDependency<T>` whose `client` property carries the wrapped instance.
 *
 * @example
 * ```ts
 * const db = createDependency({
 *   name: 'postgres',
 *   client: prisma,
 *   async onStart() { await prisma.$connect(); },
 *   async onStop()  { await prisma.$disconnect(); },
 * });
 *
 * await db.start();
 * const users = await db.client.user.findMany();
 * await db.stop();
 * ```
 */
export function createDependency<T>(opts: CreateTypedDependencyOpts<T>): TypedDependency<T>;

/**
 * Creates a {@link Dependency} from lifecycle hooks, without a typed client.
 *
 * Use this overload as an escape hatch for any resource that needs to
 * participate in the {@link Dependency} state machine but does not have a
 * first-class package integration.
 *
 * ### State machine
 *
 * ```
 * stopped  ──[start()]───► starting ──[onStart resolves]──► running
 *                                    └─[onStart rejects]──► error
 * running  ──[stop()]────► stopping ──[onStop settles]───► stopped
 * running  ──[pause()]───► paused
 * paused   ──[resume()]──► running
 * paused   ──[stop()]────► stopping ──[onStop settles]───► stopped
 * error    ──[stop()]────► stopping ──[onStop settles]───► stopped
 * error    ──[start()]───► starting   (restart allowed)
 * ```
 *
 * #### Invalid transitions
 * | Current status | Action     | Behaviour            |
 * |----------------|------------|----------------------|
 * | `running`      | `start()`  | throws               |
 * | `starting`     | `start()`  | throws               |
 * | `stopped`      | `stop()`   | no-op (idempotent)   |
 * | `stopping`     | `stop()`   | no-op (idempotent)   |
 * | non-running    | `pause()`  | throws               |
 * | non-paused     | `resume()` | throws               |
 *
 * @param opts - Lifecycle hooks and metadata for the dependency.
 * @returns A `Dependency`-conformant object.
 *
 * @example
 * ```ts
 * const redisConn = createDependency({
 *   name: 'redis',
 *   async onStart() { await redis.connect(); },
 *   async onStop()  { await redis.disconnect(); },
 *   healthDetail() { return { connected: redis.ping() === 'PONG' }; },
 *   metadata: { host: 'localhost', port: 6379 },
 * });
 *
 * await redisConn.start();
 * console.log(redisConn.status); // "running"
 * await redisConn.stop();
 * console.log(redisConn.status); // "stopped"
 * ```
 */
export function createDependency(opts: CreateDependencyOpts): Dependency;

export function createDependency<T = void>(
  opts: CreateDependencyOpts & { client?: T },
): Dependency | TypedDependency<T> {
  let _status: DependencyStatus = 'stopped';

  /**
   * Validates and applies a state transition.
   * Throws for illegal transitions; acts as a no-op for idempotent cases.
   *
   * @internal
   */
  function transition(next: DependencyStatus): void {
    const current = _status;

    if (next === 'starting') {
      if (current === 'running') {
        throw new Error(
          `[${opts.name}] Cannot start a dependency that is already running`,
        );
      }
      if (current === 'starting') {
        throw new Error(
          `[${opts.name}] Cannot start a dependency that is already starting`,
        );
      }
    }

    _status = next;
  }

  const dep = {
    get name(): string {
      return opts.name;
    },

    get status(): DependencyStatus {
      return _status;
    },

    get metadata(): Record<string, unknown> | undefined {
      return opts.metadata;
    },

    async start(): Promise<void> {
      transition('starting');
      try {
        await opts.onStart?.();
        _status = 'running';
      } catch (err) {
        _status = 'error';
        throw err;
      }
    },

    async stop(): Promise<void> {
      if (_status === 'stopped' || _status === 'stopping') {
        // Idempotent — already stopped or in the process of stopping.
        return;
      }
      _status = 'stopping';
      try {
        await opts.onStop?.();
      } finally {
        _status = 'stopped';
      }
    },

    async pause(): Promise<void> {
      if (_status !== 'running') {
        throw new Error(
          `[${opts.name}] Cannot pause a dependency that is not running (current: ${_status})`,
        );
      }
      try {
        await opts.onPause?.();
        _status = 'paused';
      } catch (err) {
        _status = 'error';
        throw err;
      }
    },

    async resume(): Promise<void> {
      if (_status !== 'paused') {
        throw new Error(
          `[${opts.name}] Cannot resume a dependency that is not paused (current: ${_status})`,
        );
      }
      try {
        await opts.onResume?.();
        _status = 'running';
      } catch (err) {
        _status = 'error';
        throw err;
      }
    },

    ...(opts.healthDetail !== undefined && {
      healthDetail(): Record<string, unknown> {
        return opts.healthDetail!();
      },
    }),

    ...('client' in opts && { client: opts.client }),
  };

  return dep as Dependency | TypedDependency<T>;
}
