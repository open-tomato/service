---
plan: retry-and-client-names-service-express
title: Retry and the breaker exported, and every HTTP client named
level: major
package: @open-tomato/service-express
---

- express: the re-exported `createHttpClient` requires `opts.name`, as the core's does
