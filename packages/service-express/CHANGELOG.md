# Changelog

## 2.0.0 — 2026-11-07, Express on the shared core
<!-- rafa:fragments banner-service-once-service-express breadcrumb-hierarchy-service-express error-handler-service-express logger-type-service-express logging-output-service-express retry-and-client-names-service-express startup-ports-logging-service-express -->

- express: the `started` line carries `service` once.
- express: a route that throws is answered with the core's `{ code, message, details? }` body, built by `toErrorResponse`, in place of `{ error }`; the control routes keep `{ error }` for now
- express: `createErrorHandler(logger, format?)` writes one line per error through the service logger, a warning with the code for a 4xx and an error with the hidden name, code, reason and stack for a 5xx, and a logger that throws never costs the caller the response
- express: `config.formatError` replaces the default rule and falls back to it when it throws, and the error classes and `toErrorResponse` are re-exported
- express: creates its logger with `createLogger` from `@open-tomato/service-logger`, which it now depends on directly
- express: A crumb logged through `req.log` no longer carries `req`; the `request completed` line still carries `req`, `res` and `responseTime` under the same `traceId`. An `x-request-id` outside `[A-Za-z0-9._:-]{1,64}` is replaced by a new UUID, which the response echoes.
- express: the re-exported `createHttpClient` requires `opts.name`, as the core's does
- express: `createService` falls back to the next free port with a warning when its port is taken, rejects with `PortInUseError` under the new `strictPort` (or `PORT_STRICT`), reads `PORT` when the config omits the port, logs a `started` banner with the new `features` config, and returns the bound `port` and `url` on its handle; under `NODE_ENV=test` a port given in config or `PORT` is now honoured; request logs go through the service logger, with an `x-request-id` taken from the request or a new UUID, echoed on the response and logged as `traceId`.
- docs: the README shows the `inDomain` and `scoped` chain with a step per call
- docs: the README documents the port and strict settings with their env names, the fallback warning, the `started` banner, the handle's port and URL, and `traceId`

## 1.0.2 — 2026-10-28, README with examples on the npm page
<!-- rafa:fragments npm-readme-service-express -->

- docs: the npm page shows what the package does, worked examples and its options

## 1.0.1 — 2026-10-28, Installs: sibling ranges name the released version
<!-- rafa:fragments installable-ranges-service-express -->

- express: the published manifest requires ^1.0.0 of its @open-tomato siblings; 1.0.0 required ^0.0.0 and did not install

## 1.0.0 — 2026-10-27, First public release
<!-- rafa:fragments first-release-express -->

- express: Express 5 service with security middleware, health and control routes, graceful shutdown
