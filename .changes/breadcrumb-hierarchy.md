---
plan: breadcrumb-hierarchy
title: The log signature as a hierarchy, domain → scope → step
level: minor
---

- service: `scoped(logger, scope)` now takes the entry point's scope alone and binds it as given, and the new `inDomain(logger, domain)` binds the domain above it, as in `scoped(inDomain(logger, 'Users'), 'create')`; a call's step goes in its context object and is never bound. The core exports `DOMAIN_FIELD` and `STEP_FIELD` beside `TRACE_ID_FIELD` and `SCOPE_FIELD`, `LogBreadcrumb` types the `domain` and `step` fields, and the README documents the helpers, the field constants and the case convention.
- service-logger: the `terminal` decorator draws domain, scope and step as one signature slot joined by `:`, such as `Users:create:insert`, in place of the scope slot.
- docs: the Express and MCP READMEs show the `inDomain` and `scoped` chain with a step per call, and the logger docs state the level rule for steps.
