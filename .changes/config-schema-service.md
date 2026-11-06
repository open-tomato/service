---
plan: config-schema-service
title: A base config schema in the core
level: major
package: @open-tomato/service
---

- core: adds `BaseServiceConfigSchema`, the config every adapter shares (`serviceId`, `version`, `dependencies` and `clients` as records by key, `control` and `stopTimeoutMs`), which an adapter extends with `.extend()`. A 1.x `dependencies` array is refused with a message naming the record form, and an enabled control plane needs a non-empty secret; `zod` becomes the core's one dependency
