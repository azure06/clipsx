# Dependencies Overview

This document is a lightweight map of the current frontend dependencies and tooling.

Source of truth for exact versions: `package.json`

---

## Production Dependencies

### React and UI
- `react`, `react-dom`
- `lucide-react`
- Radix UI packages for dialogs, dropdowns, labels, popovers, selects, switches, tabs, toasts, and tooltips
- `clsx`
- `tailwind-merge`

### Tauri
- `@tauri-apps/api`
- `@tauri-apps/plugin-autostart`
- `@tauri-apps/plugin-clipboard-manager`
- `@tauri-apps/plugin-dialog`
- `@tauri-apps/plugin-fs`
- `@tauri-apps/plugin-shell`
- `@cloudworxx/tauri-plugin-mac-rounded-corners`

### State
- `zustand`

---

## Development Dependencies

### Build and language
- `vite`
- `@vitejs/plugin-react`
- `typescript`
- `@types/react`
- `@types/react-dom`
- `@tauri-apps/cli`

### Styling
- `tailwindcss`
- `@tailwindcss/postcss`
- `postcss`
- `autoprefixer`

### Linting and formatting
- `eslint`
- `@eslint/js`
- `typescript-eslint`
- `eslint-plugin-react-hooks`
- `eslint-plugin-react-refresh`
- `prettier`

### Testing
- `vitest`
- `@vitest/ui`
- `@vitest/coverage-v8`
- `@testing-library/react`
- `@testing-library/jest-dom`
- `@testing-library/user-event`
- `jsdom`
- `happy-dom`

### Git hooks
- `simple-git-hooks`

---

## Repo Scripts

### Development
- `npm run dev`
- `npm run tauri:dev`

### Checks
- `npm run type-check`
- `npm run lint`
- `npm run format`
- `npm run test`
- `npm run test:coverage`
- `npm run test:rust`
- `npm run test:all`

---

## Notes

- The pre-commit hook currently runs `npm run format` and `npm run type-check`.
- `npm run format` only formats `src/**/*.{ts,tsx,css}`. Markdown docs are not auto-formatted by the hook.
- Use `package.json` as the source of truth if this document drifts.

---

See [CODING_STYLE.md](./CODING_STYLE.md) for architecture and implementation conventions.
