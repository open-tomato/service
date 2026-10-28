# @open-tomato/service-express

[![npm](https://img.shields.io/npm/v/@open-tomato/service-express?label=npm&color=cb3837)](https://www.npmjs.com/package/@open-tomato/service-express)
[![CI](https://github.com/open-tomato/service/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/open-tomato/service/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/open-tomato/service/blob/main/LICENSE)

An Express 5 service in one call. `createService` builds the app with
security middleware, starts your dependencies and clients in order, mounts
a health route and an optional operator control plane, registers your
routes, listens, and shuts down gracefully on `SIGTERM` and `SIGINT`.

Part of the [@open-tomato/service](https://github.com/open-tomato/service)
stack; dependencies and HTTP clients come from
[`@open-tomato/service`](https://www.npmjs.com/package/@open-tomato/service),
re-exported here.

```sh
npm install @open-tomato/service-express
```

## A service

```ts
import { createDependency, createService } from '@open-tomato/service-express';

const cache = createDependency({
  name: 'cache',
  onStart: async () => { /* open the connection */ },
  onStop: async () => { /* close it */ },
});

await createService({
  serviceId: 'orders',
  port: 3000,
  dependencies: [cache],
  register(app, { logger }) {
    app.get('/orders', (_req, res) => {
      logger.info('listing orders');
      res.json({ orders: [] });
    });
  },
});
```

Dependencies start before `register` runs; if one fails to start, the
service does not come up. On shutdown, the server stops taking requests,
drains the open ones, and stops the dependencies in reverse order.

## Clients, auth and the control plane

```ts
import { createHttpClient, createService, getSession } from '@open-tomato/service-express';

class InventoryApi {
  async stock(sku: string): Promise<number> {
    const res = await fetch(`http://inventory:3000/stock/${sku}`);
    const body = await res.json() as { count: number };
    return body.count;
  }
}

const inventory = createHttpClient(new InventoryApi(), { retry: { attempts: 3 } });

await createService({
  serviceId: 'orders',
  port: Number(process.env['PORT'] ?? 3000),
  clients: [inventory],
  auth: {
    introspectUrl: 'http://auth:3000/introspect',
    introspectSecret: process.env['INTROSPECT_SECRET'] ?? '',
  },
  cors: { origins: ['https://app.example.com'] },
  control: { enabled: true, secret: process.env['CONTROL_SECRET'] ?? '' },
  register(app, { requireAuth, clients }) {
    const api = clients.get(inventory);
    app.get('/stock/:sku', requireAuth, async (req, res) => {
      const session = getSession(res);
      res.json({ user: session?.sub, count: await api.stock(String(req.params['sku'])) });
    });
  },
});
```

`requireAuth` reads `Authorization: Bearer <token>`, checks it against
`introspectUrl`, and answers `401` when it is missing or invalid;
`optionalAuth` lets the request through either way. `getSession(res)`
returns the verified claims. Without `auth`, both are no-ops.

## What every service gets

| Piece | Behaviour |
|---|---|
| `helmet` | secure response headers |
| CORS | denies cross-origin requests unless `cors.origins` lists them |
| rate limit | 100 requests per 60 s by default; set `rateLimit` |
| body parsing | JSON and URL-encoded, up to `1mb` by default; set `body.limit` |
| request log | pino-http, with `authorization`, `cookie` and `x-api-key` headers redacted |
| error handler | a `5xx` answers `Internal Server Error` without the error's message; a `4xx` keeps its message |
| `GET /health` | `200 {"status":"ok"}`, or `503` once a dependency or client is in `error` |
| shutdown | on `SIGTERM`/`SIGINT`, drains for 10 s by default, then closes stuck connections; set `shutdown.drainTimeout` |

## The control plane

With `control.enabled`, operator routes mount under `/_control`. Each
request needs the header `x-control-token: <control.secret>`, compared in
constant time.

| Route | What it does |
|---|---|
| `GET /_control/status` | the service, its dependencies and clients |
| `GET /_control/dependencies` | each dependency's status and health detail |
| `POST /_control/dependencies/:name/pause` | pauses a dependency that supports it |
| `POST /_control/dependencies/:name/resume` | resumes it |
| `POST /_control/dependencies/:name/restart` | stops and starts it |
| `POST /_control/clients/:name/reset` | stops and starts a client |
| `POST /_control/stop` | shuts the service down gracefully |

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `serviceId` | required | names the service in logs and health |
| `register(app, ctx)` | required | mounts your routes; `ctx` has `logger`, `requireAuth`, `optionalAuth`, `deps`, `clients` and `config` |
| `port` | `3000` | the port to listen on |
| `dependencies` | `[]` | started in order before `register`, stopped in reverse |
| `clients` | `[]` | HTTP clients, read with `ctx.clients.get(client)` |
| `plugins` | `[]` | `ServicePlugin`s registered before `register` |
| `auth` | none | `{ introspectUrl, introspectSecret }`; the secret must be at least 32 characters |
| `cors` | deny | `{ origins: string[] }` |
| `rateLimit` | 100 / 60 s | `{ max, windowMs }` |
| `body` | `1mb` | `{ limit }` |
| `shutdown` | 10 s | `{ drainTimeout }` in milliseconds |
| `control` | off | `{ enabled, secret }` |

`createService` resolves to `{ app, stop() }`. The logger reads `LOG_LEVEL`
(default `info`), and pretty-prints when `NODE_ENV=development`.

## Requirements

Node.js 22 or later, or Bun. ESM only. Express 5.

## Links

- [The stack's README](https://github.com/open-tomato/service#readme)
- [Changelog](https://github.com/open-tomato/service/blob/main/packages/service-express/CHANGELOG.md)
- [Issues](https://github.com/open-tomato/service/issues)

Licensed under Apache-2.0.
