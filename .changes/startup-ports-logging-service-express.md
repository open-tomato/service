---
plan: startup-ports-logging-service-express
title: Startup ports, the startup banner and readable terminal logs
level: major
package: @open-tomato/service-express
---

- express: `createService` falls back to the next free port with a warning when its port is taken, rejects with `PortInUseError` under the new `strictPort` (or `PORT_STRICT`), reads `PORT` when the config omits the port, logs a `started` banner with the new `features` config, and returns the bound `port` and `url` on its handle; under `NODE_ENV=test` a port given in config or `PORT` is now honoured; request logs go through the service logger, with an `x-request-id` taken from the request or a new UUID, echoed on the response and logged as `traceId`.
- docs: the README documents the port and strict settings with their env names, the fallback warning, the `started` banner, the handle's port and URL, and `traceId`
