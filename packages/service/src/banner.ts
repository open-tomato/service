/** The startup banner: one `info` record an adapter writes once it listens. */
import type { Logger } from './logger.js';

/** A feature flag value the banner can show. */
export type BannerFeatureValue = string | number | boolean;

/** What a service says about itself once it listens. */
export interface StartupBanner {
  /** The service name. */
  readonly service: string;
  /** The service version, or `unknown`. */
  readonly version: string;
  /** How the service is reached, such as `http` or `mcp`. */
  readonly transport: string;
  /** The URL the service listens on. */
  readonly url: string;
  /** The features the service runs with. */
  readonly features: Readonly<Record<string, BannerFeatureValue>>;
  /** The port that was asked for, set only when the service fell back from it. */
  readonly fallbackPort?: number;
  /** Further fields the adapter adds; the named fields above win over them. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** The message of the startup record. */
export const STARTED_MESSAGE = 'started';

/**
 * Writes the startup banner as one `info` record with message `started`.
 *
 * @param logger - The logger to write to.
 * @param banner - What the service says about itself.
 *
 * @example
 * ```ts
 * import { createConsoleLogger, logStarted } from '@open-tomato/service';
 *
 * logStarted(createConsoleLogger(), {
 *   service: 'users',
 *   version: '1.0.0',
 *   transport: 'http',
 *   url: 'http://localhost:3000',
 *   features: {},
 * });
 * ```
 */
export function logStarted(logger: Logger, banner: StartupBanner): void {
  const record = {
    ...banner.extra,
    service: banner.service,
    version: banner.version,
    transport: banner.transport,
    url: banner.url,
    features: banner.features,
    ...(banner.fallbackPort === undefined
      ? {}
      : { fallbackPort: banner.fallbackPort }),
  };
  logger.info(record, STARTED_MESSAGE);
}
