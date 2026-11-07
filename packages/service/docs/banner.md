# banner

`logStarted(logger, banner)` writes the startup banner: one `info` record
with message `started` and the fields `version`, `transport` and
`features`. `url` is optional: it is written when the banner sets it,
and left out of the record, with no `url` key, for a service that has no
address, such as an MCP server on stdio (transport `stdio`). `fallbackPort`,
the port asked for, is present only when the service fell back from it to
the port in `url`. The fields in
`banner.extra` are merged in too, and a named field wins over an extra field
of the same name.

The record has no `service` field, because the logger it is written to binds
`service` on every line. pino writes a bound key once more when a record
field has the same name, so a `service` key in `banner.extra` is dropped.

## Why it is a core function

Every adapter states the same facts once it listens, so the core owns the
record's shape and each adapter fills it in. The terminal decorator draws
the record as a banner block; the JSON decorator keeps it as is.

## How it is tested

`src/banner.test.ts` passes a recording `Logger` and checks the one record:
its level, its message and its fields, with and without `fallbackPort`,
with no `url` (the record then has no `url` key), with an extra field
that clashes with a named one, and with a `service` key in `extra`. The
adapters' tests count the `service` key in the raw JSON line: one.

## Usage

```ts
import { createConsoleLogger, logStarted } from '@open-tomato/service';

logStarted(createConsoleLogger('users'), {
  version: '1.0.0',
  transport: 'http',
  url: 'http://localhost:3001',
  features: { auth: true },
  fallbackPort: 3000,
  extra: { healthUrl: 'http://localhost:3002' },
});
```
