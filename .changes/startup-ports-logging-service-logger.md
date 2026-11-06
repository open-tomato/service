---
plan: startup-ports-logging-service-logger
title: Startup ports, the startup banner and readable terminal logs
level: major
package: @open-tomato/service-logger
---

- logger: `createLogger` now writes readable terminal lines when stdout is a TTY and JSON otherwise, picked outright by the new `format` option or `LOG_FORMAT` (`pretty` is a deprecated alias, and `NODE_ENV` no longer matters); the new `terminal` decorator draws one coloured line per record with the short trace id and scope, an error's cause chain and a startup banner block, while `json` keeps pino's line as is and logged errors keep their cause chain as nested objects; the package now depends on `@open-tomato/service` and no longer on `pino-pretty`.
- docs: the README documents `LOG_FORMAT`, `traceId` and `scoped`
