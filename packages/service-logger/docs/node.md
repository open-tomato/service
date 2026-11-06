# node

The Node entry: `createLogger` builds a pino logger, and `createHttpLogger`
wraps pino-http around one.

## The format pick

`createLogger` writes every record through one of two channels, picked once
when the logger is built. The first rung that gives an answer wins:

1. the `format` option, `'terminal'` or `'json'`;
2. `LOG_FORMAT`, when it is exactly `terminal` or `json`. Any other value,
   `JSON` or `pretty` included, is ignored and the pick goes on;
3. the `pretty` option, a deprecated alias: `true` is `terminal`, `false`
   is `json`;
4. `process.stdout.isTTY`: `true` is `terminal`, anything else, a pipe or
   a file, is `json`.

`NODE_ENV` takes no part. A child logger writes through its parent's
channel.

## The channels

- `json` hands pino no stream, so pino writes its own record to stdout,
  one JSON object per line.
- `terminal` hands pino a synchronous stream: each line pino writes is
  passed through the `terminal` decorator (`docs/decorators.md`) and the
  text it returns goes to `process.stdout.write` before the log call
  returns. stdout is read on every write, not captured when the logger is
  built.

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

Inside a vitest worker `process.stdout.isTTY` is `undefined` whether or not
the run sits in a terminal, so a test that reads stdout as JSON pins
`format: 'json'` rather than relying on the worker's stdout; the tests in
`src/__tests__/node.test.ts` do.
