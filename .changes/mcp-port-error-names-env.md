---
plan: mcp-port-error-names-env
title: MCP's taken-port error names the variable that set the port
level: patch
package: @open-tomato/service-mcp
---

- mcp: A `PortInUseError` under a strict port now says `set PORT` or `set HEALTH_PORT` when the environment variable gave the port, and `set port` or `set health.port` only when the config did, as the Express adapter does. Before, a start with `HEALTH_PORT` taken and `HEALTH_PORT_STRICT=true` told the operator to set `health.port`, a field they had not used.
