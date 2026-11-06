---
plan: breadcrumb-hierarchy-service
title: One core for every adapter
level: major
package: @open-tomato/service
---

- core: `scoped(logger, scope)` now takes the entry point's scope alone and binds it as given, and the new `inDomain(logger, domain)` binds the domain above it, as in `scoped(inDomain(logger, 'Users'), 'create')`; a call's step goes in its context object and is never bound. The core exports `DOMAIN_FIELD` and `STEP_FIELD` beside `TRACE_ID_FIELD` and `SCOPE_FIELD`, `LogBreadcrumb` types the `domain` and `step` fields, and the README documents the helpers, the field constants and the case convention.
- docs: the logger docs state the level rule for steps
