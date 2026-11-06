---
plan: retry-and-client-names-service-express
title: Express on the shared core
level: major
package: @open-tomato/service-express
---

- express: the re-exported `createHttpClient` requires `opts.name`, as the core's does
