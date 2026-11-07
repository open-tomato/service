# Changelog

## 2.0.0 — 2026-11-07, Where log lines go and what they carry
<!-- rafa:fragments breadcrumb-hierarchy-service-logger logging-output-service-logger startup-ports-logging-service-logger -->

- logger: the `terminal` decorator draws domain, scope and step as one signature slot joined by `:`, such as `Users:create:insert`, in place of the scope slot.
- logger: `createLogger` takes a `destination` option, `'stdout'` (default) or `'stderr'`, which picks the stream records go to and whose TTY decides the default format (ignored by the browser entry); `json` records are now written synchronously through the chosen stream's `write`, like `terminal` lines. `createHttpLogger` writes `traceId` in place of `requestId`, replaces an `x-request-id` outside `[A-Za-z0-9._:-]{1,64}` with a new UUID, and a crumb logged through `req.log` no longer carries `req`, while the completion line still has `req`, `res` and `responseTime` under the same `traceId`. The `terminal` format draws a request outcome as one short tail, such as `POST /users → 201 3ms`, in place of `req=`, `res=` and `responseTime=` fields, and recognises the `started` banner by its `transport`, so a banner with no `url` still draws as one.
- logger: `createLogger` now writes readable terminal lines when stdout is a TTY and JSON otherwise, picked outright by the new `format` option or `LOG_FORMAT` (`pretty` is a deprecated alias, and `NODE_ENV` no longer matters); the new `terminal` decorator draws one coloured line per record with the short trace id and scope, an error's cause chain and a startup banner block, while `json` keeps pino's line as is and logged errors keep their cause chain as nested objects; the package now depends on `@open-tomato/service` and no longer on `pino-pretty`.
- docs: the README states the level rule for steps
- docs: the README documents `LOG_FORMAT`, `traceId` and `scoped`

## 1.0.1 — 2026-10-28, README with examples on the npm page
<!-- rafa:fragments npm-readme-service-logger -->

- docs: the npm page shows what the package does, worked examples and its options

## 1.0.0 — 2026-10-27, First public release
<!-- rafa:fragments first-release-logger -->

- logger: pino logger with header redaction, Node and browser entries
