import type { DependencyRecord } from './runtime.js';
import type { Dependency } from './types.js';

import { z } from 'zod';

/** Whether `value` has the `Dependency` surface the runtime calls. */
function isDependency(value: unknown): value is Dependency {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['name'] === 'string'
    && typeof candidate['status'] === 'string'
    && typeof candidate['start'] === 'function'
    && typeof candidate['stop'] === 'function';
}

/** Whether `value` is a plain record whose every value is a `Dependency`. */
function isDependencyRecord(value: unknown): value is DependencyRecord {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every(isDependency);
}

/** A record of dependencies or clients, defaulting to an empty one. */
function dependencyRecord(field: 'dependencies' | 'clients') {
  return z.custom<DependencyRecord>(isDependencyRecord, {
    error: `${field} must be a record of Dependency objects by key; 1.x arrays are no longer accepted`,
  }).default(() => ({}));
}

/**
 * The control plane's settings: whether it answers at all, and the shared
 * secret a caller sends. The secret must be non-empty while it is enabled.
 */
export const ControlConfigSchema = z.object({
  enabled: z.boolean(),
  secret: z.string(),
}).refine(
  (value) => !value.enabled || value.secret.length > 0,
  { error: 'control.secret must be a non-empty string when the control plane is enabled', path: ['secret'] },
);

/** The control plane's settings, as {@link ControlConfigSchema} gives them. */
export type ControlConfig = z.output<typeof ControlConfigSchema>;

/**
 * The config every adapter shares, for each to `.extend()` with its own
 * fields.
 *
 * - `serviceId` — required, non-blank
 * - `version` — the service's version, reported by the control status;
 *   defaults to `"unknown"`
 * - `dependencies`, `clients` — records of `Dependency` objects by key, as
 *   `createRuntime` takes them; default to empty. A 1.x array is rejected.
 * - `control` — optional {@link ControlConfigSchema}
 * - `stopTimeoutMs` — optional, 0 or more; `createRuntime` defaults it
 *
 * @example
 * ```ts
 * const ServiceConfigSchema = BaseServiceConfigSchema.extend({ port: z.number().default(3000) });
 * ```
 */
export const BaseServiceConfigSchema = z.object({
  serviceId: z.string().refine((value) => value.trim() !== '', { error: 'serviceId must be a non-empty string' }),
  version: z.string().min(1)
    .default('unknown'),
  dependencies: dependencyRecord('dependencies'),
  clients: dependencyRecord('clients'),
  control: ControlConfigSchema.optional(),
  stopTimeoutMs: z.number().nonnegative()
    .optional(),
});

/** The base config as a caller writes it, defaults optional. */
export type BaseServiceConfig = z.input<typeof BaseServiceConfigSchema>;

/** The base config after parsing, defaults filled in. */
export type ResolvedBaseServiceConfig = z.output<typeof BaseServiceConfigSchema>;
