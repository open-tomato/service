---
plan: logger-type-service-express
title: Express on the shared core
level: major
package: @open-tomato/service-express
---

- express: creates its logger with `createLogger` from `@open-tomato/service-logger`, which it now depends on directly
