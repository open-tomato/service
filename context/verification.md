# Verification

`bun run gates` is the full run. It runs each gate as its own process, in
order, prints one line per gate with its exit code and duration, and stops
at the first failure.

| Gate | Command | What it proves |
|---|---|---|
| lint | `eslint .` | style and import order across every package, the scripts and the Markdown |
| check-types | `turbo run check-types` and the root `tsc` | strict types under NodeNext, test files included |
| test | `turbo run test` | each package's vitest suites |
| test-scripts | `bun test scripts` | the repository scripts, such as the gate runner |
| build | `turbo run build` | `tsc` emits JS, declarations and maps into each `dist/` |
| check-node | `node scripts/check-node.mjs` | every public package's built entry imports under real Node |

## Scoped runs

For a change in one package, run its suite from the package directory with
`bunx vitest run`, or one file with `bunx vitest run <file>`. Across the
workspace, `bunx turbo run test --affected` runs the packages a branch
changed. A diff that touches `package.json`, `bun.lock`, `turbo.json` or a
`tsconfig*.json` needs the full run.

Turbo caches task results. A cached test replays its earlier log without
running, so pass `--force` when the question is whether the suite passes
now.

## Test conventions

- Vitest, in the Node environment. A suite sits beside its module as
  `src/<module>.test.ts`, or under the package's `tests/` folder.
- Test files are type-checked by check-types, so an `@ts-expect-error` in a
  test is a real assertion.
- The MCP suites run under Node with a small `Bun.serve` stand-in
  (`packages/service-mcp/tests/bun-polyfill.ts`), because the adapter's
  HTTP transport calls `Bun.serve` today.

## Why check-node exists

Bun resolves imports more loosely than Node: it finds `./thing` without an
extension, and package subpaths that a package's exports map does not
list. A package can pass every test on Bun and still fail to import for a
Node user. check-node loads the built output under Node, the runtime the
packages' users run.
