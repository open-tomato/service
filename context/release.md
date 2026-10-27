# Release

Each public package versions on its own and publishes to npmjs under the
`@open-tomato` scope. `service-errors` is private and never publishes.

## Release lines

- **1.x, on `main`.** The first public release is 1.0.0. Fixes land on
  `main` and release as 1.x.
- **2.0, on `v2`.** The work for Nest.js and Next.js changes the public
  contract: the core takes an injected logger and stops exporting
  `createServiceLogger`, one health rule replaces three, and
  `service-mcp` moves to MCP SDK v2. It lives on the `v2` branch until it
  is done. Before 2.0.0 releases, `main` merges into `v2`, so every 1.x
  fix carries over. A prerelease such as `2.0.0-next.1` publishes under
  the `next` dist-tag and never becomes `latest`.

## Steps

1. **Fragment.** A branch records its change as `.changes/<plan id>.md`,
   with a `level` of `patch`, `minor`, `major` or `none` and the package
   it releases. A branch never edits a version or a changelog itself.
2. **Settle.** `rafa release settle` folds the fragments waiting on
   `main` into each package's version and `CHANGELOG.md`, in one release
   commit.
3. **Tag.** `rafa release tag --push` tags each settled package as
   `<name>@<version>` and pushes the tags.
4. **Publish.** A pushed tag starts `.github/workflows/release-publish.yml`,
   which runs the gates and `rafa release publish`. That runs
   `scripts/publish-package.ts` in each tagged package's folder: it packs
   with `bun pm pack`, which writes real versions over `workspace:^`,
   refuses a tarball the pack check rejects, and runs `npm publish` on the
   tarball. npm trusted publishing signs in from the workflow and adds
   provenance, so no token is stored.

The workflow's job runs only while the repository variable
`RAFA_RELEASE_PUBLISH` is `ci`.

## The pack check

The `pack` gate packs every public package and checks the tarball:
`LICENSE` and `NOTICE` equal to the root copies, every path the `exports`
map names, no dependency left on `workspace:`, and nothing outside
`dist/` besides `package.json`, `README.md`, `LICENSE` and `NOTICE`. Each
package keeps its own copy of `LICENSE` and `NOTICE`, because npm packs
only files inside the package folder; the check keeps the copies equal to
the root. The build emits no source maps, since the tarball ships no
source for them to point to.

## A new package

npm accepts a trusted publisher only for a package that already exists.
A package's first version is published from a maintainer's machine:
`npm login`, then `rafa release publish` on the tagged commit. Then, on
npmjs.com, the package's settings get a trusted publisher naming
`open-tomato/service` and `release-publish.yml`, and every later version
publishes from CI.
