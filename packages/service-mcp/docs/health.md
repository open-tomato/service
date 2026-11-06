# health

The MCP adapter's standalone health endpoint, a `node:http` server beside
the MCP transport in HTTP mode.

- `buildHealthResponse(serviceId, clients)` reads each client's `status`:
  any `error` makes the whole response `error`, else any `starting` or
  `degraded` makes it `degraded`, else it is `ok`.
- `startHealthServer(config)` serves that response as JSON at
  `config.path`, `200` for `ok` and `degraded`, `503` for `error`, and
  `404` on every other path. It resolves once the server listens, with the
  bound `port`, the `requested` port, `fellBack`, and `stop()`.

## How it picks its port

The server listens through `listenOnPickedPort` (`listen.md`), so a taken
health port no longer kills the process. Without `config.strict`, a taken
port falls back to the first free one of the next 20, and
`warnOnFallback` logs a `warn` record naming the taken port, the bound one,
`health.strictPort` and `HEALTH_PORT_STRICT`. With `config.strict`, or when
the whole range is taken, the promise rejects with `PortInUseError`, which
names `config.configKey` (default `health.port`) and logs no warning.

Once the server listens it carries an `error` listener that logs at
`error`, so a later server error is reported instead of thrown as an
unhandled `error` event.

## How it is tested

`tests/health.test.ts` covers `buildHealthResponse` for each status mix,
then starts real servers on port `0` so no test names a fixed port. It
checks the `200`, `503` and `404` responses and the configured path, that
port `0` resolves with the system's port, that a free asked port is used
with no warning, that a port held by a real `node:net` server falls back to
a later port that serves the route and logs the one warning with its
fields and message, that `strict` rejects with `PortInUseError` naming
`health.port` (or the given key) and logs nothing, and that an `error`
emitted after listening reaches `logger.error`. Removing the `onPicked`
hook fails the fallback case, and removing the `error` listener fails the
last one, so both checks can fail.

## Usage

`createMCP` calls it in HTTP mode once the transport listens, with the
health port and strict flag from `resolvePortConfig` and its own logger:

```ts
import { createConsoleLogger } from '@open-tomato/service';
import { startHealthServer } from '@open-tomato/service-mcp';

const logger = createConsoleLogger('my-svc');
const health = await startHealthServer({
  port: 3001, strict: false, path: '/health', serviceId: 'my-svc', clients: [], logger,
});
logger.info({ port: health.port }, 'health server listening'); // 3001, or a later port when 3001 was taken
health.stop();
```
