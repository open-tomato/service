# Release

Nothing is published yet. Every package is at `0.0.0` until its first
release.

- **Versions.** Each public package versions on its own;
  `service-errors` is private and never publishes.
- **Fragments.** A branch records its change as `.changes/<plan id>.md`,
  with a `level` of `patch`, `minor`, `major` or `none`. A branch never
  edits a version or a changelog itself.
- **Settle.** `rafa release settle` folds the fragments into the versions
  and the changelogs, in one release commit on the base branch.
- **Publish (planned).** From CI, with npm trusted publishing and
  provenance, so no token is stored. A published manifest must carry real
  versions where the workspace has `workspace:^`: `bun pm pack` writes
  them into the tarball, and `npm publish <tarball>` publishes it. The
  maintainer runs the tag and the publish.

The publish workflow is not set up yet. Before the first publish, each
tarball must carry `LICENSE` and `NOTICE`, and a pack check must prove
what ships.
