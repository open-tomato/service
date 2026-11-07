---
plan: logger-type-service
title: One core for every adapter
level: major
package: @open-tomato/service
---

- core: defines its own `Logger` and `LogLevel` types and a dependency-free `createConsoleLogger`, and no longer imports pino or `@open-tomato/service-logger`, so it loads in a Next.js route or a Worker; the package declares `sideEffects: false`, and `readEnv` reads `LOG_LEVEL` through `globalThis.process`
- core: no longer exports `createServiceLogger`, `LoggerOptions` or `ServiceLogger`; create a logger with `createLogger` from `@open-tomato/service-logger`. The context logger no longer promises a `level` field
