---
plan: runtime-service
title: One core for every adapter
level: major
package: @open-tomato/service
---

- core: adds `createRuntime({ serviceId, dependencies, clients, logger, stopTimeoutMs })`, which gives each named entry back under its key with its own type. `ensureStarted()` starts dependencies, then clients, once, and on a failure stops the ones already started, in reverse; `stop()` stops in reverse, gives each entry `stopTimeoutMs` (10 000 by default) and never rejects; `health()` is `aggregateHealth` over every entry. A blank `serviceId`, a bad `stopTimeoutMs` or two entries sharing a name throw a `TypeError`
