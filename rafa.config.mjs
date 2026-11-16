/**
 * rafa's project layer for this repository. rafa reads this file and never
 * writes it. Because it is tracked, every clone, every worktree and every
 * loop host reads the same settings, and each worktree is a project root of
 * its own.
 *
 * `.rafa/config.yaml`, where a checkout holds one, is the local layer, read
 * over this file key by key. It is the file rafa writes itself
 * (`rafa config set`, `rafa stretch start`), so keep it for what is local to
 * one checkout. `rafa config show --sources` names the layer behind each key.
 *
 * Why each key is here: `context/rafa.md`.
 */
export default [
  {
    pr: { base: 'v2' },
    release: {
      enabled: true,
      publish: 'ci',
      publishCommand: 'bun ../../scripts/publish-package.ts',
    },
    board: { project: { number: 8 } },
    roadmap: { issue: 23 },
    loop: { worktreeSetup: 'bun install --frozen-lockfile' },
    tiers: {
      skills: {
        documentation: 'project',
        'git-workflow': 'project',
      },
      agents: {
        'build-error-resolver': 'project',
        'code-reviewer': 'project',
        'doc-updater': 'project',
        'loop-implementer': 'project',
        'qa-bug-reporter': 'project',
        'tdd-guide': 'project',
      },
    },
  },
];
