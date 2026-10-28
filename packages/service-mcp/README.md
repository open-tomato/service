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
transport, on `PORT` or `8080`; it answers on any path, so clients can use
`http://localhost:8080/mcp`. With `MCP_TRANSPORT=stdio` it talks over stdin
and stdout instead, which is how desktop MCP clients start a local server.
Under stdio, anything on stdout that is not protocol breaks the session,
and the server's logger writes to stdout today. Run a stdio server with
`LOG_LEVEL=silent`, or log from your tools to stderr, until the logger
moves there.

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

const notesApi = createHttpClient(new NotesApi(), { retry: { attempts: 3 } });

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

## Health

A small HTTP server, separate from the MCP transport, answers `GET` on
`health.path`:

```json
{ "status": "ok", "serviceId": "notes", "clients": { "http-client": { "status": "running" } } }
```

It answers `200` while the status is `ok` or `degraded`, and `503` once it
is `error`. `buildHealthResponse` and `startHealthServer` are exported for
custom setups.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `serviceId` | required | names the server in logs and health |
| `setup(server, ctx)` | required | registers tools, resources and prompts; `ctx` has `logger` and `clients` |
| `clients` | `[]` | HTTP clients whose state the health response reports |
| `health.port` | `3001` | the health server's port |
| `health.path` | `'/health'` | the health route |
| `logger` | defaults | `LoggerOptions` for the server's logger |

| Environment variable | Default | Meaning |
|---|---|---|
| `MCP_TRANSPORT` | HTTP | `stdio` serves over stdin and stdout |
| `PORT` | `8080` | the HTTP transport's port |
| `LOG_LEVEL` | `info` | the logger's level |

`createMCP` returns `{ stop(), healthUrl() }`; `stop()` closes the
transport and the health server, and `SIGTERM` calls it for you.

## Requirements

Node.js 22 or later, or Bun. ESM only. `zod` 4 for tool schemas.

## Links

- [The stack's README](https://github.com/open-tomato/service#readme)
- [Changelog](https://github.com/open-tomato/service/blob/main/packages/service-mcp/CHANGELOG.md)
- [Issues](https://github.com/open-tomato/service/issues)

Licensed under Apache-2.0.
