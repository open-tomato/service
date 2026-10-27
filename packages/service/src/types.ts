/**
 * Represents the lifecycle state of a managed dependency.
 *
 * - `"starting"` — the dependency is initialising
 * - `"running"` — the dependency is healthy and accepting work (maps to circuit-breaker closed state)
 * - `"paused"` — the dependency is temporarily suspended; resumes without re-initialisation
 * - `"stopping"` — the dependency is in the process of shutting down (draining in-flight work)
 * - `"stopped"` — the dependency has been intentionally shut down
 * - `"error"` — the dependency has failed or the circuit is open
 * - `"degraded"` — the dependency is operational but impaired (maps to circuit-breaker half-open probe state)
 */
export type DependencyStatus =
  | 'starting' | 'running' | 'paused'
  | 'stopping' | 'stopped' | 'error' | 'degraded';

/**
 * Contract for any managed dependency in the service runtime.
 *
 * Implementations are responsible for transitioning through the
 * {@link DependencyStatus} lifecycle:
 * - Normal path: `stopped → starting → running → stopping → stopped`
 * - Suspend path: `running → paused → running`
 * - Error path: `error` is reachable from any non-stopped state
 *
 * Both `createDependency` and `createHttpClient` return objects that satisfy
 * this interface, allowing consumers to manage heterogeneous dependencies
 * through a single, uniform surface.
 */
export interface Dependency {
  /**
   * Current lifecycle state of the dependency.
   * Updated synchronously as the dependency transitions between states.
   */
  readonly status: DependencyStatus;

  /**
   * Human-readable name identifying this dependency in logs and health reports.
   */
  readonly name: string;

  /**
   * Initialise the dependency.
   * Transitions `status` from `"stopped"` → `"starting"` → `"running"`.
   * Resolves once the dependency is ready to accept work.
   * Rejects (and sets `status` to `"error"`) if initialisation fails.
   */
  start(): Promise<void>;

  /**
   * Gracefully shut down the dependency.
   * Transitions `status` through `"stopping"` → `"stopped"` after any
   * in-flight operations complete.
   * Calling `stop` on an already-stopped dependency is a no-op.
   */
  stop(): Promise<void>;

  /**
   * Temporarily suspend the dependency without tearing it down.
   * Transitions `status` from `"running"` → `"paused"`.
   * Implementations may omit this when suspension is not meaningful.
   */
  pause?(): Promise<void>;

  /**
   * Resume a suspended dependency.
   * Transitions `status` from `"paused"` → `"running"`.
   * Implementations may omit this when suspension is not meaningful.
   */
  resume?(): Promise<void>;

  /**
   * Optional structured health detail probe.
   * Returns a key/value record describing the dependency's current health.
   * Implementations may omit this; callers must treat its absence as unknown health.
   *
   * @example
   * ```ts
   * dep.healthDetail?.() // → { connected: true, latencyMs: 12, poolSize: 5 }
   * ```
   */
  healthDetail?(): Record<string, unknown>;

  /**
   * Arbitrary key/value metadata attached to this dependency instance.
   * Useful for surfacing connection targets, version strings, or other
   * diagnostic information without coupling consumers to implementation details.
   */
  readonly metadata?: Record<string, unknown>;
}

/**
 * A `Dependency` augmented with a strongly-typed client instance of type `T`.
 *
 * Use this when you need to carry the underlying client (e.g. a database
 * connection or SDK instance) alongside the standard dependency lifecycle
 * surface, without losing type information.
 *
 * @typeParam T - The type of the wrapped client or resource instance.
 *
 * @example
 * ```ts
 * const db: TypedDependency<PrismaClient> = createDependency({ client: prisma, ... });
 * await db.start();
 * const users = await db.client.user.findMany();
 * ```
 */
export interface TypedDependency<T> extends Dependency {
  /**
   * The strongly-typed client or resource instance managed by this dependency.
   * Available after `start()` resolves successfully.
   */
  readonly client: T;
}

