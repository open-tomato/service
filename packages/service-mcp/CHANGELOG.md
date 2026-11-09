# Changelog

## 2.1.0 — 2026-11-09, HTTP mode serves one MCP session per client
<!-- rafa:fragments mcp-http-sessions -->

- mcp: HTTP mode opens a session per client, keyed by Mcp-Session-Id; several clients connect at once and a client reconnects without a restart
- mcp: setup runs once per HTTP session on a fresh McpServer, and once at startup under stdio
- mcp: a stale session id gets 404, a header-less non-initialize request 400, a failing setup 500 without taking the process down

## 2.0.1 — 2026-11-07, MCP's taken-port error names the variable that set the port
<!-- rafa:fragments mcp-port-error-names-env -->

- mcp: A `PortInUseError` under a strict port now says `set PORT` or `set HEALTH_PORT` when the environment variable gave the port, and `set port` or `set health.port` only when the config did, as the Express adapter does. Before, a start with `HEALTH_PORT` taken and `HEALTH_PORT_STRICT=true` told the operator to set `health.port`, a field they had not used.

## 2.0.0 — 2026-11-07, MCP on the shared core, with stdio logs on stderr
<!-- rafa:fragments banner-service-once-service-mcp breadcrumb-hierarchy-service-mcp logging-output-service-mcp retry-and-client-names-service-mcp startup-ports-logging-service-mcp -->

- mcp: the `started` line carries `service` once, on HTTP and on stdio.
- mcp: A stdio MCP server's logs leave stdout for stderr, so they no longer break the protocol, and it now logs the `started` banner (transport `stdio`, no `url`) there once its transport is connected; `logger: { destination: 'stdout' }` overrides the pick, and HTTP keeps stdout.
- mcp: the re-exported `createHttpClient` requires `opts.name`, as the core's does
- mcp: `createMCP` takes `port`, `strictPort`, `version`, `features` and `health.strictPort` (or `PORT`, `PORT_STRICT`, `HEALTH_PORT` and `HEALTH_PORT_STRICT`), and its HTTP transport and health server fall back to the next free port with a warning instead of failing or crashing, or reject with `PortInUseError` when strict; the handle gains `ready()`, resolving with the bound ports and URLs or rejecting with the start error, `healthUrl()` names the bound health port, a `started` banner is logged once listening, and `McpServer` reports the configured version; a non-integer `PORT` or `HEALTH_PORT` now throws a `RangeError`, `startHealthServer` is async and resolves with its bound port (`HealthServerConfig` is exported), and a failed start no longer exits the process under `NODE_ENV=test` and closes the transport when the health server cannot listen.
- docs: the README shows the `inDomain` and `scoped` chain with a step per call
- docs: the README documents the port and strict settings with their env names, the fallback warning, the `started` banner and the handle's ports and URLs

## 1.0.2 — 2026-10-28, README with examples on the npm page
<!-- rafa:fragments npm-readme-service-mcp -->

- docs: the npm page shows what the package does, worked examples and its options

## 1.0.1 — 2026-10-28, Installs: sibling ranges name the released version
<!-- rafa:fragments installable-ranges-service-mcp -->

- mcp: the published manifest requires ^1.0.0 of its @open-tomato siblings; 1.0.0 required ^0.0.0 and did not install

## 1.0.0 — 2026-10-27, First public release
<!-- rafa:fragments first-release-mcp -->

- mcp: MCP server factory with stdio and Node HTTP transports and a health endpoint
