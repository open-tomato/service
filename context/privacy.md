# Privacy

This repository is public, and so are its issues, pull requests and
commit messages. None of them may name:

- a host name, a LAN name or a private IP address;
- a home directory path, such as one under `/Users/` or `/home/`;
- a private repository, organisation or registry;
- an e-mail address other than the project's public author address;
- a token, key or other credential.

Write "a private registry" or "the prior implementation" instead. Generic
paths such as `~/.config/<tool>` are fine. Material that needs any of these
belongs in the gitignored `.rafa/` or `.reference/`.

## The checks

- **Pre-commit hook.** `.githooks/pre-commit` scans what a commit stages.
  Turn it on once per clone with `git config core.hooksPath .githooks`. A
  personal denylist kept outside the repository is added through
  `git config privacy.denylist <file>` or `PRIVACY_DENYLIST`.
- **CI.** `.github/workflows/privacy.yml` scans the files, the history with
  gitleaks, and every new commit, on each push and pull request.
- **By hand.** `bun scripts/privacy-check.ts <dir>` scans a folder. A
  finding prints as `file:line rule` and never repeats the matched text.

A binary file a person has reviewed is listed with its sha256 in
`.privacy-reviewed`, and passes while its content still matches.
`scripts/privacy-check.ts` is generated from a shared kit, so it is not
edited here.
