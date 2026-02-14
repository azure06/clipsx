# Dependencies Documentation

This document explains every dependency in the project and why it's needed.

## Production Dependencies

### UI Framework
- **react** (^19.0.0)  
  Core UI library. v19 includes the new React Compiler for automatic optimization.

- **react-dom** (^19.0.0)  
  DOM renderer for React. Required for web/desktop applications.

### Tauri Integration
- **@tauri-apps/api** (^2.0.0)  
  Frontend API to communicate with Tauri backend via IPC (Inter-Process Communication).

- **@tauri-apps/plugin-shell** (^2.0.0)  
  Tauri plugin for executing shell commands safely from the frontend.

### State Management
- **zustand** (^5.0.2)  
  Lightweight state management for global app state (clipboard history, settings, UI state).  
  **Why not Redux?** Zustand is simpler, smaller (1KB), and works perfectly with React 19.  
  **Why not just React Context?** For complex state with persistence and middleware.

---

## Development Dependencies

### Build Tools

- **vite** (^7.3.1)  
  Ultra-fast build tool and dev server. v7 brings major performance improvements.  
  **Why not webpack?** Vite is 10-100x faster with native ESM and Rollup 4.

- **@vitejs/plugin-react** (^5.1.3)  
  Vite plugin for React Fast Refresh (hot module replacement).  
  v5 adds React 19 compatibility and better TypeScript support.

- **@tauri-apps/cli** (^2.0.0)  
  CLI tool to build, develop, and bundle Tauri applications.

### TypeScript

- **typescript** (^5.7.3)  
  Type system and compiler. v5.7 includes performance improvements and new inference features.

- **@types/react** (^19.0.0)  
  TypeScript type definitions for React 19.

- **@types/react-dom** (^19.0.0)  
  TypeScript type definitions for ReactDOM.

### Code Quality - Linting

- **eslint** (^9.18.0)  
  Static code analyzer to find bugs and enforce code standards.  
  v9 uses the new flat config format (simpler than `.eslintrc`).

- **@eslint/js** (^9.18.0)  
  ESLint's base JavaScript rules (no-unused-vars, no-undef, etc.).  
  **Required even for TypeScript** because TS files still need JS rules.

- **typescript-eslint** (^8.21.0)  
  TypeScript-aware linting rules (catches type-related bugs).  
  **Examples:** Detects floating promises, misused async/await, type inconsistencies.

- **eslint-plugin-react-hooks** (^5.1.0)  
  **Critical for React apps.** Enforces Hooks rules:
  - No conditional hooks
  - Complete dependency arrays
  - Prevents infinite re-render bugs

- **eslint-plugin-react-refresh** (^0.4.16)  
  Ensures components are compatible with Vite's Fast Refresh.  
  **Prevents:** Exported constants breaking hot reload.

### Code Quality - Formatting

- **prettier** (^3.4.2)  
  Opinionated code formatter (spacing, quotes, line length).  
  **Why?** Eliminates formatting debates in teams, auto-fixes on save.

### Testing Framework

- **vitest** (^2.1.8)  
  Vite-native test runner (replaces Jest).  
  **Why Vitest?** 
  - 10x faster than Jest
  - Native ESM support
  - Same Vite config as dev/build
  - Compatible with React Testing Library

- **jsdom** (^25.0.1)  
  **Critical for React testing.** Simulates a browser DOM in Node.js.  
  **Without this:** Can't test React components (they need a DOM to render).  
  **Alternative:** happy-dom (faster, less compatible)

- **@vitest/ui** (^2.1.8)  
  Browser-based test UI with interactive results and coverage.  
  **Usage:** `npm run test:ui` - opens visual test dashboard.

- **@vitest/coverage-v8** (^2.1.8)  
  Code coverage reporter using V8's built-in coverage.  
  **Shows:** What % of code is tested, which lines are uncovered.

### Testing - React Utilities

- **@testing-library/react** (^16.1.0)  
  **Industry standard** for testing React components.  
  **Philosophy:** Test behavior, not implementation (how users interact).

- **@testing-library/jest-dom** (^6.6.3)  
  Custom matchers for DOM assertions.  
  **Examples:** `toBeInTheDocument()`, `toHaveClass()`, `toBeVisible()`  
  Makes tests more readable and expressive.

- **@testing-library/user-event** (^14.5.2)  
  Simulates realistic user interactions (click, type, hover).  
  **Why not fireEvent?** user-event is more realistic (handles focus, keyboard events properly).

### Git Hooks

- **simple-git-hooks** (^2.12.1)  
  Runs scripts before commits (linting, formatting, type-checking).  
  **Prevents:** Committing broken/ugly code.  
  **Alternative:** husky (more popular but heavier, requires .husky folder)

---

## Version Choices (2026 Best Practices)

### Major Upgrades from Initial Setup

| Package | Old | New | Reason |
|---------|-----|-----|--------|
| vite | 5.4 | 7.3 | Rollup 4, performance, Tauri 2 compatibility |
| @vitejs/plugin-react | 4.3 | 5.1 | React 19 support, better HMR |
| typescript | 5.6 | 5.7 | Latest stable, performance improvements |

### Why These Exact Versions?

- **Caret (^) ranges:** Allow patch/minor updates (security fixes) but prevent breaking changes
- **React 19:** Latest stable, includes compiler and new hooks
- **Vite 7:** Major performance improvements, required for modern Tauri
- **ESLint 9:** New flat config is simpler and faster
- **Vitest 2:** Latest testing framework, 100% Vite-compatible

---

## What We DON'T Need (and Why)

❌ **webpack** - Vite is faster and simpler  
❌ **create-react-app** - Deprecated, use Vite  
❌ **Jest** - Vitest is faster and works better with Vite  
❌ **Redux Toolkit** - Zustand is simpler for this app size  
❌ **Babel** - Vite uses esbuild (faster)  
❌ **@babel/preset-react** - Not needed with Vite  
❌ **react-scripts** - Not using CRA  

---

## Dependency Tree Size

**Total install size:** ~600MB (node_modules)  
**Production bundle:** ~200KB (minified + gzipped)

**Why so big?**  
- TypeScript compiler: ~60MB
- Vite + Rollup: ~40MB  
- Testing libraries: ~80MB
- ESLint + plugins: ~30MB

**Don't worry:** Desktop apps bundle only production code.

---

## Security & Maintenance

- **All packages:** Actively maintained, no known CVEs (as of Feb 2026)
- **Major dependencies:** React, Vite, TypeScript - industry standards with long-term support
- **Update frequency:** Check monthly, upgrade quarterly
- **Breaking changes:** Vite 7→8 will be major, plan carefully

---

## Next Steps After Install

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Setup git hooks:**
   ```bash
   npm run prepare
   ```

3. **Verify everything works:**
   ```bash
   npm run type-check  # TypeScript compilation
   npm run lint        # ESLint checks
   npm test            # Run test suite (when tests exist)
   npm run tauri:dev   # Start app
   ```

---

## Quick Reference

**Run tests:** `npm test`  
**Format code:** `npm run format`  
**Fix lint issues:** `npm run lint:fix`  
**Type check:** `npm run type-check`  
**Coverage report:** `npm run test:coverage`  
**Test UI:** `npm run test:ui`

---

**Questions?** See [CODING_STYLE.md](./CODING_STYLE.md) for architectural patterns.
