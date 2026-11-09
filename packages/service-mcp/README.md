# @open-tomato/service-mcp

[![npm](https://img.shields.io/npm/v/@open-tomato/service-mcp?label=npm&color=cb3837)](https://www.npmjs.com/package/@open-tomato/service-mcp)
[![CI](https://github.com/open-tomato/service/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/open-tomato/service/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/open-tomato/service/blob/main/LICENSE)

A Model Context Protocol server in one call. `createMCP` builds an
`McpServer` from the [official SDK](https://www.npmjs.com/package/@modelcontextprotocol/sdk),
hands it to your `setup` to register tools, resources and prompts, picks
the transport from the environment, and serves a health endpoint beside it.

Part of the [@open-tomato/service](https://github.com/open-tomato/service)
stack; HTTP clients come from
[`@open-tomato/service`](https://www.npmjs.com/package/@open-tomato/service),
re-exported here.

```sh
npm install @open-tomato/service-mcp zod
```

## A server

```ts
import { z } from 'zod';

import { createMCP } from '@open-tomato/service-mcp';

createMCP({
  serviceId: 'notes',
  setup(server) {
    server.registerTool(
      'echo',
      { description: 'Echo a message', inputSchema: { message: z.string() } },
      async ({ message }) => ({ content: [{ type: 'text', text: message }] }),
    );
  },
});
```

By default the server listens over HTTP with the SDK's Streamable HTTP
transport, on `port`, else `PORT`, else `8080`; it answers on any path, so
clients can use `http://localhost:8080/mcp`. Each client gets its own
session: its `initialize` builds a fresh `McpServer`, runs `setup` against
it, and the `Mcp-Session-Id` header routes the client's later requests to
it. Several clients can be connected at once, and a client can reconnect
without a restart. A request with a session id the server no longer holds
gets `404`, the spec's signal to start a new session. `setup` runs once per
connecting client in this mode, so keep its side effects cheap; one that
throws answers that client `500` and leaves the server up. With
`MCP_TRANSPORT=stdio` it talks over stdin and stdout instead, which is how
desktop MCP clients start a local server, and `setup` runs once at startup.
Under stdio, anything on stdout that is not protocol breaks
the session, so the server's logger writes to stderr with nothing set, the
`logger` that `setup` receives included. A `destination` in the `logger`
config overrides that pick: `logger: { destination: 'stdout' }` puts the logs
back on stdout, which is only safe over HTTP. See [Logging](#logging).

## Calling other services from a tool

```ts
import { z } from 'zod';

import { createHttpClient, createMCP } from '@open-tomato/service-mcp';

class NotesApi {
  async search(query: string): Promise<string[]> {
    const res = await fetch(`http://notes-api:3000/search?q=${encodeURIComponent(query)}`);
    return await res.json() as string[];
  }
}

const notesApi = createHttpClient(new NotesApi(), { name: 'notes-api', retry: { attempts: 3 } });

const handle = createMCP({
  serviceId: 'notes',
  clients: [notesApi],
  health: { port: 3001, path: '/health' },
  setup(server, { logger }) {
    server.registerTool(
      'search_notes',
      { description: 'Search the notes', inputSchema: { query: z.string() } },
      async ({ query }) => {
        logger.debug({ query }, 'searching notes');
        const hits = await notesApi.search(query);
        return { content: [{ type: 'text', text: hits.join('\n') }] };
      },
    );
  },
});

console.log(handle.healthUrl()); // http://localhost:3001/health
```

The client retries and goes through a circuit breaker on every call; see
[`@open-tomato/service`](https://www.npmjs.com/package/@open-tomato/service)
for the options. Listing it in `clients` puts its breaker state in the
health response. `ctx.clients` also holds it, keyed by the client's name,
which is `http-client` for every client today, so call the client itself as
above.

## Ports and the banner

The HTTP transport listens on `port`, else `PORT`, else `8080`. The health
server does the same with `health.port`, else `HEALTH_PORT`, else `3001`. A
taken port is not an error by default: the server takes the first free port
of the next 20, and logs a `warn` record before it listens, such as:

```text
port 8080 is taken, falling back to 8081; set strictPort or PORT_STRICT=true to fail instead
```

The health server's record names `health.strictPort` and
`HEALTH_PORT_STRICT` the same way.

A fallback can hide two copies of a service that both look healthy: the
second one quietly takes 8081 while the first holds 8080. For deploys, set
`strictPort: true` (or `PORT_STRICT=true`), and `health.strictPort: true`
(or `HEALTH_PORT_STRICT=true`), so a taken port stops the server instead.
The error is a `PortInUseError` with the code `PORT_IN_USE`, and its message
names the port and the config key that sets it, such as
`port 8080 is taken; set port to a free port`. A `PORT` or `HEALTH_PORT` that
is not a whole number makes `createMCP` throw a `RangeError`.

Once both servers listen in HTTP mode, the server logs one `info` record
with the message `started`, the startup banner:

- `service`, the `serviceId`;
- `version`, from the `version` field, or `unknown`;
- `transport`, which is `http`;
- `url`, `http://localhost:<port>`;
- `features`, the object from the config, `{}` by default;
- `healthUrl`, `http://localhost:<port>/health`;
- `fallbackPort`, the port that was asked for, present only after the
  transport fell back;
- `healthFallbackPort`, the health port that was asked for, present only
  after the health server fell back.

In `stdio` mode the same record is written once the transport is connected,
with `transport` `stdio` and no `url` or health fields. It goes through the
logger, so with nothing set it lands on stderr, and on stdout only when
`logger: { destination: 'stdout' }` overrides the pick.

`ready()` resolves with the bound address once the servers listen: the
`transport`, and in HTTP mode the transport's `port` and `url` and the health
server's `healthPort` and `healthUrl`. These are the bound ports, which differ
from the asked ones after a fallback. `healthUrl()` names the asked health
port until `ready()` resolves, then the bound one.

```ts
import { createMCP } from '@open-tomato/service-mcp';

const handle = createMCP({ serviceId: 'notes', setup() {} });

const { url, healthUrl } = await handle.ready();
console.log(`notes serves MCP at ${url}, health at ${healthUrl}`);
```

## Health

A small HTTP server, separate from the MCP transport, answers `GET` on
`health.path`:

```json
{ "status": "ok", "serviceId": "notes", "clients": { "http-client": { "status": "running" } } }
```

It answers `200` while the status is `ok` or `degraded`, and `503` once it
is `error`. `buildHealthResponse`, `startHealthServer` and
`createHttpSessions`, the per-client session table, are exported for custom
setups.

## Logging

The logger reads `LOG_LEVEL` (default `info`). Its format is picked once:
`LOG_FORMAT=terminal` or `LOG_FORMAT=json` picks one outright. Without it, the
logger looks at the stream it writes to: a terminal there gets readable,
coloured lines, and anything else gets pino's JSON records. A pipe stays JSON
on purpose: whatever takes the records into a logging system should get the
raw records and decorate them itself, since pino's JSON is not readable by a
person. `NODE_ENV` plays no part, so a server run by hand in a terminal prints
readable lines whatever its environment. Setting `NO_COLOR` to any non-empty
value turns colour off in the terminal format.

On stdio the logs go to stderr, because stdout carries the protocol, and with
nothing set the format follows stderr's TTY. Run by hand in a terminal, where
stdout is a pipe and stderr is the terminal, the server prints readable lines.
Spawned by an MCP client, stderr is a pipe, so the client gets JSON records.
`logger: { destination: 'stdout' }` overrides the pick, and the format then
follows stdout's TTY. Over HTTP the logs stay on stdout, so the same rule
picks the format there.

A tool handler's logger comes from `ctx.logger`, which `setup` receives. Chain
`scoped(inDomain(logger, 'Notes'), 'search')` on it, with both helpers imported
from `@open-tomato/service` (this package does not re-export them), and each
record names the domain and the scope it was written under. A step goes in the
context object of its call, `{ step: 'fetch' }`, and is never bound: a step
bound on a child would stick to every later record. The `debug` step below
follows the level rule of the service logger's README: routine steps are
`trace` or `debug`, and only the key steps of the critical path are `info`.

```ts
import { z } from 'zod';

import { inDomain, scoped } from '@open-tomato/service';
import { createMCP } from '@open-tomato/service-mcp';

createMCP({
  serviceId: 'notes',
  setup(server, { logger }) {
    const log = scoped(inDomain(logger, 'Notes'), 'search');
    server.registerTool(
      'search_notes',
      { description: 'Search the notes', inputSchema: { query: z.string() } },
      async ({ query }) => {
        log.debug({ step: 'fetch', query }, 'notes requested');
        return { content: [{ type: 'text', text: '' }] };
      },
    );
  },
});
```

The `fetch` record draws `Notes:search:fetch`, so the line says which call
wrote it.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `serviceId` | required | names the server in logs and health |
| `setup(server, ctx)` | required | registers tools, resources and prompts, once per HTTP session; `ctx` has `logger` and `clients` |
| `clients` | `[]` | HTTP clients whose state the health response reports |
| `port` | `PORT`, else `8080` | the HTTP transport's port; a taken one falls back, see [Ports and the banner](#ports-and-the-banner) |
| `strictPort` | `PORT_STRICT`, else `false` | a taken transport port rejects with `PortInUseError` instead of falling back |
| `version` | `'unknown'` | the server version, passed to `McpServer` and shown in the `started` banner |
| `features` | `{}` | feature flags or settings, strings, numbers or booleans, shown in the banner |
| `health.port` | `HEALTH_PORT`, else `3001` | the health server's port |
| `health.strictPort` | `HEALTH_PORT_STRICT`, else `false` | a taken health port rejects with `PortInUseError` instead of falling back |
| `health.path` | `'/health'` | the health route |
| `logger` | defaults | `LoggerOptions` for the server's logger, `format` included |

| Environment variable | Default | Meaning |
|---|---|---|
| `MCP_TRANSPORT` | HTTP | `stdio` serves over stdin and stdout, and its logs go to stderr; see [Logging](#logging) |
| `PORT` | `8080` | the HTTP transport's port, read when `port` is unset |
| `PORT_STRICT` | `false` | `true` or `1` makes a taken transport port an error, read when `strictPort` is unset |
| `HEALTH_PORT` | `3001` | the health server's port, read when `health.port` is unset |
| `HEALTH_PORT_STRICT` | `false` | `true` or `1` makes a taken health port an error, read when `health.strictPort` is unset |
| `LOG_LEVEL` | `info` | the logger's level |
| `LOG_FORMAT` | by TTY | `terminal` or `json` picks the logger's format; see [Logging](#logging) |

`createMCP` returns `{ ready(), stop(), healthUrl() }`. `ready()` resolves
with the bound address, see [Ports and the banner](#ports-and-the-banner),
and rejects with the error that stopped the start, such as a
`PortInUseError` under a strict port. A failed start also logs the error
and, outside `NODE_ENV=test`, exits the process with code 1, so a server
that never calls `ready()` still fails loudly. `stop()` closes every
session, the transport and the health server, and `SIGTERM` calls it for
you.

## Requirements

Node.js 22 or later, or Bun. ESM only. `zod` 4 for tool schemas.

## Links

- [The stack's README](https://github.com/open-tomato/service#readme)
- [Changelog](https://github.com/open-tomato/service/blob/main/packages/service-mcp/CHANGELOG.md)
- [Issues](https://github.com/open-tomato/service/issues)

Licensed under Apache-2.0.
