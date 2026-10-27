# Architecture

The stack has two layers. The core, `@open-tomato/service`, defines how a
service behaves: its dependencies and their lifecycle, its clients to other
services, and how it retries and stops calling a failing peer. An adapter
binds the core to one framework, so a service written on an adapter is
configuration plus the wiring of its endpoints.

The dependency direction is fixed. An adapter depends on the core, and the
core depends on no adapter and no framework. The goal is a core that also
runs where a long-lived Node process does not exist, such as a serverless
function or an edge runtime.

## Where each concern lives

This table shows each concern's home today and where it is moving.

| Concern | Today | Target |
|---|---|---|
| Dependency lifecycle: start, stop, pause, resume | core, `createDependency` | core |
| Service runtime: start in order, stop in reverse | Express adapter only | core `createRuntime`, used by every adapter |
| Health aggregation | one rule per adapter | one core function |
| Control operations: status, pause, resume, restart | Express adapter | core; the HTTP routes stay in the adapter |
| Typed HTTP clients | core, `createHttpClient` | core |
| Retry with exponential backoff | core, not exported | core, exported |
| Circuit breaker | core, only `CircuitOpenError` exported | core, exported |
| Logging | core builds a pino logger through `service-logger` | core takes an injected logger |
| Errors | `service-errors` | error classes in core, the HTTP handler in the Express adapter |
| Config contracts | one schema per adapter | a base schema in core that adapters extend |
| OpenAPI | not built | core describes the routes, adapters render the document |

## Framework fit

- **NestJS.** Once the runtime is in the core, a Nest module maps start and
  stop onto `onModuleInit` and `onApplicationShutdown`, and exposes the
  dependencies and clients as providers. A `service-nest` adapter is
  planned after that.
- **Next.js.** Retry, the circuit breaker, typed clients and the contracts
  work in route handlers. A route starts its dependencies on first use,
  since there is no process to start them at boot, and breaker state lives
  per instance. The edge runtime needs the core free of Node-only modules,
  which the injected logger provides.

## Known limits

The MCP adapter is on `@modelcontextprotocol/sdk` 1.x. The SDK's 2.x line is
split into separate server, Node and Express packages; moving to it is
planned.