/**
 * Extracts the strongly-typed client instance `T` from a {@link TypedDependency}`<T>`.
 *
 * Returns `never` when `T` is a plain `Dependency` with no typed client,
 * making it safe to use in generic constraint positions without widening
 * to `unknown`.
 *
 * @typeParam T - A `Dependency` subtype, typically produced by `createDependency`
 *   or `createHttpClient`.
 *
 * @example
 * ```ts
 * const db = createDependency<PrismaClient>({ client: prisma, ... });
 * type DbClient = InferInstance<typeof db>; // → PrismaClient
 * ```
 */
export type InferInstance<T extends Dependency> =
  T extends TypedDependency<infer U> ? U : never;

/**
 * Typed accessor surface for a service's managed dependencies.
 *
 * `DepsMap` is supplied via `ServiceContext.deps` inside the `register`
 * callback. Call `get(dep)` with the same dependency reference passed to
 * `createService` to retrieve its strongly-typed client instance.
 *
 * The return type is inferred via {@link InferInstance} — if `dep` is a
 * `TypedDependency<T>` the result is `T`; for plain `Dependency` objects
 * the result is `never`.
 *
 * @example
 * ```ts
 * const db = createDependency<PrismaClient>({ client: prisma, ... });
 *
 * await createService({
 *   dependencies: [db],
 *   register(app, { deps }) {
 *     const prisma = deps.get(db); // typed as PrismaClient
 *     app.get('/users', async (req, res) => {
 *       res.json(await prisma.user.findMany());
 *     });
 *   },
 * });
 * ```
 */
export interface DepsMap {
  /**
   * Retrieve the typed client instance for a registered dependency.
   *
   * @param dep - The dependency reference passed to `createService`.
   * @returns The strongly-typed client (`InferInstance<T>`) for the dependency.
   * @throws If `dep` was not registered in the `dependencies` array.
   */
  get<T extends Dependency>(dep: T): InferInstance<T>;
}

/**
 * A Proxy-wrapped client instance of type `T` paired with a `Dependency`.
 *
 * `TypedClient<T>` is the shape returned by `createHttpClient`. Every method
 * call on the `T` surface is transparently intercepted by the Proxy, which
 * applies retry logic and circuit-breaker protection before forwarding to the
 * underlying client. The `Dependency` side provides the standard lifecycle
 * surface (`status`, `start`, `stop`) so the client can be managed alongside
 * other dependencies in a uniform way.
 *
 * @typeParam T - The type of the underlying HTTP client or SDK instance whose
 *   methods are being proxied.
 *
 * @example
 * ```ts
 * const apiClient: TypedClient<MyApiSdk> = createHttpClient(new MyApiSdk(), {
 *   retry: { attempts: 3, backoff: 'exponential', jitter: true },
 * });
 *
 * // Lifecycle management — identical to any other Dependency:
 * await apiClient.start();
 * console.log(apiClient.status); // "running"
 *
 * // Proxied method call — retry + circuit-breaker applied automatically:
 * const result = await apiClient.someMethod();
 *
 * await apiClient.stop();
 * ```
 */
export type TypedClient<T> = T & Dependency;

/**
 * A map of named HTTP clients, keyed by string identifier.
 *
 * Use this to group all `createHttpClient`-produced clients for a service so
 * they can be managed (started, stopped, health-checked) uniformly alongside
 * regular dependencies.
 *
 * @example
 * ```ts
 * const clients: ClientsMap = {
 *   payments: createHttpClient(new PaymentsApiSdk(), { ... }),
 *   notifications: createHttpClient(new NotificationsApiSdk(), { ... }),
 * };
 *
 * await Promise.all(Object.values(clients).map(c => c.start()));
 * ```
 */
export type ClientsMap = Record<string, TypedClient<unknown>>;

/**
 * Configuration for the retry behaviour applied to each proxied method call
 * in `createHttpClient`.
 *
 * All fields are optional; safe defaults are applied when omitted:
 * - `attempts`: 3
 * - `backoff`: `"exponential"`
 * - `jitter`: `false`
 */
