# @open-tomato/service

A small foundation for TypeScript services. The core manages what every
service needs: dependencies with a start, stop, pause and resume lifecycle,
typed HTTP clients to other services, retry with backoff, and a circuit
breaker that stops calling a failing peer. Adapters bind the core to a
framework, so a service is mostly configuration and its endpoints.

> **Status: pre-release.** Nothing is published to npm yet, and the API
> will change before `0.1.0`.

## Packages

| Package | What it is |
|---|---|
| `@open-tomato/service` | the core, free of any framework |
| `@open-tomato/service-express` | Express 5 adapter: security middleware, health and control routes, graceful shutdown |
| `@open-tomato/service-mcp` | Model Context Protocol adapter: a server factory with stdio and HTTP transports and a health endpoint |
| `@open-tomato/service-logger` | a pino logger with header redaction, for Node and the browser |

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
