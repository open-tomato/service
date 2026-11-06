---
plan: banner-service-once
title: The started line names the service once
level: minor
---

- @open-tomato/service: `StartupBanner` no longer has a `service` field, and `logStarted` writes none, also dropping a `service` key from `extra`. Every logger of the family binds `service` on each line, and pino wrote the key a second time when the record carried it too. A caller that passed `service` removes it; the line still names the service, from the logger.
- @open-tomato/service-express: The `started` line carries `service` once.
- @open-tomato/service-mcp: The `started` line carries `service` once, on HTTP and on stdio.
