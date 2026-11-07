import baseConfig from '@open-tomato/eslint-config';
import markdownFencesConfig from '@open-tomato/eslint-config/markdown-fences';

/**
 * ESLint flat config for the whole repository: every package under
 * `packages/`, `scripts/` and the root-level files, in one run. The shared
 * open-tomato base and its Markdown-fences flavor, plus what is this
 * workspace's own.
 *
 * @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: [
      // Generated from the clean-room privacy kit; fix it upstream.
      'scripts/privacy-check.ts',
    ],
  },
  ...baseConfig,
  ...markdownFencesConfig,
  {
    files: ['**/*.js', '**/*.mjs', '**/*.ts', '**/*.md/*.ts', '**/*.md/*.js'],
    rules: {
      // Two kinds of import are left to `tsc`, which resolves them under
      // NodeNext: the workspace's own packages, whose exports point at
      // `dist/` and lint runs before any build; and the MCP SDK's subpaths,
      // published through a `./*` export pattern the import resolver does
      // not follow.
      'import/no-unresolved': ['error', { ignore: ['^bun:', '^@open-tomato/service', '^@modelcontextprotocol/sdk/'] }],
    },
  },
  {
    files: ['**/*.md/*.ts', '**/*.md/*.js'],
    settings: {
      // Without `dist/` the packages' names are unresolved and would sort
      // as external; pin them to internal so the order of a block's imports
      // does not depend on whether a build has run.
      'import/internal-regex': '^@open-tomato/service',
    },
  },
];
