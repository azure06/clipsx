---
name: clipsx-ui
description: Create or change ClipsX desktop screens, forms, menus, dialogs, or preview interactions using the existing design system. Use for frontend interaction work, not unrelated backend changes.
---

# ClipsX UI workflow

1. Inspect a comparable screen and the shared controls in
   [src/shared/components/ui/](../../../src/shared/components/ui/) before designing.
   Follow repository navigation guidance in [AGENTS.md](../../../AGENTS.md).
2. Reuse Button, Input, Select, Switch, Tabs, Card and DropdownMenu. Extend a
   shared component if it lacks a needed capability. For genuinely missing
   interactions, use the existing Radix primitives. Consider shadcn patterns only
   when they fit the current stack; do not add another component library by default.
3. Preserve typography, compact spacing, surfaces, icon sizing, violet focus
   treatment and light/dark behavior. Consult [styles.css](../../../src/styles.css)
   and nearby screens. Ordinary changes do not call for new fonts, palettes,
   decorative effects or a redesign.
4. For substantial design work, use an available UI/UX skill such as
   `frontend-design` as a supplement. The existing app style remains the constraint.
   This workflow is usable without any personal skill installed.
5. Include keyboard operation, visible focus, focus restoration, dropdown/dialog
   layering, narrow layouts, and loading, error and disabled states. Keep labels
   and validation messages accessible.
6. Run checks relevant to the interaction using [repository commands](../../../AGENTS.md).
   Add focused regression tests when practical. Inspect the UI visually when a
   local app or preview is available; report explicitly when visual verification
   could not run. Summarize changed behavior and remaining review needs.

Use [architecture](../../../docs/ARCHITECTURE.md) for ownership and boundaries.
Do not move product requirements into this workflow.
