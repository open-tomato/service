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

## Usage

The module is internal to the adapter and is not exported from the package
entry. A caller passes a server that is not listening yet, such as the
`node:http` server behind the HTTP transport or the health server, with the
port, the strict flag and the config key the error should name (`port` or
`health.strictPort`, say), and reads the bound port from the answer.
