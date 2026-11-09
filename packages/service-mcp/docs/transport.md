# transport

Picks and connects the MCP transport.

- `resolveTransport()` reads `MCP_TRANSPORT` at call time: `stdio` answers
  `'stdio'`, and any other value, or none, answers `'http'`.
- `wireHttpTransport(config)` starts a `node:http` server that hands every
  request to a session table from `createHttpSessions`
  (`http-sessions.md`): each client's `initialize` gets its own stateful
  `StreamableHTTPServerTransport`, connected to a fresh server from
  `config.createSessionServer`. It resolves once the server listens, with
  the bound `port`, the `requested` port, `fellBack`, `sessionCount()`, and
  `close()`, which ends every session, then drops open connections and
  closes the server. A session that cannot be opened, and a request that
  fails, are logged at `error`.
- `wireStdioTransport(server)` connects a `StdioServerTransport` over the
  process's stdin and stdout.

## How it picks its port

The HTTP server listens through `listenOnPickedPort` (`listen.md`), the
same way as the health server (`health.md`). Without `config.strict`, a
taken port falls back to the first free one of the next 20, and
`warnOnFallback` logs a `warn` record naming the taken port, the bound one,
`strictPort` and `PORT_STRICT`. With `config.strict`, or when the whole
range is taken, the promise rejects with `PortInUseError`, which names
`config.configKey` (default `port`) and logs no warning. `requested` and
`fellBack` let the caller report the fallback it took.

Once the server listens it carries an `error` listener that logs at
`error`, so a later server error is reported instead of thrown as an
unhandled `error` event.

## How it is tested

`tests/transport.test.ts` covers `resolveTransport` for each value of
`MCP_TRANSPORT`, then wires real transports on port `0` so no test names a
fixed port. It checks that port `0` resolves with the system's port, that a
free asked port is used with no warning, that a port held by a real
`node:net` server falls back to a later port that the transport answers on
and logs the one warning with its fields and message, that `strict`
rejects with `PortInUseError` naming `port` (or the given key) and logs
nothing, and that an `error` emitted after listening reaches
`logger.error`. Removing the `onPicked` hook fails the fallback case, and
removing the `error` listener fails the last one, so both checks can fail.

`tests/http-transport.integration.test.ts` runs the SDK's own client
against the transport with the `Bun` global removed: one client calls a
tool and the port is free again after `close()`, two clients connect at
once and each list tools on their own session, a client ends its session
and connects again without a restart, and `close()` ends every open
session.

## Usage

The package entry exports `resolveTransport` only; `wireHttpTransport` and
`wireStdioTransport` are internal to the adapter. `createMCP` calls
`wireHttpTransport` in HTTP mode with the port and strict flag from
`resolvePortConfig` and its own logger, and reads the bound port from the
handle it gets back:

```ts
import { createConsoleLogger } from '@open-tomato/service';
import { resolveTransport } from '@open-tomato/service-mcp';

const logger = createConsoleLogger('my-svc');
logger.info({ transport: resolveTransport() }, 'transport'); // 'http' unless MCP_TRANSPORT=stdio
```
