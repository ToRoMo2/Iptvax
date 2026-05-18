import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // `.claude` contient des worktrees git (copies du repo) — ne pas les linter.
  // `supabase` : Edge Functions runtime Deno (imports URL + global `Deno`),
  // hors périmètre du lint frontend (typé/exécuté par Deno, pas Vite/tsc).
  { ignores: ['dist', '.claude', 'supabase'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // CLAUDE.md §IV-6 : variables/paramètres intentionnellement inutilisés
      // préfixés `_` (cohérent avec `noUnusedLocals`/`noUnusedParameters` TS).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
)