export interface RetryConfig {
  /**
   * Maximum number of attempts (including the initial call).
   * @default 3
   */
  attempts?: number;

  /**
   * Backoff strategy between attempts.
   * - `"exponential"` — delay doubles after each failure
   * - `"linear"` — delay is constant between attempts
   * @default "exponential"
   */
  backoff?: 'exponential' | 'linear';

  /**
   * When `true`, a random jitter is added to each backoff delay to reduce
   * thundering-herd pressure on the upstream service.
   * @default false
   */
  jitter?: boolean;
}

/**
 * Configuration for the circuit-breaker applied to each proxied method call
 * in `createHttpClient`.
 *
 * Safe defaults are applied when the field is omitted:
 * - `threshold`: 5 consecutive failures before opening the circuit
 * - `timeout`: 30 000 ms before transitioning from open → half-open
 */
export interface CircuitBreakerConfig {
  /**
   * Number of consecutive failures required to open the circuit.
   * @default 5
   */
  threshold?: number;

  /**
   * Milliseconds the circuit stays open before allowing a half-open probe.
   * @default 30000
   */
  timeout?: number;
}

/**
 * Plugin contract accepted by both the Express and MCP service factories.
 *
 * A `ServicePlugin` encapsulates a named unit of behaviour that is registered
 * against a transport-specific context (e.g. an Express `Application` or an
 * MCP `Server` instance). The generic `TContext` parameter lets each factory
 * specialise the plugin for its own runtime without coupling `service-core` to
 * any transport dependency.
 *
 * @typeParam TContext - The transport-specific context object supplied by the
 *   factory during registration (e.g. `express.Application`, `McpServer`).
 *   Defaults to `unknown` to remain transport-agnostic at the `service-core`
 *   level.
 *
 * @example
 * ```ts
 * // A transport-agnostic plugin definition:
 * const metricsPlugin: ServicePlugin = {
 *   name: 'metrics',
 *   async register(context) {
 *     // context is typed as `unknown` here; cast in transport-specific code
 *   },
 * };
 *
 * // A plugin typed for Express:
 * import type { Application } from 'express';
 * const corsPlugin: ServicePlugin<Application> = {
 *   name: 'cors',
 *   register(app) {
 *     app.use(cors());
 *   },
 * };
 * ```
 */
export interface ServicePlugin<TContext = unknown> {
  /**
   * Unique identifier for this plugin.
   * Used in logs, error messages, and to detect duplicate registrations.
   */
  readonly name: string;

  /**
   * Called once by the factory during service initialisation.
   * Receives the transport-specific `context` (e.g. Express app, MCP server)
   * so the plugin can attach routes, middleware, tools, or other transport
   * concerns.
   *
   * May return a `Promise` — the factory will `await` it before continuing
   * with the next plugin in registration order.
   *
   * @param context - The transport-specific context provided by the factory.
   */
  register(context: TContext): void | Promise<void>;
}

/**
 * Options accepted by `createHttpClient` to configure per-client resilience
 * behaviour.
 *
 * Both fields are optional. When omitted, safe defaults are applied:
 * - `retry`: 3 attempts with exponential backoff and no jitter
 * - `circuitBreaker`: threshold 5 / timeout 30 s
 *
 * @example
 * ```ts
 * const opts: HttpClientOpts = {
 *   retry: { attempts: 5, backoff: 'exponential', jitter: true },
 *   circuitBreaker: { threshold: 3, timeout: 10_000 },
 * };
 * const client = createHttpClient(new MyApiSdk(), opts);
 * ```
 */
export interface HttpClientOpts {
  /**
   * Retry configuration applied to every proxied method call.
   * Omit to use the default 3-attempt exponential-backoff policy.
   */
  retry?: RetryConfig;

  /**
   * Circuit-breaker configuration applied to every proxied method call.
   * Omit to use the default threshold-5 / 30 s-timeout policy.
   */
  circuitBreaker?: CircuitBreakerConfig;
}
