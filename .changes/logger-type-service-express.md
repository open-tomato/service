---
plan: logger-type-service-express
title: The core owns its Logger type and drops pino
level: major
package: @open-tomato/service-express
---

- express: creates its logger with `createLogger` from `@open-tomato/service-logger`, which it now depends on directly
