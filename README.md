# @open-tomato/service

[![npm](https://img.shields.io/npm/v/@open-tomato/service?label=npm&color=cb3837)](https://www.npmjs.com/package/@open-tomato/service)
[![CI](https://github.com/open-tomato/service/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/open-tomato/service/actions/workflows/ci.yml)
[![Privacy scan](https://github.com/open-tomato/service/actions/workflows/privacy.yml/badge.svg?branch=main)](https://github.com/open-tomato/service/actions/workflows/privacy.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/types-TypeScript-3178C6?logo=typescript&logoColor=white)
![ESM only](https://img.shields.io/badge/module-ESM-F7DF1E)

A small foundation for TypeScript services. The core manages what every
service needs: dependencies with a start, stop, pause and resume lifecycle,
typed HTTP clients to other services, retry with backoff, and a circuit
breaker that stops calling a failing peer. Adapters bind the core to a
framework, so a service is mostly configuration and its endpoints.

> **Status: 1.x.** The API is stable within the 1.x line. Version 2.0
> adds Nest.js and Next.js support and changes parts of the contract; see
> [the release lines](context/release.md#release-lines).

## Packages

| Package | Version | What it is |
|---|---|---|
| [`@open-tomato/service`](packages/service) | [![npm](https://img.shields.io/npm/v/@open-tomato/service?label=npm&color=cb3837)](https://www.npmjs.com/package/@open-tomato/service) | the core, free of any framework |
| [`@open-tomato/service-express`](packages/service-express) | [![npm](https://img.shields.io/npm/v/@open-tomato/service-express?label=npm&color=cb3837)](https://www.npmjs.com/package/@open-tomato/service-express) | Express 5 adapter: security middleware, health and control routes, graceful shutdown |
| [`@open-tomato/service-mcp`](packages/service-mcp) | [![npm](https://img.shields.io/npm/v/@open-tomato/service-mcp?label=npm&color=cb3837)](https://www.npmjs.com/package/@open-tomato/service-mcp) | Model Context Protocol adapter: a server factory with stdio and HTTP transports and a health endpoint |
| [`@open-tomato/service-logger`](packages/service-logger) | [![npm](https://img.shields.io/npm/v/@open-tomato/service-logger?label=npm&color=cb3837)](https://www.npmjs.com/package/@open-tomato/service-logger) | a pino logger with header redaction, for Node and the browser |

Install the core and the adapter for your framework:

```sh
npm install @open-tomato/service @open-tomato/service-express
```

## An Express service

```ts
import { createDependency } from '@open-tomato/service';
import { createService } from '@open-tomato/service-express';

const cache = createDependency({
  name: 'cache',
  onStart: async () => { /* open the connection */ },
  onStop: async () => { /* close it */ },
});

await createService({
  serviceId: 'orders',
  port: 3000,
  dependencies: [cache],
  register(app) {
    app.get('/orders', (_req, res) => {
      res.json({ orders: [] });
    });
  },
});
```

Dependencies start before `register` runs and stop in reverse order on
shutdown. `GET /health` answers `200` while every dependency is healthy and
`503` once one is in error.

## An MCP server

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

The server listens over HTTP on `PORT` (default `8080`), or on stdio when
`MCP_TRANSPORT=stdio`.

## Requirements

Node.js 22 or later, or Bun. The packages are ESM only.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports go through
[SECURITY.md](SECURITY.md), never a public issue.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
