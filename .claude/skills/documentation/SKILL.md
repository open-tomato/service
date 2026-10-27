---
name: documentation
description: "Use when writing or changing a doc block in source, adding or moving a file under packages/*/docs, or deciding where a piece of documentation belongs (source, the docs tree, a context page, or the gitignored .docs output)."
---

# Documentation

Three places hold documentation here, and each kind of text has one home.

| Text | Home | Tracked |
|---|---|---|
| What a function, type or constant is: params, returns, throws | a doc block in source | yes |
| What a module does, why, how it is tested, how to use it | `packages/<name>/docs/<path>.md`, the twin of `src/<path>.ts` | yes |
| A subject that spans packages (layering, gates, release, privacy) | `context/<subject>.md` | yes |
| Generated reference output (TypeDoc) | `.docs/` | no |

## The shadow-docs rule

- `packages/<name>/src/<path>.ts` pairs with `packages/<name>/docs/<path>.md`.
  A file with nothing to explain gets no doc file.
- Source keeps only the doc blocks for its functions and types. The TSDoc
  rules are in `rules/tsdoc.md`.
- No links in either direction: no `{@link}` to a doc file, and no doc file
  pointing at line numbers. The directory structure is the link.
- A source file that moves or is renamed takes its doc twin with it in the
  same commit.
- When source and doc disagree between runs, the code wins; fix the doc in
  the same commit as the change that made it wrong.

## Not installed yet

TypeDoc and OpenAPI generation are not set up in this repo. OpenAPI belongs
in the core once it exists (see `context/architecture.md`), so an adapter
renders a document the core describes. Until then, write no TypeDoc or
OpenAPI configuration; generated output, when it comes, goes to `.docs/`.
