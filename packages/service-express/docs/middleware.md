# middleware

`applyMiddleware(app, config, logger)` mounts the standard stack on an
Express app: helmet, cors, the JSON and URL-encoded body parsers,
cookie-parser, the rate limiter, then pino-http for the request log.

## The request log

pino-http writes through the `logger` it is given, the service logger
`createService` builds with `createLogger`, so request records carry the
service's bindings and go through its decorator. pino-http needs a pino
logger at runtime, so the logger must be one; the core `Logger` type alone
does not promise that. The `authorization`, `cookie` and `x-api-key` request
headers are redacted from every record.

## Request ids

`genRequestId(req, res)` picks each request's id: the `x-request-id` header
when the request carries a non-empty one, else a new `randomUUID()`. It sets
the same id on the response's `x-request-id` header. pino-http stores it as
`req.id`, and `customProps` binds it as `traceId` (the core's
`TRACE_ID_FIELD`) on `req.log`, so every record a route writes through
`req.log`, and the `request completed` record, carry it.

## Tests

`src/middleware.test.ts` runs the stack under supertest over a real pino
logger writing into memory. It reads that the request log goes through the
given logger, that credential headers are redacted (with the logged service
name as the control), that a given `x-request-id` is echoed and logged as
`traceId`, and that a missing or empty one gets a fresh UUID per request.
