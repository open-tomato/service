import { builtinModules } from 'node:module';

import eslint from '@eslint/js';
import markdown from '@eslint/markdown';
import stylistic from '@stylistic/eslint-plugin';
import * as tsParser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';
import importPlugin from 'eslint-plugin-import';
import jsonc from 'eslint-plugin-jsonc';
import globals from 'globals';
import * as jsoncParser from 'jsonc-eslint-parser';
import { configs as tsLintConfig } from 'typescript-eslint';

import sharedRules from './sharedRules.mjs';

const fenceProcessor = markdown.processors.markdown;

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
 * The `markdown/markdown` processor, extended to lint the Markdown file
 * itself as well as its fences. The stock processor returns only the
 * fenced blocks, so a `.md` file it runs on is never linted as Markdown
 * and `markdown/recommended` goes silent over it, whether the processor
 * sits in the same config object or in its own. ESLint lints a string
 * block with the file's own config (the `markdown/commonmark` language
 * here), so the whole text goes first and its messages come back
 * unchanged; the fence messages go through the stock `postprocess`,
 * which maps them back onto the file.
 *
 * @type {import("eslint").Linter.Processor} */
const markdownWithFences = {
  meta: { name: 'markdown-with-fences' },
  supportsAutofix: true,
  preprocess: (text, filename) => [text, ...fenceProcessor.preprocess(text, filename)],
  postprocess: ([fileMessages = [], ...fenceMessages], filename) => [
    ...fileMessages,
    ...fenceProcessor.postprocess(fenceMessages, filename),
  ],
};

/**
 * ESLint flat config for the whole repository: every package under
 * `packages/`, `scripts/` and the root-level files, in one run. Taken from
 * the define-config repository, widened from one package to the workspace.
 *
 * @type {import("eslint").Linter.Config[]} */
export default defineConfig([
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      // Gate captures and scratch, gitignored.
      '.tmp/**',
      // Generated from the clean-room privacy kit; fix it upstream.
      'scripts/privacy-check.ts',
      // Agent-harness prose (vendored skills and agents) is not a lint
      // target.
      '.claude/**',
      // Loop state, gitignored.
      '.rafa/**',
    ],
  },
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  {
    files: ['**/*.js', '**/*.mjs', '**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tsLintConfig.recommended,
    ],
    plugins: {
      '@stylistic': stylistic,
    },
    languageOptions: {
      globals: {
        ...globals.node,
        Bun: 'readonly',
      },
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      ...sharedRules,
    },
    settings: {
      'import/parsers': {
        '@typescript-eslint/parser': ['.ts', '.d.ts'],
      },
      'import/resolver': {
        typescript: {
          project: ['./tsconfig.json', './packages/*/tsconfig.json'],
          noWarnOnMultipleProjects: true,
        },
      },
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
    files: ['**/*.md'],
    plugins: {
      markdown,
    },
    extends: ['markdown/recommended'],
    processor: markdownWithFences,
    rules: {
      'markdown/no-missing-label-refs': 'off',
    },
  },
  {
    // The `ts` and `js` fences of a Markdown file, as virtual children
    // (`README.md/0.ts`, …). The block above already gives them the
    // TypeScript rule set; a fence in any other language matches no
    // config and is not linted.
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
  {
    files: ['**/*.json'],
    languageOptions: {
      parser: jsoncParser,
    },
    plugins: {
      jsonc,
      '@stylistic': stylistic,
    },
    rules: {
      'jsonc/indent': ['error', 2],
      '@stylistic/no-multiple-empty-lines': ['error', { 'max': 0, 'maxEOF': 0 }],
    },
  },
]);
