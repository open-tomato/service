import { builtinModules } from 'node:module';

import baseConfig from '@open-tomato/eslint-config';
import { CODE_FILES } from '@open-tomato/eslint-config/files';
import markdownFences from '@open-tomato/eslint-config/markdown-fences';

/** Node's built-in module names without a subpath, as one regex alternation. */
const NODE_BUILTINS = builtinModules.filter((name) => !name.includes('/')).join('|');

/** Node globals the core must not read, because other runtimes lack them. */
const NODE_ONLY_GLOBALS = [
  'process',
  'Buffer',
  'require',
  'module',
  'exports',
  '__dirname',
  '__filename',
  'global',
  'setImmediate',
  'clearImmediate',
];

/**
 * ESLint flat config for the whole repository: every package under
 * `packages/`, `scripts/` and the root-level files, in one run. The shared
 * `@open-tomato/eslint-config` base and its Markdown-fences flavor, and
 * below them only what is this repository's own.
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
  ...markdownFences,
  {
    files: CODE_FILES,
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
    // The core's portability guard: `@open-tomato/service` runs outside
    // Node (Workers, Deno, a browser bundle), so its sources import no Node
    // built-in and read no Node-only global. Environment variables go
    // through `readEnv()`. Tests run under Node and are not held to it.
    files: ['packages/service/src/**/*.ts'],
    ignores: ['packages/service/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            regex: `^(node:|(${NODE_BUILTINS})(/|$))`,
            message: 'The core runs outside Node: use a web-standard API, or keep this in an adapter.',
          },
          {
            regex: '^(pino|@open-tomato/service-logger)(/|$)',
            message: 'The core logs through its injected Logger; pino stays in the adapters.',
          },
        ],
      }],
      'no-restricted-globals': ['error', ...NODE_ONLY_GLOBALS.map((name) => ({
        name,
        message: `The core runs outside Node, where \`${name}\` may not exist; read env through readEnv(), and keep the rest in an adapter.`,
      }))],
    },
  },
  {
    // The `ts` and `js` fences of a Markdown file, as virtual children
    // (`README.md/0.ts`, …).
    files: ['**/*.md/*.ts', '**/*.md/*.js'],
    rules: {
      // The packages' own names resolve to `dist/` only after a build,
      // and CI lints before it builds.
      'import/no-unresolved': ['error', { ignore: ['^bun:', '^@open-tomato/service'] }],
    },
    settings: {
      // Without `dist/` the packages' names are unresolved and would sort
      // as external; pin them to internal so the order of a block's imports
      // does not depend on whether a build has run.
      'import/internal-regex': '^@open-tomato/service',
    },
  },
];
