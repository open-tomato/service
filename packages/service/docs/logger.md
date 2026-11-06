# logger

The `Logger` interface every package writes through, a dependency-free
`createConsoleLogger`, and the breadcrumb fields that say where a record
came from.

## The breadcrumb hierarchy

A record may carry four breadcrumb fields, each named by a constant so no
package spells the field as a string literal:

| Field | Constant | Set by | Bound |
|---|---|---|---|
| `traceId` | `TRACE_ID_FIELD` | the adapter, per request | yes |
| `domain` | `DOMAIN_FIELD` | `inDomain(logger, 'Users')`, when a domain's logger is made | yes |
| `scope` | `SCOPE_FIELD` | `scoped(logger, 'create')`, at an entry point of a file's workflow | yes |
| `step` | `STEP_FIELD` | each call's context object | never |

`traceId`, `domain` and `scope` are bound with `child`, so every record the
child writes carries them. The step is never bound: it goes in the context
object of the one call it describes, so the next call on the same logger
carries no step unless it passes its own.

```ts
import type { Logger } from '@open-tomato/service';

declare const log: Logger;
log.info({ step: 'insert', userId: 'u-1' }, 'user created');
```

`LogBreadcrumb` types the four fields, each an optional string.

An adapter adopts a trace id from a request (its `x-request-id`) only when
`isTraceId` accepts it: a string matching `TRACE_ID_PATTERN`,
`/^[A-Za-z0-9._:-]{1,64}$/`. That admits a UUID and a W3C `traceparent`
value (55 characters) and keeps spaces and control characters, such as ESC,
out of the logs. Anything else is replaced by an id the adapter makes.

`inDomain` and `scoped` both return a child, and a child's bindings win
over its parent's: calling `inDomain` on a domain logger replaces the domain
and keeps the trace id and the scope, and scoping a scoped logger replaces
the scope and keeps the trace id and the domain. Neither touches the logger
it was given.

## Case convention

The domain is in PascalCase (`Users`); the scope and the step are in
camelCase (`create`, `insert`). `scoped(logger, scope)` writes the scope
as given; the domain comes from `inDomain`, so a domain's entry point reads
`scoped(inDomain(logger, 'Users'), 'create')`.

## How it is tested

`src/logger.test.ts` writes through `createConsoleLogger` into a recording
sink and checks each record's fields: that `inDomain` and `scoped` leave
the logger they were given unchanged, that a record carries the `domain`
or `scope` bound on it, that `inDomain` then `scoped` give `domain` and
`scope` as two fields, that a second `scoped` replaces the scope and keeps
the domain, that a second `inDomain` replaces only the domain, that a call's
`step` reaches only its own record and the next record carries none, and
that the constants name the fields `traceId`, `domain`, `scope` and
`step`. `src/index.test.ts` pins their exports.

## Usage

```ts
import { createConsoleLogger, inDomain, TRACE_ID_FIELD } from '@open-tomato/service';

const users = inDomain(createConsoleLogger('users'), 'Users');
const log = users.child({ [TRACE_ID_FIELD]: 't-1' });
log.info({ step: 'insert' }, 'user created');
// carries traceId: 't-1', domain: 'Users', step: 'insert'
```
