import js from '@eslint/js';
import react from 'eslint-plugin-react';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx,mjs}'],
    plugins: { react, 'react-hooks': hooks },
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: '19' } },
    rules: {
      ...react.configs.recommended.rules,
      ...hooks.configs.recommended.rules,
      // The React Compiler is not used here; these compiler-oriented checks flag deliberate patterns
      // (loading data into state inside effects, keeping the latest callback in a ref). Keep the classic rules.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/no-unescaped-entities': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
    },
  },
  {
    files: [
      'server/**/*.mjs',
      'tests/**/*.mjs',
      '*.mjs',
      'api/**/*.js',
      'eslint.config.js',
      'vite.config.js',
    ],
    languageOptions: { globals: globals.node },
    rules: {
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  { ignores: ['dist/', 'node_modules/', '.data/', 'public/'] },
];
