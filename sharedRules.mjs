export default {
  '@stylistic/comma-dangle': ['error', 'always-multiline'],
  '@stylistic/eol-last': ['error', 'always'],
  '@stylistic/function-paren-newline': ['error', 'multiline-arguments'],
  'global-require': 0,
  '@stylistic/implicit-arrow-linebreak': ['error', 'beside'],
  'arrow-body-style': ['error', 'as-needed'],
  '@stylistic/indent': ['error', 2, { SwitchCase: 1 }],
  '@stylistic/multiline-ternary': ['error', 'always'],
  '@stylistic/newline-per-chained-call': ['error', { 'ignoreChainWithDepth': 2 }],
  '@stylistic/no-multiple-empty-lines': ['error', { 'max': 1, 'maxEOF': 1 }],
  '@stylistic/no-multi-spaces': ['error', { exceptions: { Property: false }, 'ignoreEOLComments': true }],
  '@stylistic/no-tabs': ['error'],
  'no-var': 2,
  'no-undef': 2,
  'object-curly-spacing': ['error', 'always'],
  '@stylistic/quotes': ['error', 'single'],
  '@stylistic/semi': ['error', 'always'],
  'import/prefer-default-export': 0,
  // Two kinds of import are left to `tsc`, which resolves them under
  // NodeNext: the workspace's own packages, whose exports point at `dist/`
  // and lint runs before any build; and the MCP SDK's subpaths, published
  // through a `./*` export pattern the import resolver does not follow.
  'import/no-unresolved': ['error', { ignore: ['^bun:', '^@open-tomato/service', '^@modelcontextprotocol/sdk/'] }],
  'import/order': ['error', {
    groups: [
      'type',
      'builtin',
      'external',
      'internal',
      'parent',
      'sibling',
      'index',
    ],
    'newlines-between': 'always',
    alphabetize: {
      order: 'asc',
      caseInsensitive: true,
    },
  }],
};
