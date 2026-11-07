# listen

The Node side of the core's port rule for the MCP adapter. The core's
`pickPort` decides which port to bind but cannot open a socket, so this
module supplies the probe and does the listen. It keeps the same contract
as the Express adapter's helper of the same name, so both adapters treat a
taken port the same way.

- `isPortFree(port)` listens on the port with a throwaway `node:net` server
  and closes it again. It answers `false` when the listen fails with
  `EADDRINUSE` and `true` when it succeeds; any other listen error, such as
  `EACCES` for a privileged port, rejects.
- `listenOnPickedPort(server, options)` calls `pickPort` with the asked
  `port`, the `strict` flag, the `configKey` and the optional `range`, then
  listens `server` on the port it picked. It answers the pick, with `port`
  read back from the bound address, so port `0` answers the port the system
  chose. `requested` and `fellBack` come from the pick unchanged.
- `resolvePortConfig(config, env)` settles what to ask for, for both
  servers. The transport port comes from `config.port`, else `PORT`, else
  `8080`; its strict flag from `config.strictPort`, else `PORT_STRICT`,
  else `false`. The health server reads `config.health.port`, else
  `HEALTH_PORT`, else `3001`, and `config.health.strictPort`, else
  `HEALTH_PORT_STRICT`, else `false`. Each of the four is settled on its
  own. A strict variable is `true` only for `true` or `1`, any case, around
  any whitespace. An empty port variable counts as unset, and one that is
  not a whole number throws a `RangeError` naming the variable. `env`
  defaults to `process.env`.
- `warnOnFallback(logger, pick, names)` logs one `warn` record when a pick
  fell back, with `takenPort`, the bound `port`, and the `strictKey` and
  `strictEnv` that turn the fallback into an error, and a message reading
  `port <taken> is taken, falling back to <port>; set <strictKey> or
  <strictEnv>=true to fail instead`, the Express adapter's wording. A pick
  that did not fall back logs nothing. A caller passes it as `onPicked`.

## Why the schema leaves the ports unset

`MCPConfigSchema` gives `port`, `strictPort`, `health.port` and
`health.strictPort` no default, so an omitted field stays `undefined` and
`resolvePortConfig` can tell it apart from one the caller set. A schema
default would hide the environment. Port `0` is a value the caller set,
not an omission.

## Why it re-picks once

A probe and the listen that follows it are two separate binds, so another
socket can take the port between them. When the real listen fails with
`EADDRINUSE`, `listenOnPickedPort` runs `pickPort` once more, which now
probes that port as taken and moves on (or, under `strict`, throws
`PortInUseError`), and listens again. A second `EADDRINUSE` throws
`PortInUseError` for the port of that second listen, with the listen error
as its `cause`. Any other listen error passes on as it is, and so does an
error from the probe.

## The options

Beyond the fields of the core's `PickPortOptions`, two are optional:

- `isFree` replaces `isPortFree` as the probe. The tests use it to make a
  probe call a held port free, the way a lost race does.
- `onPicked` is called with each pick before the server listens on it, so a
  caller can warn about a fallback before the server starts listening. It
  runs twice when the listen re-picks.

## How it is tested

`tests/listen.test.ts` opens real `node:net` servers on ports the system
chose, so no test names a fixed port. It checks that a held port probes
taken and the same port probes free once released, that a strict pick of a
held port rejects with `PortInUseError` naming the config key without
listening, that a held port falls back to a later one within the range, and
that a free port and port `0` are listened on as asked. A probe that lies
once about a held port drives the one re-pick; a probe that calls every
port free drives the second `EADDRINUSE` into `PortInUseError`. Setting the
attempts to one fails both re-pick cases, and a probe that never answers
`false` fails the probe, the fallback and the first re-pick case, so the
checks can fail.

The `resolvePortConfig` cases pass an `env` record, so they leave
`process.env` alone, except one that sets the four variables to show the
default and restores them. They check the defaults, the config read before
the env, the env read when the config is silent, each value settled on its
own, the transport and health names kept apart, a config port `0` counted
as given, each strict and non-strict spelling, an empty port variable, and
a malformed `PORT` or `HEALTH_PORT`. Reading `PORT` before the config and
dropping the `1` spelling fail eight of them.

## Usage

The module is internal to the adapter and is not exported from the package
entry. A caller passes a server that is not listening yet, such as the
`node:http` server behind the HTTP transport or the health server, with the
port, the strict flag and the config key the error should name (`port` or
`health.strictPort`, say), and reads the bound port from the answer.
