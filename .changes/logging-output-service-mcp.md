---
plan: logging-output-service-mcp
title: Where log lines go and what they carry
level: major
package: @open-tomato/service-mcp
---

- mcp: A stdio MCP server's logs leave stdout for stderr, so they no longer break the protocol, and it now logs the `started` banner (transport `stdio`, no `url`) there once its transport is connected; `logger: { destination: 'stdout' }` overrides the pick, and HTTP keeps stdout.
