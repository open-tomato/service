---
plan: logging-output-service-express
title: Where log lines go and what they carry
level: major
package: @open-tomato/service-express
---

- express: A crumb logged through `req.log` no longer carries `req`; the `request completed` line still carries `req`, `res` and `responseTime` under the same `traceId`. An `x-request-id` outside `[A-Za-z0-9._:-]{1,64}` is replaced by a new UUID, which the response echoes.
