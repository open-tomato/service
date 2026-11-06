# decorators

A `Decorator` turns one pino record line, the JSON object pino serialises
and ends with a newline, into the text written for it. There are two.

- `json` returns the line unchanged, for a reader that is a program: a log
  shipper, `jq`, a pipe.
- `terminal` draws the record for a person at a terminal.

## The terminal line

One line per record, in this slot order:

```text
12:04:31.250 INFO  orders  3f2a9c1e  Users:create:insert  user created  userId=42
```

- the time as local `HH:MM:SS.mmm`;
- the level as an upper-case word padded to five, coloured by level;
- `service`;
- the first 8 characters of the trace id;
- the signature: the present `domain`, `scope` and `step` joined by `:` in
  that order, as `Users:create:insert`. A missing level leaves no empty
  separator, so a record with a domain and a scope reads `Users:create` and
  one with the domain alone reads `Users`; none of the three is repeated as a
  `key=value` field;
- the message;
- every other field as `key=value`. A string with a space, `=` or `"` is
  quoted, and an object or array is written as JSON;
- the request tail, when the record has one (below).

The time and the level are each followed by one space, so the level word
lines up in a column; the slots after it are two spaces apart. A missing
`service`, trace id, signature or message drops its slot with no placeholder:
a record with no `domain`, `scope` or `step` has no signature slot.
pino's own keys (`time`, `level`, `pid`, `hostname`, `msg`) are not repeated
as fields. The trace id and the three signature levels are read through the
core's `TRACE_ID_FIELD`, `DOMAIN_FIELD`, `SCOPE_FIELD` and `STEP_FIELD`, so a
rename in the core reaches the decorator.

## The request tail

A record whose `req` has a string `method` and a string `url` ends in the
request tail, the last slot of the line after any `key=value` fields:
`<method> <url>`, then `→ <res.statusCode>` when `res` has a numeric
`statusCode`, then `<responseTime>ms` when the record has a numeric
`responseTime`. The `request completed` line a request logger writes reads:

```text
12:04:31.250 INFO  orders  3f2a9c1e  request completed  POST /users → 201 3ms
```

A record with `req` and no `res` ends in `POST /users`. When the tail is
drawn, `req`, `res` and `responseTime` are left out of the `key=value` list,
so the line holds no `req=` or `res=`. A record whose `req` lacks a string
`method` or `url` has no tail and draws all three as fields, as any other
record does. A crumb logged through `req.log` carries `traceId` and no `req`,
so it has no tail. `json` writes the record unchanged, `req` and `res`
included.

## Signature levels

Each signature level is set where its value is known. The domain is bound when
a domain's logger is made, `inDomain(logger, 'Users')`. The scope is bound at
an entry point of a file's workflow, `scoped(log, 'create')`, with one
argument. The step goes in the context object of each call, as
`{ step: 'insert' }`, and is never bound: a step bound with `child` would stick
to every later record that child writes. The terminal line above is therefore
the `insert` record of `Users`, `create`, and it draws `Users:create:insert`.

Each step takes a level by one rule:

- `trace` or `debug` for a routine step, so most steps of a flow get one;
- `info` only for a key step on the use case's critical path, the records a
  persisted traceability destination keeps;
- `warn` or `error` for a step that failed.

## Errors

A record holding a serialised `err` gets one `<type>: <message>` line per
link of the error and its `cause` chain, indented under the record's line:

```text
12:04:31.250 ERROR orders  could not create order  orderId=o-1
  Error: order failed
  TypeError: bad total
  RangeError: negative
```

The chain is the nested shape pino's `errWithCause` serializer writes, each
cause an object with its own `type`, `message` and `cause`. At most ten links
are drawn, so a cyclic chain cannot loop. The stack is not drawn; the `json`
record keeps it.

## The startup banner

A record whose message is `started` (the core's `STARTED_MESSAGE`) and which
carries a string `transport` is the banner `logStarted` writes. It is drawn as
a head line and one row per field: `version`, `transport`, `url`, `features`
and `fallbackPort` first, then any extra field. The check keys on `transport`,
which every banner carries, and not on `url`, which a banner may leave out.

```text
12:04:31.250 INFO  orders  started
  version       1.2.3
  transport     http
  url           http://localhost:3001
  features      auth=true  cache=redis
  fallbackPort  3000 (taken)
  healthUrl     http://localhost:3002
```

A banner with no `url`, as a stdio server writes, has no `url` row:

```text
12:04:31.250 INFO  orders  started
  version    1.2.3
  transport  stdio
  features   none
```

`features` with no entry reads `none`. A `started` message with no string
`transport` is an ordinary record and gets an ordinary line, even when it
carries a `url`.

## Colour

`terminal` reads `NO_COLOR` on every call. Set to any non-empty value, it
turns colour off and the text is plain; unset or empty, slots are wrapped in
ANSI colour codes. `json` never adds colour.

A line that is not a JSON object is passed through, with a newline added
when it has none.

## How it is tested

`src/decorators.test.ts` runs with `NO_COLOR` stubbed so it can compare whole
lines. It feeds hand-built lines with a fixed local time, and lines a real
pino logger writes with the `errWithCause` serializer for `err`: a record
with and without trace id and signature, the signature at all three levels,
at two, at the domain alone and at none, none of its levels repeated as a
field, a child of `inDomain` with a bound `scope`, an error with two nested
causes, the banner `logStarted` writes, with and without `url`, a `started`
record with a `url` and no `transport`, a completion record ending in
`POST /users → 201 3ms` with no `req=` or `res=`, a record with `req` and no
`res` ending in `POST /users`, a crumb with no `req=`, a `req` with no method
kept as a field, a completion record `json` leaves unchanged, and `NO_COLOR`
set, empty and unset. Breaking the cause walk, the trace id length, the
signature order or its slot keys, the request tail, the banner check, the list
of pino's own keys or either branch of the colour pick each makes a test fail.

## Where it is used

The decorators are internal to the package: neither is exported from its
entry. `createLogger`'s terminal channel writes through `terminal`
(`docs/node.md`). A caller hands `terminal` one pino line and writes the text it
returns, so `terminal(line)` for a record of `orders` saying `ready` at
noon gives `12:00:00.000 INFO  orders  ready` and a newline.
