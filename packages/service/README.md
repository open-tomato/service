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
- **One shape for all of them**, so an adapter can start them in order, stop
  them in reverse and report their health.

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
| `retry.attempts` | `3` | calls in total, the first one included |
| `retry.backoff` | `'exponential'` | `'exponential'` doubles the wait, `'linear'` keeps it constant |
| `retry.jitter` | `false` | adds a random part to each wait |
| `circuitBreaker.threshold` | `5` | consecutive failures that open the breaker |
| `circuitBreaker.timeout` | `30000` | milliseconds before an open breaker lets a probe through |

## Exports

| Export | What it is |
|---|---|
| `createDependency(opts)` | a `Dependency`, or a `TypedDependency<T>` when `opts.client` is given |
| `createHttpClient(client, opts?)` | the client with retry and a circuit breaker, plus the `Dependency` lifecycle |
| `CircuitOpenError` | thrown by a client call while its breaker is open |
| `createServiceLogger(serviceId, options?)` | a pino logger bound to `serviceId`, from [`@open-tomato/service-logger`](https://www.npmjs.com/package/@open-tomato/service-logger) |
| `Dependency`, `TypedDependency<T>`, `DependencyStatus`, `DepsMap`, `TypedClient<T>`, `ServicePlugin` | the shared types the adapters use |

## Requirements

Node.js 22 or later, or Bun. ESM only.

## Links

- [The stack's README](https://github.com/open-tomato/service#readme), with
  an Express service and an MCP server end to end
- [Changelog](https://github.com/open-tomato/service/blob/main/packages/service/CHANGELOG.md)
- [Issues](https://github.com/open-tomato/service/issues)

Licensed under Apache-2.0.
