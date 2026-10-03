import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.node },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }], 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
  { files: ['scripts/render-svg.js'], rules: { 'no-control-regex': 'off' } },
];
