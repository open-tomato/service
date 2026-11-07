---
plan: banner-service-once-service
title: One core for every adapter
level: major
package: @open-tomato/service
---

- core: `StartupBanner` no longer has a `service` field, and `logStarted` writes none, also dropping a `service` key from `extra`. Every logger of the family binds `service` on each line, and pino wrote the key a second time when the record carried it too. A caller that passed `service` removes it; the line still names the service, from the logger.
