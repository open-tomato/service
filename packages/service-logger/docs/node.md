# node

The Node entry: `createLogger` builds a pino logger, and `createHttpLogger`
wraps pino-http around one.

## The destination

The `destination` option, `'stdout'` (the default) or `'stderr'`, names the
process stream every record goes to, in both formats. It is read once when
the logger is built and also decides the last rung of the format pick. A
stdio MCP server uses `'stderr'`, because its stdout carries the protocol.
The browser entry ignores the option.

## The format pick

`createLogger` writes every record through one of two channels, picked once
when the logger is built. The first rung that gives an answer wins:

1. the `format` option, `'terminal'` or `'json'`;
2. `LOG_FORMAT`, when it is exactly `terminal` or `json`. Any other value,
   `JSON` or `pretty` included, is ignored and the pick goes on;
3. the `pretty` option, a deprecated alias: `true` is `terminal`, `false`
   is `json`;
4. the `isTTY` of the destination stream, `process.stdout` or
   `process.stderr`: `true` is `terminal`, anything else, a pipe or a file,
   is `json`. With `destination: 'stderr'`, a TTY stderr gives `terminal`
   even when stdout is a pipe.

`NODE_ENV` takes no part. A child logger writes through its parent's
channel.

## The channels

Both formats hand pino one synchronous stream over the destination. Each
line pino writes goes to the destination's `write` before the log call
returns:

- `json` passes pino's record through unchanged, one JSON object per line.
- `terminal` passes it through the `terminal` decorator
  (`docs/decorators.md`) and writes the text it returns.

The stream looks up `process.stdout` or `process.stderr`, and its `write`,
on every write rather than capturing them when the logger is built, so a
`write` swapped later is honoured.

Colour on the terminal channel is the decorator's: off when `NO_COLOR` is
set to a non-empty value.

## Errors

`createLogger` sets pino's `errWithCause` serializer for `err`, so an error's
`cause` chain survives as nested objects, each with its own `type`, `message`,
`stack` and `cause`. The `json` record carries that shape, and the terminal
decorator draws one `<type>: <message>` line per link of it.

## How it is tested

`src/__tests__/node-format.test.ts` fakes `process.stdout.isTTY` with
`Object.defineProperty`, sets and restores `LOG_FORMAT`, `NODE_ENV`,
`NO_COLOR` and `LOG_LEVEL` by hand, and spies on `process.stdout.write`.
Each rung of the pick is set against the
rungs below it, so a test fails when a rung is skipped or two swap; a
decorated line is checked to not parse as JSON, and a JSON one to parse.
It also checks that `NODE_ENV=development` on a pipe still gives JSON, that a
child keeps the terminal channel and writes before the call returns, and the
`err` chain in both formats.

`src/__tests__/node-destination.test.ts` spies both `process.stdout.write`
and `process.stderr.write`, and fakes and restores both `isTTY`
descriptors. It checks that a `json` and a `terminal` record with
`destination: 'stderr'` reach stderr while stdout receives nothing; that a
TTY stderr with a piped stdout gives `terminal` for `'stderr'` and `json`
for the default; that `LOG_FORMAT` and the `format` option still outrank
that rung; and that a `process.stderr.write` assigned after `createLogger`
ran still receives the line.

Inside a vitest worker `process.stdout.isTTY` is `undefined` whether or not
the run sits in a terminal, so a test that reads stdout as JSON pins
`format: 'json'` rather than relying on the worker's stdout; the tests in
`src/__tests__/node.test.ts` do.
