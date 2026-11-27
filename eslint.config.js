import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.browser,
    },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['build.mjs', 'scripts/**', 'test/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
];
