/**
 * Root ESLint configuration for Taproot POS monorepo.
 *
 * Security-focused rules shared by all packages.
 * React-specific rules applied to apps/web via overrides.
 * Test files get relaxed rules (mock data, any types).
 */

'use strict';

module.exports = {
  root: true,

  env: {
    node:   true,
    es2022: true,
  },

  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion:  2022,
    sourceType:   'module',
  },

  plugins: [
    '@typescript-eslint',
    'no-secrets',
    'security',
  ],

  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],

  rules: {
    // ── Security essentials ────────────────────────────────────────────────
    'no-eval':         'error',
    'no-implied-eval': 'error',
    'no-new-func':     'error',
    'no-script-url':   'error',

    // Secret scanning — tolerance 4.5 avoids SQL identifiers and camelCase names
    // (real secrets like API keys have entropy > 4.5; SQL cols hover around 3.5-3.8)
    'no-secrets/no-secrets': ['error', { tolerance: 4.5 }],

    // Security plugin (subset — detect-object-injection is too noisy for TS)
    'security/detect-non-literal-regexp':      'warn',
    'security/detect-possible-timing-attacks': 'warn',
    'security/detect-non-literal-fs-filename': 'warn',

    // ── TypeScript ─────────────────────────────────────────────────────────
    // Keep explicit-any as warn — the codebase has some intentional any usage
    '@typescript-eslint/no-explicit-any':   'warn',
    '@typescript-eslint/no-unused-vars': [
      'warn',  // warn — legacy service files have intentional unused imports
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    // Use no-require-imports (warn) instead of no-var-requires (error from recommended)
    '@typescript-eslint/no-require-imports': 'warn',
    '@typescript-eslint/no-var-requires':    'off',
    // Allow empty catch blocks in service error handling
    'no-empty': ['error', { allowEmptyCatch: true }],
    // while(true) / do..while(true) used for retry/pagination — not a bug
    'no-constant-condition': ['error', { checkLoops: false }],
  },

  overrides: [
    // ── React / browser files (apps/web) ──────────────────────────────────
    {
      files: ['apps/web/src/**/*.{ts,tsx}'],
      env: { browser: true, node: false },
      parserOptions: {
        ecmaVersion: 2022,
        sourceType:  'module',
        ecmaFeatures: { jsx: true },
      },
      plugins: ['react', 'react-hooks'],
      extends: [
        'plugin:react/recommended',
        'plugin:react-hooks/recommended',
      ],
      settings: {
        react: { version: 'detect' },
      },
      rules: {
        'react/react-in-jsx-scope': 'off', // React 17+ new JSX transform
        'react/prop-types':         'off', // TypeScript handles prop types
        'react/display-name':       'warn',
        // Security: these are less applicable in UI code
        'security/detect-non-literal-fs-filename': 'off',
        // Scripts / CSS values sometimes look like secrets
        'no-secrets/no-secrets': ['error', { tolerance: 4.5 }],
      },
    },

    // ── Test files ─────────────────────────────────────────────────────────
    {
      files: [
        '**/__tests__/**/*.{ts,tsx}',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
      ],
      env: { jest: true },
      rules: {
        'no-secrets/no-secrets':              'off', // Mock API keys / fixtures
        '@typescript-eslint/no-explicit-any': 'off', // Mocks need any
        'security/detect-possible-timing-attacks': 'off',
      },
    },

    // ── Migration files ────────────────────────────────────────────────────
    {
      files: ['migrations/**/*.js'],
      env: { node: true },
      rules: {
        '@typescript-eslint/no-require-imports': 'off',
        'no-secrets/no-secrets': 'off', // UUIDs in seed data
        '@typescript-eslint/no-var-requires': 'off',
      },
    },

    // ── Scripts (CJS) ──────────────────────────────────────────────────────
    {
      files: ['scripts/**/*.js', 'ecosystem.config.js', '.eslintrc.js'],
      env: { node: true },
      rules: {
        '@typescript-eslint/no-require-imports': 'off',
        '@typescript-eslint/no-var-requires':    'off',
        'no-secrets/no-secrets': 'off',
      },
    },

    // ── Config / build files ───────────────────────────────────────────────
    {
      files: ['*.config.{js,ts}', 'vite.config.*'],
      rules: {
        '@typescript-eslint/no-require-imports': 'off',
        'no-secrets/no-secrets': 'off',
      },
    },
  ],

  // Ignore generated/vendor directories
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'build/',
    'coverage/',
    'apps/web/dist/',
    '*.d.ts',
    'client.bak/',
    'server.bak/',
  ],
};
