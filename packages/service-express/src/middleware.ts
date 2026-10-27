import type { ResolvedServiceConfig } from './schema.js';
import type { ServiceLogger } from '@open-tomato/service';
import type { Application, ErrorRequestHandler } from 'express';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import expressRateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pino from 'pino';
import { pinoHttp } from 'pino-http';

/** Request headers that carry credentials, removed from every request log entry. */
const REDACTED_HEADERS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
];

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
 * 7. `pino-http` — HTTP request/response logging via a dedicated pino instance
 *
 * @param app - The Express application to configure.
 * @param config - Resolved service configuration.
 * @param logger - The service logger; used to emit a startup trace and available for
 *   future middleware that needs access to the service logger.
 */
export function applyMiddleware(
  app: Application,
  config: ResolvedServiceConfig,
  logger: ServiceLogger,
): void {
  logger.debug({ serviceId: config.serviceId }, 'applying middleware');
  const httpLogger = pino({ name: config.serviceId });
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
  app.use(pinoHttp({ logger: httpLogger, redact: REDACTED_HEADERS }));
}

/** The first status code of the server-error range. */
const SERVER_ERROR_STATUS = 500;

/** The only message a server error sends to the client. */
const GENERIC_SERVER_ERROR = 'Internal Server Error';

type HttpError = {
  status?: number;
  statusCode?: number;
  message?: string;
};

/**
 * Express error-handling middleware that converts thrown errors into JSON responses.
 *
 * Must be registered **after** all route handlers:
 * ```ts
 * app.use(errorHandler)
 * ```
 *
 * Reads `err.status` or `err.statusCode` for the HTTP status; falls back to 500.
 * A client error (4xx) answers with the error's message. A server error (5xx)
 * answers with a fixed message, because its text can carry internal detail.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const httpErr = err as HttpError;
  const status = httpErr.status ?? httpErr.statusCode ?? 500;
  const message = status < SERVER_ERROR_STATUS
    ? httpErr.message ?? GENERIC_SERVER_ERROR
    : GENERIC_SERVER_ERROR;
  res.status(status).json({ error: message });
};
