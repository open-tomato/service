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

const requestLogger = logger.child({ traceId: '3f2a9c1e5d6b4a' });
requestLogger.warn({ attempt: 2 }, 'retrying the payment call');
```

Every record carries `service: 'orders'` and the `context` fields, so a log
aggregator can filter by service. The level comes from `options.level`,
then `LOG_LEVEL`, then `info`.

The browser build has the same `createLogger(name, options)` and the same
`Logger` interface; bundlers pick it through the package's `browser` export
condition. It has no terminal format, so `format`, `pretty`, `LOG_FORMAT` and
`NO_COLOR` do nothing there.

## Terminal or JSON

A record is written in one of two formats:

- `terminal` draws one readable line for a person, coloured by level:

  ```text
  12:04:31.250 INFO  orders  3f2a9c1e  Users:create  user created  userId=42
  ```

- `json` writes pino's record unchanged, one JSON object per line, for a log
  shipper, `jq` or any other program that reads the records.

Standard output is for people, so a terminal gets `terminal`. A pipe or a file
gets `json`, because whatever reads one is a program that wants the raw
records; pino's JSON is not meant for a person to read, so the line is drawn
on the way out and the record stays whole.

The format is picked once, when the logger is built. The first rung that
answers wins:

1. the `format` option, `terminal` or `json`;
2. `LOG_FORMAT`, when set to exactly `terminal` or `json`; any other value is
   ignored;
3. the deprecated `pretty` option: `true` is `terminal`, `false` is `json`;
4. whether stdout is a TTY: a terminal gets `terminal`, anything else `json`.

`NODE_ENV` plays no part. A service run by hand in a terminal prints readable
lines whatever its `NODE_ENV`, and a piped one prints JSON.

Colour is on for `terminal`. Setting `NO_COLOR` to any non-empty value turns it
off, and the setting is read on every line. `json` never has colour.

An error passed as `err` keeps its `cause` chain. The `json` record carries it
as nested objects, each with its own `type`, `message`, `stack` and `cause`;
`terminal` draws one `<type>: <message>` line per link, indented under the
record, and at most ten links.

## Breadcrumbs

Four fields are drawn as slots rather than `key=value` pairs, so the lines of
one request read as a path through the code:

- `traceId` shows its first 8 characters, `3f2a9c1e` above;
- `domain`, `scope` and `step`, those present, are joined by `:` in that
  order into one signature slot: `Users:create:insert` for all three,
  `Users:create` for a domain and a scope, `Users` for the domain alone.

Bind them with `child`. The core's `scoped(logger, 'Users', 'create')`, from
`@open-tomato/service`, sets the scope for you. A record with neither slot
draws no placeholder.

```ts
import { createLogger } from '@open-tomato/service-logger';

const logger = createLogger('orders');
const scopedLogger = logger.child({
  traceId: '3f2a9c1e5d6b4a',
  scope: 'Users:create',
});
scopedLogger.info({ userId: 42 }, 'user created');
```

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
| `format` | `LOG_FORMAT`, then `pretty`, then `terminal` on a TTY and `json` otherwise | `terminal` for readable lines, `json` for pino's records; see [Terminal or JSON](#terminal-or-json) |
| `pretty` | none | deprecated: `true` is `format: 'terminal'`, `false` is `format: 'json'`, read only when neither `format` nor `LOG_FORMAT` is set |

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
