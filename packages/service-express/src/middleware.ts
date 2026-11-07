import type { ResolvedServiceConfig } from './schema.js';
import type { Logger } from '@open-tomato/service';
import type { Application } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger as PinoLogger } from 'pino';

import { randomUUID } from 'node:crypto';

import { isTraceId, TRACE_ID_FIELD } from '@open-tomato/service';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import expressRateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

/** Request headers that carry credentials, removed from every request log entry. */
const REDACTED_HEADERS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
];

/** The header a request id arrives on and the response answers with. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Picks the id of a request: its `x-request-id` header when `isTraceId` from
 * `@open-tomato/service` accepts it (`[A-Za-z0-9._:-]{1,64}`), else a new UUID.
 * The response answers with the id chosen, on `x-request-id`.
 *
 * @param req - The incoming request.
 * @param res - The response the id is echoed on.
 * @returns The request id pino-http stores as `req.id`.
 */
export function genRequestId(req: IncomingMessage, res: ServerResponse): string {
  const header = req.headers[REQUEST_ID_HEADER];
  const id = isTraceId(header)
    ? header
    : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

/**
 * Attaches the standard middleware stack to the given Express app.
 *
 * Applied in order:
 * 1. `helmet` — sets secure HTTP headers
 * 2. `cors` — configures allowed origins from `config.cors`; denies all cross-origin when omitted
 * 3. `express.json` — parses JSON bodies up to `config.body.limit` (default `'1mb'`)
 * 4. `express.urlencoded` — parses URL-encoded bodies
 * 5. `cookie-parser` — parses Cookie headers
 * 6. `express-rate-limit` — limits requests per window (default 100 req / 60 s)
 * 7. `pino-http` — request/response logging through the service logger; each request
 *    gets an id from {@link genRequestId}, and `req.log` binds only that id, as
 *    `traceId` (`quietReqLogger`), so a crumb carries no `req`; the
 *    `request completed` line carries `req`, `res` and `responseTime` under the
 *    same `traceId`
 *
 * @param app - The Express application to configure.
 * @param config - Resolved service configuration.
 * @param logger - The service logger. pino-http writes through it, so it must be a
 *   pino logger at runtime, as `createLogger` from service-logger returns.
 */
export function applyMiddleware(
  app: Application,
  config: ResolvedServiceConfig,
  logger: Logger,
): void {
  logger.debug({ serviceId: config.serviceId }, 'applying middleware');
  app.use(helmet());
  app.use(cors(config.cors
    ? { origin: config.cors.origins }
    : { origin: false }));
  app.use(express.json({ limit: config.body?.limit ?? '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(
    expressRateLimit(
      config.rateLimit ?? { max: 100, windowMs: 60_000, standardHeaders: true, legacyHeaders: false },
    ),
  );
  app.use(pinoHttp({
    logger: logger as unknown as PinoLogger,
    redact: REDACTED_HEADERS,
    genReqId: genRequestId,
    quietReqLogger: true,
    customAttributeKeys: { reqId: TRACE_ID_FIELD },
  }));
}

