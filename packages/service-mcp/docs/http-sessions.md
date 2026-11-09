# http-sessions

One MCP session per client over Streamable HTTP, kept in a map keyed by
the `Mcp-Session-Id` header.

## What it does

`createHttpSessions` returns a session table with three operations:
`handleRequest`, `count` and `closeAll`. `wireHttpTransport` in
`transport.ts` hands every request of its Node HTTP server to
`handleRequest`, which routes it in one of three ways.

- A request with an `Mcp-Session-Id` header goes to the transport stored
  under that id. An id the table does not hold answers `404` with the
  JSON-RPC error `-32001 Session not found`, which the MCP spec defines as
  the signal for a client to start a new session.
- A `POST` without the header whose body holds an `initialize` request
  opens a session: a new `StreamableHTTPServerTransport`, connected to a
  new `McpServer` from `createSessionServer`. The transport's
  `onsessioninitialized` callback stores it under the id the transport
  generated, and the response carries that id back to the client.
- Any other request without the header answers `400`, the same way a
  single SDK transport would.

A session leaves the table in the transport's `onclose`, which runs when a
client sends `DELETE` with its session id and when `closeAll` closes the
transport from the server side.

## Why

A stateful `StreamableHTTPServerTransport` serves exactly one session, and
an `McpServer` connects to exactly one transport. Before this module the
package built one of each per process, so the first client's `initialize`
succeeded and every later one, from a reconnecting client or a second
client, got `400 Server already initialized` until a restart. The SDK's
documented pattern for several clients is this table, and the only way to
give each session its own server is to build the server per session.
That is why `setup` runs once per session in HTTP mode: it registers the
tools onto the server that session will use.

The body of a header-less `POST` is read here, before any transport
exists, because the decision to open a session needs it. The parsed body
is then passed to the transport, which accepts a pre-parsed body and does
not read the stream again. The read is capped at 4 MiB, the SDK's own
default, and an oversized body is drained before the `413` goes out:
Node closes the socket as soon as a response ends, so a status sent while
the client is still writing would never reach it.

A failing `createSessionServer` answers `500` with `-32603`, reports the
error through `onError`, and leaves the process up: one broken session
does not take the server down with it. In stdio mode `createMCP` still
runs `setup` once at startup and exits on failure, as before.

The SDK can refuse an `initialize` after the server is built, with `406`
for a missing `Accept`, `415` for a wrong `Content-Type` or `400` for a
batch that carries more than the `initialize`. Such a transport never gets
a session id, so after `handleRequest` returns an id-less transport is
closed together with its server, and nothing stays behind for a request
that was never a session.

`closeAll` closes the sessions in the table and the transports still
opening, and from then on every `initialize` gets `503`, so a client that
races the shutdown cannot leave a session alive after it.

## What it does not do

Sessions have no idle timeout. A client that drops its connection without
sending `DELETE` leaves its transport in the table until the process ends.
The SDK's client sends `DELETE` from `terminateSession`, not from
`close`. Eviction of idle sessions is a later change.

## How it is tested

`tests/http-sessions.test.ts` drives the table through a bare Node HTTP
server with `fetch`, one request per connection: two `initialize` calls
open two sessions and run the factory twice, a known id routes, an unknown
id gets `404`, a header-less `tools/list`, `GET` and `DELETE` get `400`,
malformed JSON gets `400`, an oversized body gets `413` whether its length
is declared or streamed, an `initialize` the SDK refuses leaves no
transport behind, a failing factory gets `500` and reaches `onError`,
`DELETE` empties the table, `closeAll` ends every session, and an
`initialize` that races or follows `closeAll` gets `503`.

`tests/http-transport.integration.test.ts` runs the SDK's own client
against `wireHttpTransport`: two clients connect at once and each lists
tools on its own session, a client ends its session and connects again
without a restart, and `close()` ends every session and frees the port.

## How to use it

`createMCP` wires this for you, and `createHttpSessions` is exported for a
Node HTTP server of your own:

```ts
import { createServer } from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createHttpSessions } from '@open-tomato/service-mcp';

const sessions = createHttpSessions({
  createSessionServer: async () => {
    const server = new McpServer({ name: 'notes', version: '1.0.0' });
    server.registerTool('ping', { description: 'Answers pong' }, async () => ({
      content: [{ type: 'text', text: 'pong' }],
    }));
    return server;
  },
  onError: error => console.error('could not open a session', error),
});

createServer((req, res) => {
  sessions.handleRequest(req, res).catch(() => res.end());
}).listen(8080);
```
