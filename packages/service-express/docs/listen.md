# listen

The Node side of the core's port rule. The core's `pickPort` decides which
port to bind but cannot open a socket, so this module supplies the probe and
does the listen.

- `isPortFree(port)` listens on the port with a throwaway `node:net` server
  and closes it again. It answers `false` when the listen fails with
  `EADDRINUSE` and `true` when it succeeds; any other listen error, such as
  `EACCES` for a privileged port, rejects.
- `listenOnPickedPort(server, options)` calls `pickPort` with the asked
  `port`, the `strict` flag, the `configKey` and the optional `range`, then
  listens `server` on the port it picked. It answers the pick, with `port`
  read back from the bound address, so port `0` answers the port the system
  chose. `requested` and `fellBack` come from the pick unchanged.
- `resolvePortConfig(config, env)` settles what to ask for. The port comes
  from the config's `port` when set, else from `PORT`, else from 3000; the
  strict flag comes from the config's `strictPort` when set, else from
  `PORT_STRICT`, else `false`. Each is settled on its own, so a config port
  can pair with an env strict flag. `PORT_STRICT` is strict only for `true`
  or `1` (in any case, ignoring surrounding spaces); any other value is not
  strict. An empty `PORT` counts as unset, and one that is not a whole
  number throws a `RangeError` naming `PORT`. The answer carries
  `portGiven`, `false` only when the port is the default, so a caller can
  tell a named port from the fallback default. `env` defaults to
  `process.env`.

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
  caller can warn about a fallback before the service starts listening. It
  runs twice when the listen re-picks.

## How it is tested

`src/listen.test.ts` opens real `node:net` servers on ports the system
chose, so no test names a fixed port. It checks that a held port probes
taken and the same port probes free once released, that a strict pick of a
held port rejects with `PortInUseError` without listening, that a held port
falls back to a later one within the range, and that a free port and port
`0` are listened on as asked. A probe that lies once about a held port
drives the one re-pick; a probe that calls every port free drives the
second `EADDRINUSE` into `PortInUseError`. Setting the attempts to one
fails both re-pick cases, and a probe that never answers `false` fails the
probe and fallback cases, so the checks can fail.

The `resolvePortConfig` cases pass an `env` record, so they leave
`process.env` alone, except one that sets `PORT` and `PORT_STRICT` to show
the default and restores both. They check the defaults, the config read
before the env, the env read when the config is silent, port and strict
settled each on its own, a config port `0` counted as given, each strict
and non-strict spelling of `PORT_STRICT`, and a malformed `PORT`. Reading
the env before the config and dropping the `1` spelling fail six of them.

## Usage

The module is internal to the adapter and is not exported from the package
entry. A caller passes a server that is not listening yet, such as one made
with `node:http` `createServer(app)`, with the resolved port, the strict
flag and the config key the error should name, and reads the bound port
from the answer.
