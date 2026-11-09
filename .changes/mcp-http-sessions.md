---
plan: mcp-http-sessions
title: HTTP mode serves one MCP session per client
level: minor
package: @open-tomato/service-mcp
---

- mcp: HTTP mode opens a session per client, keyed by Mcp-Session-Id; several clients connect at once and a client reconnects without a restart
- mcp: setup runs once per HTTP session on a fresh McpServer, and once at startup under stdio
- mcp: a stale session id gets 404, a header-less non-initialize request 400, a failing setup 500 without taking the process down
