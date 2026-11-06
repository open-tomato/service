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

const inventory = createHttpClient(new InventoryApi(), { name: 'inventory', retry: { attempts: 3 } });

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
| request log | pino-http, with `authorization`, `cookie` and `x-api-key` headers redacted; `req.log` carries the request's `traceId`, see [Logging](#logging) |
| error handler | answers `{ code, message, details? }`, a `5xx` without the error's own text; one log line per error; see [Errors](#errors) |
| `GET /health` | `200 {"status":"ok"}`, or `503` once a dependency or client is in `error` |
| shutdown | on `SIGTERM`/`SIGINT`, drains for 10 s by default, then closes stuck connections; set `shutdown.drainTimeout` |

## Ports and the banner

The server listens on `port`. When that is not set, the `PORT` environment
variable is read, then 3000. A taken port is not an error by default: the
service takes the first free port of the next 20, and logs a `warn` record
before it listens, such as:

```text
port 3000 is taken, falling back to 3001; set strictPort or PORT_STRICT=true to fail instead
```

A fallback can hide two copies of a service that both look healthy: the
second one quietly takes 3001 while the first holds 3000. For deploys, set
`strictPort: true`, or `PORT_STRICT=true` in the environment, so a taken port
stops the service instead. The error is a `PortInUseError` with the code
`PORT_IN_USE`, and its message names the port and the key that sets it.

Under `NODE_ENV=test`, a service that names no port binds one the system
picks, so parallel tests do not collide; a named port is used as given.

Once it listens, the service logs one `info` record with the message
`started`, the startup banner:

- `service`, the `serviceId`;
- `version`, from the service's `package.json`, or `unknown`;
- `transport`, which is `http`;
- `url`, `http://localhost:<port>`;
- `features`, the object from the config, `{}` by default;
- `fallbackPort`, the port that was asked for, present only after a fallback.

The handle that `createService` resolves to carries the bound `port`, which
differs from the asked one after a fallback, and the `url`:

```ts
import { createService } from '@open-tomato/service-express';

const { port, url } = await createService({
  serviceId: 'orders',
  register(app) {
    app.get('/orders', (_req, res) => res.json({ orders: [] }));
  },
});

console.log(`orders is at ${url} (port ${port})`);
```

A web app that the same server serves calls relative paths, so it follows
whatever port it gets. A separate dev server reads `url` from the handle
rather than assuming 3000.

## Logging

The logger reads `LOG_LEVEL` (default `info`). Its format is picked once:
`LOG_FORMAT=terminal` or `LOG_FORMAT=json` picks one outright. Without it, a
terminal on stdout gets readable, coloured lines, and anything else gets
pino's JSON records. Piped output stays JSON on purpose: whatever takes the
records into a logging system should get the raw records and decorate them
itself, since pino's JSON is not readable by a person. `NODE_ENV` plays no
part, so a service run by hand in a terminal prints readable lines whatever
its environment.

Each request gets an id: its `x-request-id` header when it carries one, else
a new UUID. The response answers with the same `x-request-id`, and `req.log`
binds the id as `traceId`, so every record a route writes through `req.log`
carries it. A terminal line shows the first 8 characters of it.

A logger from `scoped(inDomain(logger, 'Orders'), 'create')`, with both
imported from `@open-tomato/service` (this package does not re-export them),
adds `domain: 'Orders'` and `scope: 'create'` to each record it writes, so a
line names the code that wrote it. Each step goes in the context object of its
call, `{ step: 'insert' }`, and is never bound: a step bound on a child would
stick to every later record. The `debug` and `info` steps below follow the level
rule of the service logger's README:

```ts
import { inDomain, scoped } from '@open-tomato/service';
import { createService } from '@open-tomato/service-express';

await createService({
  serviceId: 'orders',
  register(app, { logger }) {
    const log = scoped(inDomain(logger, 'Orders'), 'create');
    app.post('/orders', (req, res) => {
      req.log.info('order request received');
      log.debug({ step: 'validate', orderId: 'o-1' }, 'order input checked');
      log.info({ step: 'insert', orderId: 'o-1' }, 'order created');
      res.status(201).json({ orderId: 'o-1' });
    });
  },
});
```

The `validate` record draws `Orders:create:validate` and the `insert` record
draws `Orders:create:insert`, so each line says which call wrote it.

## Errors

Throw one of the core's error classes from a route, and the error handler
answers with its status and body. This package re-exports them.

```ts
import { createService, NotFoundError } from '@open-tomato/service-express';

await createService({
  serviceId: 'orders',
  register(app) {
    app.get('/orders/:id', (req) => {
      throw new NotFoundError('order not found', { orderId: req.params['id'] });
    });
  },
});
// GET /orders/o-1 → 404 {"code":"NOT_FOUND","message":"order not found","details":{"orderId":"o-1"}}
```

Anything else thrown goes through the core's `toErrorResponse`, which
uses what the error carries and falls back to a generic message and code;
the core's README has the full rule. Each error writes one log line
through the service logger: a warning with the code for a `4xx`, and an
error with the hidden name, code and stack for a `5xx`. To send a body of
your own, set `formatError`; if it throws, the default rule answers
instead.

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
| `port` | `PORT`, else `3000` | the port to listen on; a taken one falls back, see [Ports and the banner](#ports-and-the-banner) |
| `strictPort` | `PORT_STRICT`, else `false` | a taken port rejects with `PortInUseError` instead of falling back |
| `features` | `{}` | feature flags or settings, strings, numbers or booleans, shown in the `started` banner |
| `dependencies` | `[]` | started in order before `register`, stopped in reverse |
| `clients` | `[]` | HTTP clients, read with `ctx.clients.get(client)` |
| `plugins` | `[]` | `ServicePlugin`s registered before `register` |
| `auth` | none | `{ introspectUrl, introspectSecret }`; the secret must be at least 32 characters |
| `cors` | deny | `{ origins: string[] }` |
| `rateLimit` | 100 / 60 s | `{ max, windowMs }` |
| `body` | `1mb` | `{ limit }` |
| `shutdown` | 10 s | `{ drainTimeout }` in milliseconds |
| `control` | off | `{ enabled, secret }` |
| `formatError` | the core's `toErrorResponse` | `(error) => { status, body }`, for an error body of your own |

`createService` resolves to `{ app, port, url, stop() }`, see
[Ports and the banner](#ports-and-the-banner); the logger is described under
[Logging](#logging).

## Requirements

Node.js 22 or later, or Bun. ESM only. Express 5.

## Links

- [The stack's README](https://github.com/open-tomato/service#readme)
- [Changelog](https://github.com/open-tomato/service/blob/main/packages/service-express/CHANGELOG.md)
- [Issues](https://github.com/open-tomato/service/issues)

Licensed under Apache-2.0.
