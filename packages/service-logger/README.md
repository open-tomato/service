# @open-tomato/service-logger

[![npm](https://img.shields.io/npm/v/@open-tomato/service-logger?label=npm&color=cb3837)](https://www.npmjs.com/package/@open-tomato/service-logger)
[![CI](https://github.com/open-tomato/service/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/open-tomato/service/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/open-tomato/service/blob/main/LICENSE)

A [pino](https://getpino.io) logger with one shape for Node.js and the
browser, and an HTTP request logger that keeps credentials out of the log.
The [@open-tomato/service](https://github.com/open-tomato/service) stack
logs through it, and it works on its own too.

```sh
npm install @open-tomato/service-logger
```

## A logger

```ts
import { createLogger } from '@open-tomato/service-logger';

const logger = createLogger('orders', { context: { region: 'eu-west-1' } });

logger.info('service started');
logger.info({ orderId: 'o-123' }, 'order created');

const requestLogger = logger.child({ requestId: 'r-9' });
requestLogger.warn({ attempt: 2 }, 'retrying the payment call');
```

Every record carries `service: 'orders'` and the `context` fields, so a log
aggregator can filter by service. The level comes from `options.level`,
then `LOG_LEVEL`, then `info`. Records print as JSON, or pretty-printed when
`options.pretty` is set or `NODE_ENV=development`.

The browser build has the same `createLogger(name, options)` and the same
`Logger` interface; bundlers pick it through the package's `browser` export
condition.

## An HTTP request logger

`createHttpLogger` returns [pino-http](https://www.npmjs.com/package/pino-http)
middleware for Express or `node:http`. It redacts the `authorization`,
`cookie` and `x-api-key` headers, gives each request an id (the
`x-request-id` header when present), and skips routes under `/_health` and
`/_control`.

```ts
import { createServer } from 'node:http';

import { createHttpLogger, createLogger } from '@open-tomato/service-logger';

const httpLogger = createHttpLogger({
  logger: createLogger('orders'),
  redact: ['req.headers["x-session"]'],
  ignoreRoutes: ['/metrics'],
});

createServer((req, res) => {
  httpLogger(req, res);
  res.end('ok');
}).listen(3000);
```

With Express, pass it to `app.use(httpLogger)`.

## Options

| `createLogger` option | Default | Meaning |
|---|---|---|
| `level` | `LOG_LEVEL`, then `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` or `silent` |
| `context` | none | fields added to every record |
| `pretty` | `NODE_ENV=development` | human-readable output, through `pino-pretty` |

| `createHttpLogger` option | Default | Meaning |
|---|---|---|
| `logger` | a new pino logger | the logger to write through |
| `redact` | the three headers above | more paths to redact, added to the defaults |
| `ignoreRoutes` | `/_health`, `/_control` | more route prefixes to leave unlogged |

`LOG_REDACT`, a comma-separated list of paths, adds redactions from the
environment.

## Requirements

Node.js 22 or later, Bun, or a browser bundler. ESM only.

## Links

- [The stack's README](https://github.com/open-tomato/service#readme)
- [Changelog](https://github.com/open-tomato/service/blob/main/packages/service-logger/CHANGELOG.md)
- [Issues](https://github.com/open-tomato/service/issues)

Licensed under Apache-2.0.
