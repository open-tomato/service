---
plan: retry-and-client-names-service
title: One core for every adapter
level: major
package: @open-tomato/service
---

- core: exports `withRetry`, `CircuitBreaker` and the `CircuitState` type, so a call that is not a client method can use the same retry policy and breaker
- core: `createHttpClient(client, opts)` requires `opts.name`, a non-empty string it uses as the client's dependency name, and throws a `TypeError` naming `opts.name` without one; every client was named `http-client` before, so health reports could not tell two apart
