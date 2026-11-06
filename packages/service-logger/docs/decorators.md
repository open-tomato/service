# decorators

A `Decorator` turns one pino record line, the JSON object pino serialises
and ends with a newline, into the text written for it. There are two.

- `json` returns the line unchanged, for a reader that is a program: a log
  shipper, `jq`, a pipe.
- `terminal` draws the record for a person at a terminal.

## The terminal line

One line per record, in this slot order:

```text
12:04:31.250 INFO  orders  3f2a9c1e  Users:create  user created  userId=42
```

- the time as local `HH:MM:SS.mmm`;
- the level as an upper-case word padded to five, coloured by level;
- `service`;
- the first 8 characters of the trace id;
- the scope, `<Module>:<action>`;
- the message;
- every other field as `key=value`. A string with a space, `=` or `"` is
  quoted, and an object or array is written as JSON.

The time and the level are each followed by one space, so the level word
lines up in a column; the slots after it are two spaces apart. A missing
`service`, trace id, scope or message drops its slot with no placeholder.
pino's own keys (`time`, `level`, `pid`, `hostname`, `msg`) are not repeated
as fields. The trace id and scope are read through the core's
`TRACE_ID_FIELD` and `SCOPE_FIELD`, so a rename in the core reaches the
decorator.

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
carries a string `url` is the banner `logStarted` writes. It is drawn as a
head line and one row per field: `version`, `transport`, `url`, `features`
and `fallbackPort` first, then any extra field.

```text
12:04:31.250 INFO  orders  started
  version       1.2.3
  transport     http
  url           http://localhost:3001
  features      auth=true  cache=redis
  fallbackPort  3000 (taken)
  healthUrl     http://localhost:3002
```

`features` with no entry reads `none`. A `started` message with no `url` is
an ordinary record and gets an ordinary line.

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
with and without trace id and scope, a scoped child, an error with
two nested causes, the banner `logStarted` writes, and `NO_COLOR` set, empty
and unset. Breaking the cause walk, the trace id length, the banner check,
the list of pino's own keys or either branch of the colour pick each makes a
test fail.

## Where it is used

The decorators are internal to the package: neither is exported from its
entry. A caller hands `terminal` one pino line and writes the text it
returns, so `terminal(line)` for a record of `orders` saying `ready` at
noon gives `12:00:00.000 INFO  orders  ready` and a newline.
