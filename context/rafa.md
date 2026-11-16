# rafa in this repository

rafa runs this repository's planned work. A spec is an issue on the board,
a plan is written from it, a loop implements the plan one task per Claude
Code session, and the loop's wrap-up opens the pull request. This page says
where each piece lives, how a new clone, worktree or loop host gets it, and
which skills and agents a loop session sees.

rafa is installed as a global CLI; its own README covers the install. Read
`rafa <subject> --help` before using an action for the first time: the help
is the authority on flags.

## Where things live

| What | Where | Tracked |
|---|---|---|
| Project settings | `rafa.config.mjs` | yes |
| Local settings, which rafa writes | `.rafa/config.yaml` | no |
| Specs | `type:spec` issues; a snapshot under `.rafa/specs/` | the issue |
| Plans | `.rafa/plans/PLAN-<stub>.md` | no |
| Loop worktrees, runs, effort store | `.rafa/worktrees/`, `.rafa/runs/`, `.rafa/effort/` | no |
| The roadmap | the pinned issue titled Roadmap, `roadmap.issue` | the issue |
| Change fragments | `.changes/`, see `context/release.md` | yes |
| Skills and agents for loops | `.claude/skills/`, `.claude/agents/` | yes |

## Two config layers

rafa reads two files in the project root. `rafa.config.mjs` is the project
layer: tracked, read by rafa and never written by it, so every clone and
every worktree reads the same settings. `.rafa/config.yaml` is the local
layer, read over it key by key, and it is the file rafa writes itself
(`rafa config set`, `rafa stretch start`). `rafa config show --sources`
names the layer behind each key.

The project layer holds:

- `pr.base: v2`, because pull requests for the 2.x line go into `v2`
  (`context/release.md`, release lines).
- `release.*`: the release is on, and CI publishes from a pushed tag.
- `board.project.number` and `roadmap.issue`: the board and its roadmap.
- `loop.worktreeSetup`: each loop worktree runs
  `bun install --frozen-lockfile` before its first session, so it never
  resolves the workspace packages through the main checkout.
- `tiers`: the pins described under "Skills and agents a loop sees".

## Bootstrap

### A new clone

1. `bun install`
2. `git config core.hooksPath .githooks`, the privacy hook
3. `rafa init --yes --no-board`, which writes `.rafa/config.yaml` with
   every key commented out and the `.rafa/` tree. The board already exists,
   so `--no-board` leaves it alone.
4. `rafa doctor`, which checks `gh`, the board labels, the roadmap, the
   skill tiers and the effort store.

### A new branch or worktree

A worktree holds `rafa.config.mjs`, so board, pull request and release
commands read the same settings there as in the main checkout. It holds no
`.rafa/` of its own, and specs, plans and the effort store live in the main
checkout, so run `rafa plan create` and `rafa loop start` from the main
checkout.

The loop makes its own branch and worktree: `rafa loop start --as-worktree`
runs the plan on `feat/<stub>` under `.rafa/worktrees/` and leaves the main
checkout as it is. A plan made from issue `<n>` has the stub
`rafa-<n>-<slug>`, so its branch is `feat/rafa-<n>-<slug>`. Do not create
that branch by hand: a branch with that name marks the issue's roadmap line
as taken.

### A loop host for a stretch

A stretch runs several specs of one epic on another machine. Its clone
needs the steps of a new clone, plus `gh auth login`, a signed-in `claude`,
and a git identity in the clone's own config.

`rafa stretch start` cuts `stretch/<n>` from the branch `origin/HEAD` names,
which is `main` here, while 2.x work builds on `v2`. Until rafa cuts from
`pr.base`, run `git remote set-head origin v2` in the host's clone first. It
changes only that clone's local reference, and `rafa stretch end` then opens
the stretch into `v2` as well. `rafa stretch start --dry-run` shows the
push line, which must read `origin/v2:refs/heads/stretch/<n>`.

## Skills and agents a loop sees

A loop session loads the setting sources `loop.settingSources` names,
`project,local` by default. So it sees two tiers: the project tier in
`.claude/`, and the rafa tier, the skills and agents rafa ships. It never
sees the user tier, `~/.claude/`. `rafa agent list` and `rafa skill list`
mark with `●` each one a loop session resolves.

When a project file and a rafa file share a name, a loop resolves neither
until a pin names the tier. The project copies of `documentation`,
`git-workflow` and six agents are written for this repository, so `tiers`
in `rafa.config.mjs` pins them to `project`. A new skill or agent here whose
name rafa also ships needs a pin too, and `rafa doctor` names any that lacks
one. `rafa skill check .claude/skills --project=.` must report no failing
file.

Tasks route by shape to the agents in rafa's default `routing`:
`loop-implementer` for implementation, `tdd-guide` for tests,
`code-reviewer` for review, `build-error-resolver` for repairs and
`doc-updater` for prose.

A maintainer's own user-tier skills and agents are not part of this
repository, and a loop session never sees them. A maintainer may list the
ones used for this repository in `.rafa/private-skills.md`, which is
untracked. Knowledge a loop needs belongs in the spec or in a project skill.

## From a spec to a merge

1. **Spec.** An issue from the Spec template,
   `.github/ISSUE_TEMPLATE/spec.md`: one spec, one plan, one pull request. A
   large change is split into several specs under one epic
   (`rafa epic new`), ordered by `Blocked by: #<n>` lines.
2. **Ready.** A maintainer reads the spec and marks it with
   `rafa issue ready <n>`. rafa never adds `spec:ready` by itself.
3. **Plan.** `rafa plan create --issue=<n>` starts one planning session and
   writes `.rafa/plans/PLAN-rafa-<n>-<slug>.md`. `rafa plan validate` and
   `rafa plan needs --missing` check it without starting a session.
4. **Loop.** A maintainer runs
   `rafa loop start --plan=.rafa/plans/PLAN-rafa-<n>-<slug>.md --as-worktree`.
5. **Pull request.** The wrap-up opens `rafa-<n>: <title>` into `v2`, with
   a change fragment. `rafa pr wait <pr>` waits on CI, and a maintainer
   merges with `rafa pr merge <pr>`.

For an epic of several specs, a stretch on a loop host runs steps 3 to 5
per issue: `rafa stretch start`, then `rafa stretch item <n> --wait` for
each issue, which merges each pull request into `stretch/<n>`.
`rafa stretch end` opens the stretch branch into the base once a maintainer
has tried it.
