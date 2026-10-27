# AGENTS — @open-tomato/service

A bun and turbo workspace that publishes the service stack to npm: a
framework-agnostic core, and one adapter package per framework. The core
holds what every service needs (dependency lifecycle, typed HTTP clients,
retry, circuit breaking, logging), so a service built on an adapter is
mostly configuration and the wiring of its endpoints.

## Packages

| Directory | Package | Role |
|---|---|---|
| `packages/service` | `@open-tomato/service` | the core; imports no framework |
| `packages/service-express` | `@open-tomato/service-express` | Express 5 adapter |
| `packages/service-mcp` | `@open-tomato/service-mcp` | Model Context Protocol adapter |
| `packages/service-logger` | `@open-tomato/service-logger` | pino logger, Node and browser entries |
| `packages/service-errors` | `@open-tomato/service-errors` | private; being split into core and Express |

The core never imports a framework, and an adapter never re-implements what
the core can own. `context/architecture.md` has the layering, where each
concern lives today, and what is moving.

## Gates

`bun run gates` runs lint, check-types, test, test-scripts, build, pack
and check-node, in that order, and stops at the first failure. Test files are
type-checked too. `context/verification.md` says what each gate proves and
how to run one scoped to a change.

## Docs: the shadow tree

`packages/<name>/src/<path>.ts` pairs with `packages/<name>/docs/<path>.md`.
Source keeps only the doc blocks for its functions and types; what a module
does, why, how it is tested and how to use it goes in its doc file. A file
with nothing to explain gets no doc file, and nothing links between the two:
the directory structure is the link. A move carries the doc file in the same
commit. Generated output goes to the gitignored `.docs/`.

## What is not tracked

`.rafa/` (specs, plans and loop state), `.tmp/` (gate captures and scratch),
`.docs/`, `.reference/` and `progress.txt`. Specs live on the board as
`type:spec` issues, and `rafa plan create --issue=<n>` snapshots one into
`.rafa/specs/`. No tracked file may name a host, a home path, an IP address
or a private repository: `context/privacy.md`.

## Context pages

Read the page for the subject at hand; none is loaded by default.

- `context/architecture.md`: layers, packages, where each concern lives
- `context/verification.md`: the gates, scoped runs, test conventions
- `context/privacy.md`: what a public repo must not carry, the hook, CI
- `context/release.md`: versions, fragments and publishing

## Skills and agents

Skills in `.claude/skills/`: `package-authoring` (manifests, NodeNext
imports, adding an adapter), `documentation` (where text lives),
`git-workflow`, `git-add-partial-failure`. Agents in `.claude/agents/`:
`architect`, `loop-implementer`, `tdd-guide`, `code-reviewer`,
`build-error-resolver`, `doc-updater`, `qa-bug-reporter`.

This file is capped at 80 lines. A new fact goes to the context page that
owns its subject, never inline here.
