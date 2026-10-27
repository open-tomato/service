import type { ResolvedServiceConfig } from './schema.js';
import type { DepsMap, Logger, TypedClient } from '@open-tomato/service';
import type { Application, RequestHandler } from 'express';

/**
 * The handle returned by `createService`.
 *
 * Holds a reference to the underlying Express application and a `stop()`
 * method that gracefully shuts down the HTTP server and all registered
 * dependencies in reverse-start order.
 */
export interface ServiceHandle {
  /** The underlying Express application instance. */
  app: Application
  /**
   * Gracefully stop the service: close the HTTP server, drain in-flight
   * requests, and stop all dependencies in reverse-start order.
   */
  stop(): Promise<void>
}

/**
 * The context object passed to the `register` callback and plugins.
 *
 * Provides access to the logger, auth middleware, dependency accessor,
 * client accessor, and resolved configuration for the running service.
 */
export interface ServiceContext {
  /** Structured logger scoped to this service's `serviceId`. */
  logger: Logger
  /**
   * Express middleware that requires a valid session.
   * Returns a passthrough when no `auth` config is provided.
   */
  requireAuth: RequestHandler
  /**
   * Express middleware that accepts requests with or without a session.
   * Returns a passthrough when no `auth` config is provided.
   */
  optionalAuth: RequestHandler
  /** Typed accessor for dependencies registered in `createService`. */
  deps: DepsMap
  /** Typed accessor for HTTP clients registered in `createService`. */
  clients: ClientsMap
  /** The resolved (parsed and defaulted) service configuration. */
  config: ResolvedServiceConfig
}

/**
 * Typed accessor surface for a service's managed HTTP clients.
 *
 * `ClientsMap` is supplied via `ServiceContext.clients` inside the `register`
 * callback. Call `get(client)` with the same client reference passed to
 * `createService` to retrieve the typed client instance.
 *
 * @example
 * ```ts
 * const api = createHttpClient(new MyApiSdk(), { retry: { attempts: 3 } })
 *
 * await createService({
 *   clients: [api],
 *   register(app, { clients }) {
 *     const sdk = clients.get(api) // typed as MyApiSdk
 *     app.get('/data', async (req, res) => res.json(await sdk.fetchData()))
 *   },
 * })
 * ```
 */
export interface ClientsMap {
  /**
   * Retrieve the typed client instance for a registered HTTP client.
   *
   * @param client - The client reference passed to `createService`.
   * @returns The typed client instance `T`.
   * @throws If `client` was not registered in the `clients` array.
   */
  get<T>(client: TypedClient<T>): T
}

// ResolvedServiceConfig is inferred from the Zod schema — re-exported from schema.ts
export type { ResolvedServiceConfig } from './schema.js';
