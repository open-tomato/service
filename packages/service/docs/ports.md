# ports

The port rule every adapter follows before it listens. `pickPort` takes the
port asked for, a `strict` flag, the config key that sets the port, and an
`isFree` probe, and answers the port to bind.

- A free port is taken as asked, `strict` or not.
- A taken port under `strict` throws `PortInUseError`, whose message names
  the port, says it is taken, and names the config key:
  `port 3000 is taken; set PORT to a free port`.
- A taken port without `strict` falls back to the first free port of the
  next `PORT_FALLBACK_RANGE` (20) ports, capped at 65535. The answer carries
  `fellBack: true` and the `requested` port, so the startup banner can say
  so.
- When every port of that range is taken, `PortInUseError` names the range
  instead: `ports 3000-3020 are all taken; set port to a free port`.
- Port `0` asks the system for any free port, so it is taken without a
  probe.
- A port outside 0 to 65535, a non-integer port, or a range that is not a
  positive integer throws `RangeError` before any probe runs. A probe that
  rejects passes its error on.

## Why the probe is injected

The core imports no Node built-in, so it cannot open a socket. The adapter
owns `isFree` (a `node:net` server that listens and closes), and the core
owns the rule: which ports to try, in which order, and what the error says.

`PortInUseError` is an `AppError` answering 500 `PORT_IN_USE`, with
`details` holding `port`, `configKey` and, when a fallback ran out, `range`.
It is thrown at startup, before any request, so the status only matters
where it passes through `toErrorResponse`.

## Usage

```ts
import { pickPort } from '@open-tomato/service';

// The adapter's own probe; this one calls every port free.
const isFree = (port: number): Promise<boolean> => Promise.resolve(port > 0);

const picked = await pickPort({ port: 3000, strict: false, configKey: 'port', isFree });
console.info(picked.port, picked.requested, picked.fellBack);
```

## Tests

`src/ports.test.ts` drives `pickPort` with a fake `isFree` over a fixed set
of taken ports and records each probe. It covers the failures first (taken
under `strict`, a range used up, the range capped at 65535, bad ports and
ranges, a failing probe), then a free port, a fallback, a given range and
port `0`.
