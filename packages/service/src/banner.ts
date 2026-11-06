/** The startup banner: one `info` record an adapter writes once it listens. */
import type { Logger } from './logger.js';

/** A feature flag value the banner can show. */
export type BannerFeatureValue = string | number | boolean;

/**
 * What a service says about itself once it listens.
 *
 * The service name is not here: every logger of the family binds `service` on each line, so the
 * `started` record gets it from the logger it is written to.
 */
export interface StartupBanner {
  /** The service version, or `unknown`. */
  readonly version: string;
  /** How the service is reached, such as `http` or `mcp`. */
  readonly transport: string;
  /**
   * The URL the service listens on; left out by a service with no address,
   * such as one on stdio.
   */
  readonly url?: string;
  /** The features the service runs with. */
  readonly features: Readonly<Record<string, BannerFeatureValue>>;
  /** The port that was asked for, set only when the service fell back from it. */
  readonly fallbackPort?: number;
  /**
   * Further fields the adapter adds; the named fields above win over them, and a `service` key
   * is dropped, because the logger already writes it.
   */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** The message of the startup record. */
export const STARTED_MESSAGE = 'started';

/** The field every logger of the family binds with the service name. */
const SERVICE_FIELD = 'service';

/**
 * Writes the startup banner as one `info` record with message `started`.
 *
 * `url` and `fallbackPort` are written only when the banner sets them. The service name comes
 * from the logger's own `service` binding; pino writes a key once for the binding and once more
 * for a record field of the same name, so the record never carries it.
 *
 * @param logger - The logger to write to.
 * @param banner - What the service says about itself.
 *
 * @example
 * ```ts
 * import { createConsoleLogger, logStarted } from '@open-tomato/service';
 *
 * logStarted(createConsoleLogger('users'), {
 *   version: '1.0.0',
 *   transport: 'http',
 *   url: 'http://localhost:3000',
 *   features: {},
 * });
 * ```
 */
export function logStarted(logger: Logger, banner: StartupBanner): void {
  const extra = Object.fromEntries(
    Object.entries(banner.extra ?? {}).filter(([key]) => key !== SERVICE_FIELD),
  );
  const record = {
    ...extra,
    version: banner.version,
    transport: banner.transport,
    ...(banner.url === undefined
      ? {}
      : { url: banner.url }),
    features: banner.features,
    ...(banner.fallbackPort === undefined
      ? {}
      : { fallbackPort: banner.fallbackPort }),
  };
  logger.info(record, STARTED_MESSAGE);
}
