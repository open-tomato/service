---
plan: health-rule-service
title: One health rule in the core, aggregateHealth
level: major
package: @open-tomato/service
---

- core: adds `aggregateHealth(dependencies, { started })`, which folds `{ name, status }` entries into `{ status, dependencies }` with the worst status winning: `running` is `ok`; `starting`, `degraded` and `paused` are `degraded`; `error` is `error`; `stopped` and `stopping` are `error` once the service has started and `degraded` before. `HEALTH_HTTP_STATUS` maps `ok` and `degraded` to 200 and `error` to 503, and two dependencies sharing a name keep the worse status
