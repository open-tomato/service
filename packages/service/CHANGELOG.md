# Changelog

## 2.0.0 — 2026-11-07, One core for every adapter
<!-- rafa:fragments banner-service-once-service breadcrumb-hierarchy-service config-schema-service control-operations-service error-body-service health-rule-service logger-type-service logging-output-service retry-and-client-names-service runtime-service startup-ports-logging-service -->

- core: `StartupBanner` no longer has a `service` field, and `logStarted` writes none, also dropping a `service` key from `extra`. Every logger of the family binds `service` on each line, and pino wrote the key a second time when the record carried it too. A caller that passed `service` removes it; the line still names the service, from the logger.
- core: `scoped(logger, scope)` now takes the entry point's scope alone and binds it as given, and the new `inDomain(logger, domain)` binds the domain above it, as in `scoped(inDomain(logger, 'Users'), 'create')`; a call's step goes in its context object and is never bound. The core exports `DOMAIN_FIELD` and `STEP_FIELD` beside `TRACE_ID_FIELD` and `SCOPE_FIELD`, `LogBreadcrumb` types the `domain` and `step` fields, and the README documents the helpers, the field constants and the case convention.
- core: adds `BaseServiceConfigSchema`, the config every adapter shares (`serviceId`, `version`, `dependencies` and `clients` as records by key, `control` and `stopTimeoutMs`), which an adapter extends with `.extend()`. A 1.x `dependencies` array is refused with a message naming the record form, and an enabled control plane needs a non-empty secret; `zod` becomes the core's one dependency
- core: adds the control operations as functions over a runtime, each answering a status and a body for any transport to send: `controlStatus`, `listDependencies`, `pauseDependency`, `resumeDependency`, `restartDependency` and `resetClient`. The status reports the `aggregateHealth` status, and the version comes from the caller
- core: `verifyControlToken(given, expected)` compares SHA-256 digests made through `crypto.subtle` in constant time, and rejects a token that is not a string and every token when the secret is empty
- core: the error classes move into the core, and `toErrorResponse` turns anything thrown into a status and one body, `{ code, message, details? }`: an `AppError` answers with its own status and body, a `ZodError` with its issues, a 4xx error with its own code, message and details, and an open circuit with 503, while a 5xx never sends the error's own message, code or details. It never throws
- core: `parseApiError` reads a failed `Response` into that body and its status, a 1.x `{ error }` body and a body that is not JSON included, and the control operations fail with the same body
- core: adds `aggregateHealth(dependencies, { started })`, which folds `{ name, status }` entries into `{ status, dependencies }` with the worst status winning: `running` is `ok`; `starting`, `degraded` and `paused` are `degraded`; `error` is `error`; `stopped` and `stopping` are `error` once the service has started and `degraded` before. `HEALTH_HTTP_STATUS` maps `ok` and `degraded` to 200 and `error` to 503, and two dependencies sharing a name keep the worse status
- core: defines its own `Logger` and `LogLevel` types and a dependency-free `createConsoleLogger`, and no longer imports pino or `@open-tomato/service-logger`, so it loads in a Next.js route or a Worker; the package declares `sideEffects: false`, and `readEnv` reads `LOG_LEVEL` through `globalThis.process`
- core: no longer exports `createServiceLogger`, `LoggerOptions` or `ServiceLogger`; create a logger with `createLogger` from `@open-tomato/service-logger`. The context logger no longer promises a `level` field
- core: adds `TRACE_ID_PATTERN` and `isTraceId`, which decide whether an incoming request id may be used as a trace id; `StartupBanner.url` is now optional, and `logStarted` leaves `url` out of the `started` record when it is not set.
- core: exports `withRetry`, `CircuitBreaker` and the `CircuitState` type, so a call that is not a client method can use the same retry policy and breaker
- core: `createHttpClient(client, opts)` requires `opts.name`, a non-empty string it uses as the client's dependency name, and throws a `TypeError` naming `opts.name` without one; every client was named `http-client` before, so health reports could not tell two apart
- core: adds `createRuntime({ serviceId, dependencies, clients, logger, stopTimeoutMs })`, which gives each named entry back under its key with its own type. `ensureStarted()` starts dependencies, then clients, once, and on a failure stops the ones already started, in reverse; `stop()` stops in reverse, gives each entry `stopTimeoutMs` (10 000 by default) and never rejects; `health()` is `aggregateHealth` over every entry. A blank `serviceId`, a bad `stopTimeoutMs` or two entries sharing a name throw a `TypeError`
- core: adds `pickPort` and `PortInUseError` (take the asked port, or fall back to the next free one of 20, with an error naming the port and the config key that sets it), `logStarted` and `StartupBanner` for a single `started` record once a service listens, and the `traceId` and `scope` breadcrumb field names.
- docs: the logger docs state the level rule for steps

## 1.0.2 — 2026-10-28, README with examples on the npm page
<!-- rafa:fragments npm-readme-service -->

- docs: the npm page shows what the package does, worked examples and its options

## 1.0.1 — 2026-10-28, Installs: sibling ranges name the released version
<!-- rafa:fragments installable-ranges-service -->

- core: the published manifest requires ^1.0.0 of its @open-tomato siblings; 1.0.0 required ^0.0.0 and did not install

## 1.0.0 — 2026-10-27, First public release
<!-- rafa:fragments first-release-service -->

- core: dependency lifecycle, typed HTTP clients, retry with backoff and a circuit breaker
