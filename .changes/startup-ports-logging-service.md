---
plan: startup-ports-logging-service
title: One core for every adapter
level: major
package: @open-tomato/service
---

- core: adds `pickPort` and `PortInUseError` (take the asked port, or fall back to the next free one of 20, with an error naming the port and the config key that sets it), `logStarted` and `StartupBanner` for a single `started` record once a service listens, and the `traceId` and `scope` breadcrumb field names.
