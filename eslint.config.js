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
      'examples/extensions/*/ui/**',
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

  // Config files without type checking
  {
    files: ['*.config.ts', '*.config.js'],
    extends: tseslint.configs.recommended,
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

      // TypeScript recommended overrides
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  }
)
