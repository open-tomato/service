---
plan: retry-and-client-names-service-mcp
title: MCP on the shared core, with stdio logs on stderr
level: major
package: @open-tomato/service-mcp
---

- mcp: the re-exported `createHttpClient` requires `opts.name`, as the core's does
