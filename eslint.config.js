import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  // Ignore build outputs and dependencies
  {
    ignores: [
      'dist',
      'dist-ssr',
      'node_modules',
      'src-tauri/target',
      'src-tauri/gen',
      // Extension UI is packaged guest code (including vendored framework
      // bundles), not part of the privileged React frontend build.
    ],
  },

  // Base configs for all files
  js.configs.recommended,

  // TypeScript configs with type checking only for source files
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    extends: tseslint.configs.recommendedTypeChecked,
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Supabase CLI output uses conditional never unions; keep generated code intact.
  {
    files: ['src/shared/auth/database.types.ts'],
    rules: { '@typescript-eslint/no-redundant-type-constituents': 'off' },
  },

  // Config files without type checking
  {
    files: ['*.config.ts', '*.config.js'],
    extends: tseslint.configs.recommended,
  },

  // Repository scripts execute in Node rather than the browser.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        process: 'readonly',
      },
    },
  },

  // React-specific rules
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // Existing effects synchronize local UI state with Tauri events, external
      // stores, and async host data. Migrate those flows deliberately instead of
      // allowing a plugin upgrade to force broad behavior changes in CI.
      'react-hooks/set-state-in-effect': 'off',

      // TypeScript recommended overrides
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  }
)
