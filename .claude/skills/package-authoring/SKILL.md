---
name: package-authoring
description: "Use when adding a package (a new framework adapter such as service-nest or service-next), changing a package's manifest, exports, build or dependencies, or hitting a NodeNext import error (TS2834, TS2835) or a check-node failure."
---

# Package authoring

Every package lives at `packages/<unscoped-name>/` and publishes as
`@open-tomato/<unscoped-name>`. Copy a sibling's files rather than writing
them from memory; `packages/service-mcp/` is the closest model for an
adapter.

## The files a package has

| File | What it holds |
|---|---|
| `package.json` | the manifest below |
| `tsconfig.json` | `extends ../../tsconfig.base.json`; includes `src` and `tests` |
| `tsconfig.build.json` | emits JS, declarations and maps from `src` to `dist`; excludes tests |
| `src/index.ts` | the only entry; everything public is exported from here |
| `src/*.test.ts` or `tests/` | vitest suites; both are type-checked |

The manifest: `"type": "module"`, `"files": ["dist"]`,
`"engines": { "node": ">=22" }`, the `exports` map with `types` first, and
the three scripts `build`, `check-types` and `test`. A package that must
never publish sets `"private": true`; check-node skips it.

## Rules that the gates enforce

1. **Relative imports end in `.js`** (`./thing.js`, `./dir/index.js`).
   The base tsconfig is NodeNext, so a missing extension fails check-types
   with TS2834 or TS2835. Package subpaths follow the package's own exports
   map: the MCP SDK takes `@modelcontextprotocol/sdk/server/mcp.js`.
2. **The core imports no framework.** `packages/service` depends on no
   adapter, no express, no MCP SDK. An adapter depends on the core with
   `workspace:^`, never the other way.
3. **An adapter owns its framework's dependencies** as `dependencies`, so a
   user of one adapter never installs another's.
4. **The built entry must import under Node.** check-node loads every
   public package's `dist` under real Node; Bun resolves more loosely, so a
   green test run on Bun proves nothing about Node.

## Adding an adapter

1. Copy `packages/service-mcp/` to `packages/service-<framework>/`, then
   empty `src/` and `tests/`.
2. Rename the package and set its description, dependencies and
   `repository.directory`.
3. Run `bun install` at the root so the workspace links the new package.
4. Write the adapter test-first; read `context/architecture.md` for what
   the core already owns.
5. Run `bun run gates`.
