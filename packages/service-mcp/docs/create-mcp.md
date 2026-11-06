# create-mcp

`createMCP(config)` builds the MCP server and starts it in the background:
it returns its handle at once, then awaits `setup`, wires the transport
and, in HTTP mode, starts the health server.

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
- `stop()` closes the transport, then the health server; `SIGTERM` calls it.

The transport and health ports come from `resolvePortConfig` (`listen.md`)
and are picked by `wireHttpTransport` (`transport.md`) and
`startHealthServer` (`health.md`), each of which logs its own fallback
warning.

## The startup banner

Once both servers listen in HTTP mode, `createMCP` calls the core's
`logStarted` once, which writes one `info` record with message `started`:
`service`, `version`, `transport` (`http`), `url`, `features` and
`healthUrl`, with `fallbackPort` and `healthFallbackPort`, the asked ports,
present only for a server that fell back. `version` (default `unknown`) is
also the version `McpServer` reports to clients.

`stdio` mode writes no banner: the logger writes to stdout, which carries
the protocol there, and no port is bound.

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
fallbacks, the `version` and `features` defaults, the version handed to
`McpServer`, the exit outside `NODE_ENV=test` and its absence under it,
that the transport is closed when the health server fails, and that an
unawaited failure raises no `unhandledRejection`. Removing the rejection
handler, the test-mode guard, the transport close, the configured version,
`healthFallbackPort` or the bound `healthUrl` each fails at least one case.

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
