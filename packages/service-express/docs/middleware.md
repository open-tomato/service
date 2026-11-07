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
when the core's `isTraceId` accepts it (`[A-Za-z0-9._:-]{1,64}`, the core's
`TRACE_ID_PATTERN`), else a new `randomUUID()`. A header that is missing,
empty, holds a space or runs past 64 characters is replaced, never logged.
It sets the id it chose on the response's `x-request-id` header, so a caller
whose id was refused reads the replacement there.

pino-http stores the id as `req.id` and runs with `quietReqLogger: true` and
`customAttributeKeys: { reqId: TRACE_ID_FIELD }`. So `req.log` binds only
`traceId` (the core's `TRACE_ID_FIELD`): a crumb a route writes through
`req.log` carries `traceId` and not the whole request. The `request completed`
line is written through a child of that logger, and carries `req`, `res` and
`responseTime` with `traceId` once.

## Tests

`src/middleware.test.ts` runs the stack under supertest over a real pino
logger writing into memory. It reads that the request log goes through the
given logger, that credential headers are redacted (with the logged service
name as the control), that a valid `x-request-id` is echoed and logged as
`traceId`, that a missing, empty, spaced or 65-character one is replaced by
a fresh UUID the response echoes, that a crumb through `req.log` holds
`traceId` and no `req`, and that the `request completed` record holds `req`,
`res` and `responseTime`, with the `"traceId"` key once in its raw JSON line.
`tests/breadcrumb.integration.test.ts` reads the same through
`scoped(inDomain(req.log, 'Users'), 'create')`, concurrent requests included.
`tests/terminal-lines.integration.test.ts` runs the stack under the `terminal`
format and checks that each request draws short lines, with no `req=` or
`res=` and one `POST /users → 201 Nms` tail.
