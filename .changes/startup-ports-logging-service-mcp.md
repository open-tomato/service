---
plan: startup-ports-logging-service-mcp
title: Startup ports, the startup banner and readable terminal logs
level: major
package: @open-tomato/service-mcp
---

- mcp: `createMCP` takes `port`, `strictPort`, `version`, `features` and `health.strictPort` (or `PORT`, `PORT_STRICT`, `HEALTH_PORT` and `HEALTH_PORT_STRICT`), and its HTTP transport and health server fall back to the next free port with a warning instead of failing or crashing, or reject with `PortInUseError` when strict; the handle gains `ready()`, resolving with the bound ports and URLs or rejecting with the start error, `healthUrl()` names the bound health port, a `started` banner is logged once listening, and `McpServer` reports the configured version; a non-integer `PORT` or `HEALTH_PORT` now throws a `RangeError`, `startHealthServer` is async and resolves with its bound port (`HealthServerConfig` is exported), and a failed start no longer exits the process under `NODE_ENV=test` and closes the transport when the health server cannot listen.
- docs: the README documents the port and strict settings with their env names, the fallback warning, the `started` banner and the handle's ports and URLs
