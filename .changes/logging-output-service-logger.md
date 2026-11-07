---
plan: logging-output-service-logger
title: Where log lines go and what they carry
level: major
package: @open-tomato/service-logger
---

- logger: `createLogger` takes a `destination` option, `'stdout'` (default) or `'stderr'`, which picks the stream records go to and whose TTY decides the default format (ignored by the browser entry); `json` records are now written synchronously through the chosen stream's `write`, like `terminal` lines. `createHttpLogger` writes `traceId` in place of `requestId`, replaces an `x-request-id` outside `[A-Za-z0-9._:-]{1,64}` with a new UUID, and a crumb logged through `req.log` no longer carries `req`, while the completion line still has `req`, `res` and `responseTime` under the same `traceId`. The `terminal` format draws a request outcome as one short tail, such as `POST /users → 201 3ms`, in place of `req=`, `res=` and `responseTime=` fields, and recognises the `started` banner by its `transport`, so a banner with no `url` still draws as one.
