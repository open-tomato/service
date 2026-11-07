---
plan: logging-output-service
title: One core for every adapter
level: major
package: @open-tomato/service
---

- core: adds `TRACE_ID_PATTERN` and `isTraceId`, which decide whether an incoming request id may be used as a trace id; `StartupBanner.url` is now optional, and `logStarted` leaves `url` out of the `started` record when it is not set.
