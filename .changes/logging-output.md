---
plan: logging-output
title: Where log lines go and what they carry
level: minor
---

- @open-tomato/service: Adds `TRACE_ID_PATTERN` and `isTraceId`, which decide whether an incoming request id may be used as a trace id; `StartupBanner.url` is now optional, and `logStarted` leaves `url` out of the `started` record when it is not set.
- @open-tomato/service-logger: `createLogger` takes a `destination` option, `'stdout'` (default) or `'stderr'`, which picks the stream records go to and whose TTY decides the default format (ignored by the browser entry); `json` records are now written synchronously through the chosen stream's `write`, like `terminal` lines. `createHttpLogger` writes `traceId` in place of `requestId`, replaces an `x-request-id` outside `[A-Za-z0-9._:-]{1,64}` with a new UUID, and a crumb logged through `req.log` no longer carries `req`, while the completion line still has `req`, `res` and `responseTime` under the same `traceId`. The `terminal` format draws a request outcome as one short tail, such as `POST /users → 201 3ms`, in place of `req=`, `res=` and `responseTime=` fields, and recognises the `started` banner by its `transport`, so a banner with no `url` still draws as one.
- @open-tomato/service-mcp: A stdio MCP server's logs leave stdout for stderr, so they no longer break the protocol, and it now logs the `started` banner (transport `stdio`, no `url`) there once its transport is connected; `logger: { destination: 'stdout' }` overrides the pick, and HTTP keeps stdout.
- @open-tomato/service-express: A crumb logged through `req.log` no longer carries `req`; the `request completed` line still carries `req`, `res` and `responseTime` under the same `traceId`. An `x-request-id` outside `[A-Za-z0-9._:-]{1,64}` is replaced by a new UUID, which the response echoes.
