import type { ControlConfig } from './control/types.js';
import type { ServiceContext } from './types.js';
import type { Dependency, ServicePlugin } from '@open-tomato/service';
import type { Application } from 'express';

import { z } from 'zod';

/**
 * Zod schema for the configuration accepted by `createService`.
 *
 * All fields with `.default()` are optional at call-time and will be
 * populated with the stated default when omitted.
 */
export const ServiceConfigSchema = z.object({
  /** Unique identifier for this service — used in logs and health endpoints. */
  serviceId: z.string(),
  /**
   * Route/middleware registration callback.
   * Receives the Express app and a fully-constructed {@link ServiceContext}.
   * May return a `Promise` — `createService` will await it.
   */
  register: z.custom<(app: Application, ctx: ServiceContext) => void | Promise<void>>(),

  /** TCP port the HTTP server listens on. @default 3000 */
  port: z.number().default(3000),
  /**
   * Session introspection configuration.
   * When provided, `requireAuth` and `optionalAuth` validate sessions against
   * `introspectUrl`, authenticating each introspect call with
   * `introspectSecret`. When omitted, both middleware are no-ops.
   *
   * `introspectSecret` is required *within* this optional block: a config
   * that sets `introspectUrl` but forgets the secret would otherwise boot
   * successfully and then silently 401 every authenticated request forever
   * — this schema rejects that config at boot instead. The secret is a
   * shared credential between this service and the auth service's
   * `/introspect` endpoint, not an end-user token. It comes from the
   * consumer's own environment (e.g. an env var) and must NEVER be
   * hardcoded or committed to `service.config.yaml`.
   *
   * The 32-byte floor mirrors the bar the auth service holds this exact
   * secret to via `requireStrongSecret` (see
   * `services/auth/src/config/secret-env.ts`, `MIN_SECRET_BYTES`) — without
   * it, `.min(1)` let a consumer satisfy the schema with a literal like
   * `"x"`, which made the JSDoc warning above purely advisory. Confirmed
   * against the auth service's own dev default
   * (`DEV_INTROSPECT_SECRET`, 45 bytes) so local development keeps working.
   */
  auth: z.object({ introspectUrl: z.string(), introspectSecret: z.string().min(32) }).optional(),
  /**
   * CORS configuration.
   * When provided, the CORS middleware allows the listed origins.
   * When omitted, cross-origin requests are denied (`origin: false`).
   */
  cors: z.object({ origins: z.array(z.string()) }).optional(),
  /**
   * Rate-limiting configuration applied globally via `express-rate-limit`.
   * When omitted, defaults to 100 requests per 60 s window.
   */
  rateLimit: z.object({ max: z.number(), windowMs: z.number() }).optional(),
  /**
   * Request-body parser configuration.
   * When omitted, defaults to `'1mb'` limit.
   */
  body: z.object({ limit: z.string() }).optional(),
  /**
   * Graceful-shutdown configuration.
   * When omitted, a 10 s drain timeout is used.
   */
  shutdown: z.object({ drainTimeout: z.number() }).optional(),
  /**
   * Managed dependencies started before `register` is called and stopped
   * (in reverse order) when `stop()` is invoked.
   * @default []
   */
  dependencies: z.custom<Dependency[]>().default(() => []),
  /**
   * HTTP clients managed alongside regular dependencies.
   * Accessible via `ServiceContext.clients.get(client)`.
   * @default []
   */
  clients: z.custom<Dependency[]>().default(() => []),
  /**
   * Service plugins applied in array order after middleware and built-in
   * routes but before `register`.
   *
   * Each plugin's `register` method receives `{ app, ...ctx }` — the Express
   * application merged with the full {@link ServiceContext} — so plugins can
   * mount routes and access `ctx.logger`, `ctx.deps`, etc.
   * @default []
   */
  plugins: z.custom<ServicePlugin<{ app: Application } & ServiceContext>[]>().default(() => []),
  /**
   * Operator control-plane configuration.
   * When enabled, mounts `/_control/*` routes protected by `secret`.
   * See {@link ControlConfig} for field descriptions.
   */
  control: z.object({ enabled: z.boolean(), secret: z.string() })
    .refine(
      (val) => !val.enabled || val.secret.length > 0,
      { message: 'control.secret must be a non-empty string when the control plane is enabled', path: ['secret'] },
    )
    .optional() as z.ZodOptional<z.ZodType<ControlConfig>>,
});

/** Raw (call-time) input shape — all defaulted fields are optional. */
export type ServiceConfig = z.input<typeof ServiceConfigSchema>;
/** Resolved (post-parse) shape — all defaulted fields are present. */
export type ResolvedServiceConfig = z.output<typeof ServiceConfigSchema>;
