# create-mcp

`createMCP(config)` starts the MCP server in the background: it returns its
handle at once, then wires the transport and, in HTTP mode, starts the
health server.

## When `setup` runs

`setup` runs against a fresh `McpServer` each time one is built. In HTTP
mode that is once per client session, when the client's `initialize`
arrives, because a stateful transport serves one session and an
`McpServer` connects to one transport (`http-sessions.md`). A `setup` that
throws there answers that client `500`, is logged, and leaves the server
up. In `stdio` mode it runs once, before the transport is wired, and a
`setup` that throws fails the start.

## What the handle reports

- `ready()` resolves once the transport, and in HTTP mode the health
  server, listen, with an `MCPAddress`: `transport`, and in HTTP mode the
  bound `port`, `url`, `healthPort` and `healthUrl`. In `stdio` mode it
  resolves with `{ transport: 'stdio' }` once the transport is connected.
  It rejects with the error that stopped the start, such as a
  `PortInUseError` under a strict port.
- `healthUrl()` names the asked health port until `ready()` resolves, then
  the bound one, which differs after a fallback. Once started in `stdio`
  mode it returns an empty string.
- `stop()` closes the transport, which in HTTP mode ends every session,
  then the health server; `SIGTERM` calls it.

The transport and health ports come from `resolvePortConfig` (`listen.md`)
and are picked by `wireHttpTransport` (`transport.md`) and
`startHealthServer` (`health.md`), each of which logs its own fallback
warning. Each server also gets the `configKey` that call settled, so a
`PortInUseError` under a strict port names `PORT` or `HEALTH_PORT` when the
variable set the port, and `port` or `health.port` when the config did.

## The startup banner

Once both servers listen in HTTP mode, `createMCP` calls the core's
`logStarted` once, which writes one `info` record with message `started`:
`version`, `transport` (`http`), `url`, `features` and `healthUrl`, with
`fallbackPort` and `healthFallbackPort`, the asked ports, present only for
a server that fell back. The line's `service` is the logger's own binding,
written once. `version` (default `unknown`) is also the version `McpServer`
reports to clients.

In `stdio` mode, once the transport is connected, `logStarted` writes the
same record with `transport` `stdio`, no `url` and no health fields, since
no port is bound.

## Where the logs go

`createMCP` calls `resolveTransport()` once, before it builds its logger,
and `start()` wires the transport that one call picked. The pick also
picks the logger's `destination`: `stderr` on stdio, where stdout carries
the protocol and any other line on it breaks the session, and `stdout` on
HTTP. A `destination` in the `logger` config wins over the pick, so
`logger: { destination: 'stdout' }` puts a stdio server's logs back on
stdout. The logger `setup` receives is that same logger, so a tool's log
lines follow the pick too.

## When the start fails

A failed start rejects `ready()` and logs `Failed to start MCP server` at
`error`. Outside `NODE_ENV=test` it then exits the process with code 1;
under `NODE_ENV=test` the process stays up so a test can read the
rejection. A health server that cannot listen closes the already listening
transport first, so its port is not left held. The rejection is handled
inside `createMCP` too, so a caller that never calls `ready()` sees no
unhandled rejection.

## How it is tested

`tests/createMCP.test.ts` mocks the transport, the health server, the
logger and `McpServer`, and has the mocks report chosen picks. It checks
the `ready()` address in HTTP and `stdio` mode, `healthUrl()` before and
after `ready()`, the one `started` record with and without both
fallbacks, the `stdio` record with no `url` and its absence when the stdio
transport fails, that the transport is resolved once and before the
logger is built, the options `createLogger` receives on stdio, on HTTP
and on stdio with `logger: { destination: 'stdout' }`, the `version` and
`features` defaults, the version handed to `McpServer`, the exit outside
`NODE_ENV=test` and its absence under it, the `configKey` each server
receives with and without `PORT` and `HEALTH_PORT` set, that the transport
is closed when the health server fails, and that an unawaited failure
raises no `unhandledRejection`. It also calls the session factory the
mocked transport received, to check that HTTP mode runs `setup` on a fresh
server per session and none at startup, that a failing `setup` there
leaves the server started, and that `stdio` runs `setup` once on the
server its transport gets. Removing the rejection handler, the
test-mode guard, the transport close, the configured version,
`healthFallbackPort`, the bound `healthUrl`, the stderr pick, the config's
precedence over it, the absence of `url` on the stdio record or the
`configKey` handed on each fails at least one case.
`tests/createMCP.ports.integration.test.ts` catches the logger where
`createMCP` builds it, holds both ports with real sockets, and checks the
fallback, the strict rejection, and the message of
that rejection: `health.port` when the config set the port, `HEALTH_PORT`
or `PORT` when the variable did.

`tests/createMCP.destination.test.ts` runs the start through the real logger
and checks which stream the `setup` line, the `started` banner and the
shutdown lines reach: stderr only on stdio, stdout on HTTP, and stdout on
stdio when `logger: { destination: 'stdout' }` names it.
`tests/stdio-logs.integration.test.ts` spawns `tests/fixtures/stdio-server.ts`
under `MCP_TRANSPORT=stdio` and `LOG_LEVEL=debug`, and checks that stdout
carries only JSON-RPC messages while the `debug` and `info` tool lines reach
stderr.

## Usage

```ts
import { createConsoleLogger } from '@open-tomato/service';
import { createMCP } from '@open-tomato/service-mcp';

const handle = createMCP({
  serviceId: 'notes',
  version: '1.2.0',
  features: { search: true },
  setup: (server) => {
    server.registerTool('ping', { description: 'Answers pong' }, () => ({
      content: [{ type: 'text', text: 'pong' }],
    }));
  },
});

const { url, healthUrl } = await handle.ready();
createConsoleLogger('probe').info({ url, healthUrl }, 'notes is up'); // the bound URLs, after any fallback
await handle.stop();
```
