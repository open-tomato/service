# @open-tomato/service

[![npm](https://img.shields.io/npm/v/@open-tomato/service?label=npm&color=cb3837)](https://www.npmjs.com/package/@open-tomato/service)
[![CI](https://github.com/open-tomato/service/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/open-tomato/service/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/open-tomato/service/blob/main/LICENSE)

The framework-free core of the [@open-tomato/service](https://github.com/open-tomato/service)
stack. It gives a TypeScript service the parts every service needs:

- **Dependencies with a lifecycle.** A database pool, a queue or a cache
  becomes a `Dependency` with `start`, `stop`, `pause` and `resume`, a
  `status` you can read, and an optional health probe.
- **Typed HTTP clients.** Wrap any client object, and every method call on it
  retries with backoff and goes through a circuit breaker, with the client's
  own types kept.
- **A runtime** that starts them in order, undoes a start that fails part
  way, stops them in reverse and reports their health, the same way under
  every adapter.

Use it through an adapter: [`@open-tomato/service-express`](https://www.npmjs.com/package/@open-tomato/service-express)
for an HTTP service, or [`@open-tomato/service-mcp`](https://www.npmjs.com/package/@open-tomato/service-mcp)
for a Model Context Protocol server. The adapters start and stop what you
hand them.

```sh
npm install @open-tomato/service
```

## A dependency

`createDependency` turns anything with a start and a stop into a managed
dependency. Pass `client` and the dependency carries it, typed.

```ts
import { createDependency } from '@open-tomato/service';

class Cache {
  private readonly store = new Map<string, string>();
  async connect(): Promise<void> { /* open the connection */ }
  async close(): Promise<void> { /* close it */ }
  async get(key: string): Promise<string | undefined> { return this.store.get(key); }
}

const cache = new Cache();

const cacheDep = createDependency({
  name: 'cache',
  client: cache,
  onStart: () => cache.connect(),
  onStop: () => cache.close(),
  healthDetail: () => ({ connected: true }),
});

await cacheDep.start();
console.log(cacheDep.status); // 'running'
await cacheDep.client.get('greeting'); // typed as Cache
await cacheDep.stop();
```

A dependency moves through `stopped → starting → running → stopping →
stopped`, can be `paused` and resumed, and lands in `error` when a hook
throws.

## A typed HTTP client

`createHttpClient` wraps a client object of your own. Each method call
retries on failure and passes through a circuit breaker; after enough
consecutive failures the breaker opens and calls fail fast with
`CircuitOpenError` until a probe succeeds.

```ts
import { CircuitOpenError, createHttpClient } from '@open-tomato/service';

class InventoryApi {
  async stock(sku: string): Promise<number> {
    const res = await fetch(`http://inventory:3000/stock/${sku}`);
    if (!res.ok) throw new Error(`inventory answered ${res.status}`);
    const body = await res.json() as { count: number };
    return body.count;
  }
}

const inventory = createHttpClient(new InventoryApi(), {
  name: 'inventory',
  retry: { attempts: 3, backoff: 'exponential', jitter: true },
  circuitBreaker: { threshold: 5, timeout: 30_000 },
});

await inventory.start();
try {
  const count = await inventory.stock('sku-42');
  console.log(count);
} catch (error) {
  if (error instanceof CircuitOpenError) {
    // inventory keeps failing: answer from a fallback instead of waiting
  }
}
```

| Option | Default | Meaning |
|---|---|---|
| `name` | required | the client's name, shown in health reports and logs; non-empty |
| `retry.attempts` | `3` | calls in total, the first one included |
| `retry.backoff` | `'exponential'` | `'exponential'` doubles the wait, `'linear'` keeps it constant |
| `retry.jitter` | `false` | adds a random part to each wait |
| `circuitBreaker.threshold` | `5` | consecutive failures that open the breaker |
| `circuitBreaker.timeout` | `30000` | milliseconds before an open breaker lets a probe through |

## A runtime

`createRuntime` takes a service's dependencies and clients as named
records and starts and stops them as one. Each comes back under its key,
with its own type.

```ts
import { createDependency, createHttpClient, createRuntime } from '@open-tomato/service';

class InventoryApi {
  async stock(sku: string): Promise<number> { return sku.length; }
}

const runtime = createRuntime({
  serviceId: 'orders',
  dependencies: {
    cache: createDependency({ name: 'cache', client: new Map<string, string>() }),
  },
  clients: {
    inventory: createHttpClient(new InventoryApi(), { name: 'inventory' }),
  },
});

await runtime.ensureStarted();
runtime.deps.cache.client.set('greeting', 'hello'); // typed as Map<string, string>
await runtime.clients.inventory.stock('sku-42');
console.log(runtime.health()); // { status: 'ok', dependencies: { cache: 'running', inventory: 'running' } }

console.log(await runtime.stop()); // { stopped: ['inventory', 'cache'], failed: [], timedOut: [] }
```

- **Order.** Dependencies start in key order, then clients; `stop()`
  stops them in reverse.
- **One start.** `ensureStarted()` starts once: calls made during a start
  share it, and a call once running resolves at once. If a dependency
  fails, the ones already started are stopped in reverse, the call rejects
  with that error, and the next call tries again.
- **A stop that always finishes.** `stop()` never rejects. Each
  dependency gets `stopTimeoutMs` (10 000 by default); one that fails or
  outlasts it is reported, and the rest still stop.
- **Names.** Health reports and logs use each dependency's own `name`,
  which must be unique across dependencies and clients; `createRuntime`
  throws a `TypeError` otherwise.

## Health

`aggregateHealth` folds the statuses of a service's dependencies and
clients into one report, the rule every adapter's health route answers
with. Anything with a `name` and a `status` fits, so dependencies and
clients go in as they are. `HEALTH_HTTP_STATUS` maps the overall status to
200 or 503.

```ts
import { aggregateHealth, HEALTH_HTTP_STATUS } from '@open-tomato/service';

const report = aggregateHealth([
  { name: 'db', status: 'running' },
  { name: 'inventory', status: 'degraded' },
], { started: true });
// { status: 'degraded', dependencies: { db: 'running', inventory: 'degraded' } }

console.log(HEALTH_HTTP_STATUS[report.status]); // 200
```

The overall status is the worst one any dependency gives:

| Dependency status | Before start | After start |
|---|---|---|
| `running` | `ok` (200) | `ok` (200) |
| `starting`, `degraded`, `paused` | `degraded` (200) | `degraded` (200) |
| `stopped`, `stopping` | `degraded` (200) | `error` (503) |
| `error` | `error` (503) | `error` (503) |

Before start, a stopped dependency counts as degraded, so a service that
starts on its first request still answers 200 to the probe that lets that
request through.

## Control

The control operations are plain functions over a runtime. Each returns a
`{ code, body }` pair, so an adapter only maps it onto its transport.

```ts
import { controlStatus, createRuntime, verifyControlToken } from '@open-tomato/service';

const secret = 'configured-secret';
const sent = 'configured-secret'; // the x-control-token header, in an adapter
const runtime = createRuntime({ serviceId: 'orders' });
const startedAt = Date.now();
await runtime.ensureStarted();

if (await verifyControlToken(sent, secret)) {
  const { code, body } = controlStatus(runtime, { version: '2.0.0', startedAt });
  console.log(code, body.status); // 200 'ok'
}
```

- `controlStatus(runtime, { version, startedAt })`: the overall health,
  uptime, version, and each dependency and client. Always 200.
- `listDependencies(runtime)`: each dependency's name, status and health
  detail.
- `pauseDependency`, `resumeDependency`, `restartDependency` and
  `resetClient`, each `(runtime, name)`: 200 `{ ok: true }`, 400 for an
  empty name or a missing `pause`/`resume`, 404 for an unknown name, 500
  `{ error }` when the dependency throws.
- `verifyControlToken(given, expected)`: compares a token in constant
  time through WebCrypto. A non-string token or an empty secret is
  rejected.

## Logging

The core writes through a `Logger`: the part of pino's API the stack uses.
A pino logger fits it, and so does one from
[`@open-tomato/service-logger`](https://www.npmjs.com/package/@open-tomato/service-logger),
which is what the adapters create. For code that runs without an
adapter, `createConsoleLogger` needs no dependency and runs anywhere a
`console` exists.

```ts
import { createConsoleLogger } from '@open-tomato/service';

const logger = createConsoleLogger('orders', { level: 'debug' });

logger.info({ orderId: 'o-1' }, 'order created');
// console.info('order created', { level: 'info', service: 'orders', orderId: 'o-1' })

logger.child({ requestId: 'r-9' }).warn('slow upstream');
```

The level comes from `options.level`, then `LOG_LEVEL`, then `info`. An
`Error` passed as the first argument lands under `err`, so its message and
stack survive.

## Exports

| Export | What it is |
|---|---|
| `createDependency(opts)` | a `Dependency`, or a `TypedDependency<T>` when `opts.client` is given |
| `createHttpClient(client, opts)` | the client with retry and a circuit breaker, plus the `Dependency` lifecycle; `opts.name` is required |
| `withRetry(fn, config?)` | runs `fn` with the same retry policy, for a call that is not a client method |
| `CircuitBreaker`, `CircuitState` | the breaker a client uses, for wrapping any async call; its state is `'closed'`, `'open'` or `'half-open'` |
| `CircuitOpenError` | thrown by a breaker's call while it is open |
| `createRuntime(options)` | the runtime that starts, stops and reports on a service's dependencies and clients |
| `Runtime`, `RuntimeOptions`, `RuntimeState`, `StopResult`, `DependencyRecord` | the runtime's types |
| `controlStatus`, `listDependencies`, `pauseDependency`, `resumeDependency`, `restartDependency`, `resetClient` | the control operations, each returning `{ code, body }` |
| `verifyControlToken(given, expected)` | the control token check, constant time, on WebCrypto |
| `ControlResult`, `ControlActionBody`, `ControlStatusBody`, `ControlStatusOptions`, `ControlTarget`, `DependencyControlStatus`, `ClientControlStatus` | the control operations' types |
| `aggregateHealth(dependencies, options)`, `HEALTH_HTTP_STATUS` | the one health rule, and its HTTP status per overall status |
| `HealthReport`, `HealthStatus`, `AggregateHealthOptions` | the health report's types |
| `createConsoleLogger(name, options?)` | a `Logger` that writes through `console`, with no dependency |
| `Logger`, `LogLevel`, `LogSink`, `ConsoleLoggerOptions` | the logger contract the stack writes through |
| `Dependency`, `TypedDependency<T>`, `DependencyStatus`, `DepsMap`, `TypedClient<T>`, `ServicePlugin` | the shared types the adapters use |

## Requirements

Node.js 22 or later, or Bun. ESM only.

## Links

- [The stack's README](https://github.com/open-tomato/service#readme), with
  an Express service and an MCP server end to end
- [Changelog](https://github.com/open-tomato/service/blob/main/packages/service/CHANGELOG.md)
- [Issues](https://github.com/open-tomato/service/issues)

Licensed under Apache-2.0.
